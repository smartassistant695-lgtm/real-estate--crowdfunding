"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { ActionState } from "@/components/ui/form";
import { dollars, formObject, guard, idempotencyKeySchema, zodFailure } from "@/lib/action";
import { DomainError, prisma } from "@/lib/db";
import { providers } from "@/lib/providers";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { audit } from "@/lib/services/audit";
import { notify } from "@/lib/services/notifications";
import { deposit } from "@/lib/services/wallet";
import { requireUser } from "@/lib/session";
import { US_STATES } from "@/lib/us-states";

const profileSchema = z.object({
  name: z.string().trim().min(2, "Enter your full legal name.").max(120),
  state: z.string().refine((s) => s in US_STATES, "Choose your state of residence."),
  dateOfBirth: z.iso.date("Enter your date of birth.").transform((s, ctx) => {
    const d = new Date(`${s}T00:00:00Z`);
    const now = new Date();
    const eighteen = new Date(Date.UTC(now.getUTCFullYear() - 18, now.getUTCMonth(), now.getUTCDate()));
    if (d.getTime() > eighteen.getTime()) ctx.addIssue({ code: "custom", message: "You must be at least 18 to invest." });
    if (d.getUTCFullYear() < 1900) ctx.addIssue({ code: "custom", message: "Enter a valid date of birth." });
    return d;
  }),
});

export async function saveProfileAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser();
  const parsed = profileSchema.safeParse(formObject(fd));
  if (!parsed.success) return zodFailure(parsed.error);
  return guard(async () => {
    await prisma.user.update({ where: { id: user.id }, data: parsed.data });
    await audit(prisma, { actorId: user.id, action: "user.profile_saved", entityType: "User", entityId: user.id, after: { state: parsed.data.state }, ipAddress: await clientIp() });
    revalidatePath("/onboarding");
  });
}

export async function startKycAction(): Promise<void> {
  const user = await requireUser();
  if (!user.name || !user.state || !user.dateOfBirth) redirect("/onboarding");
  if (user.kycStatus === "APPROVED" || user.kycStatus === "PENDING") redirect("/onboarding");
  if (!(await rateLimit(`kyc:${user.id}`, 5, 3600))) redirect("/onboarding?kyc=limit");
  const started = await providers.kyc.startVerification({ userId: user.id, email: user.email, name: user.name, dateOfBirth: user.dateOfBirth, state: user.state });
  await prisma.user.update({ where: { id: user.id }, data: { kycStatus: "PENDING", kycReference: started.reference, kycSubmittedAt: new Date() } });
  await audit(prisma, { actorId: user.id, action: "kyc.submitted", entityType: "User", entityId: user.id, after: { provider: providers.kyc.name, reference: started.reference } });
  revalidatePath("/onboarding");
}

/** Polled by the identity step while the check is pending. Returns the current status. */
export async function checkKycAction(): Promise<"PENDING" | "APPROVED" | "REJECTED" | "NOT_STARTED"> {
  const user = await requireUser();
  if (user.kycStatus !== "PENDING" || !user.kycReference || !user.kycSubmittedAt) return user.kycStatus;
  const result = await providers.kyc.getVerification({ reference: user.kycReference, email: user.email, submittedAt: user.kycSubmittedAt });
  if (result.status === "PENDING") return "PENDING";
  // Only move PENDING → decided, and only once, even if two polls race.
  const changed = await prisma.user.updateMany({ where: { id: user.id, kycStatus: "PENDING" }, data: { kycStatus: result.status } });
  if (changed.count === 1) {
    await audit(prisma, { actorId: null, action: `kyc.${result.status.toLowerCase()}`, entityType: "User", entityId: user.id, after: { reason: result.reason ?? null } });
    const send = await notify(prisma, [{
      userId: user.id,
      type: "KYC_DECISION",
      title: result.status === "APPROVED" ? "Identity check approved" : "Identity check not approved",
      body: result.status === "APPROVED" ? "Your identity has been verified. You can now fund your account and invest." : (result.reason ?? "We could not verify your identity."),
      href: "/onboarding",
    }]);
    await send();
  }
  revalidatePath("/onboarding");
  return result.status;
}

export async function retryKycAction(): Promise<void> {
  const user = await requireUser();
  if (user.kycStatus === "REJECTED") {
    await prisma.user.update({ where: { id: user.id }, data: { kycStatus: "NOT_STARTED", kycReference: null, kycSubmittedAt: null } });
    await audit(prisma, { actorId: user.id, action: "kyc.retry", entityType: "User", entityId: user.id });
  }
  revalidatePath("/onboarding");
}

export async function acceptRiskDisclosureAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser();
  return guard(async () => {
    if (user.kycStatus !== "APPROVED") throw new DomainError("Complete the identity check first.");
    if (fd.get("accept") !== "on") throw new DomainError("Tick the box to confirm you have read and understood the risks.");
    if (!user.riskDisclosureAcceptedAt) {
      const at = new Date();
      await prisma.user.update({ where: { id: user.id }, data: { riskDisclosureAcceptedAt: at } });
      await audit(prisma, { actorId: user.id, action: "disclosure.risk_accepted", entityType: "User", entityId: user.id, after: { acceptedAt: at, version: "demo-1" }, ipAddress: await clientIp() });
    }
    revalidatePath("/onboarding");
  });
}

export async function fundWalletAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser();
  const parsed = z.object({ amount: dollars(), idempotencyKey: idempotencyKeySchema }).safeParse(formObject(fd));
  if (!parsed.success) return zodFailure(parsed.error);
  return guard(async () => {
    if (user.kycStatus !== "APPROVED" || !user.riskDisclosureAcceptedAt) throw new DomainError("Finish the earlier steps before adding funds.");
    if (!(await rateLimit(`deposit:${user.id}`, 20, 3600))) throw new DomainError("Too many deposits in the last hour. Please try again later.");
    await deposit({ userId: user.id, amountCents: parsed.data.amount, idempotencyKey: parsed.data.idempotencyKey, ipAddress: await clientIp() });
    revalidatePath("/", "layout");
    return { ok: true, message: "Funds added to your wallet." };
  });
}

export async function skipFundingAction(): Promise<void> {
  const user = await requireUser();
  if (user.kycStatus === "APPROVED" && user.riskDisclosureAcceptedAt && !user.fundedAt) {
    // Mark the step as passed without a deposit; the wallet can be funded any time later.
    await prisma.user.update({ where: { id: user.id }, data: { fundedAt: new Date() } });
  }
  revalidatePath("/onboarding");
}

export async function finishOnboardingAction(fd: FormData): Promise<void> {
  const user = await requireUser();
  if (user.kycStatus !== "APPROVED" || !user.riskDisclosureAcceptedAt) redirect("/onboarding");
  if (!user.onboardingCompletedAt) {
    await prisma.user.update({ where: { id: user.id }, data: { onboardingCompletedAt: new Date() } });
    await audit(prisma, { actorId: user.id, action: "user.onboarding_completed", entityType: "User", entityId: user.id });
  }
  redirect(fd.get("to") === "properties" ? "/properties" : "/portfolio");
}
