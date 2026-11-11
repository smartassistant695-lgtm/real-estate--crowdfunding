"use server";

import { createHash, randomBytes } from "node:crypto";
import { AuthError } from "next-auth";
import { redirect } from "next/navigation";
import { z } from "zod";
import { BRAND } from "@/config/brand";
import type { ActionState } from "@/components/ui/form";
import { formObject, guard, zodFailure } from "@/lib/action";
import { hashPassword, passwordSchema, signIn, signOut } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { providers } from "@/lib/providers";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { audit } from "@/lib/services/audit";
import { getSettings } from "@/lib/settings";

const emailSchema = z.email("Enter a valid email address.").max(254).transform((e) => e.toLowerCase().trim());

async function signInOrMessage(email: string, password: string): Promise<ActionState> {
  try {
    await signIn("credentials", { email, password, redirectTo: "/start" });
    return { ok: true };
  } catch (e) {
    if (e instanceof AuthError) {
      const code = (e as AuthError & { code?: string }).code;
      if (code === "rate_limited") return { ok: false, message: "Too many attempts. Please wait ten minutes and try again." };
      return { ok: false, message: "That email and password do not match an account." };
    }
    throw e; // the redirect on success
  }
}

export async function signUpAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const parsed = z.object({ email: emailSchema, password: passwordSchema }).safeParse(formObject(fd));
  if (!parsed.success) return zodFailure(parsed.error);
  const { email, password } = parsed.data;
  const ip = await clientIp();
  if (!(await rateLimit(`signup:ip:${ip}`, 10, 3600))) return { ok: false, message: "Too many sign-ups from this network. Please try again later." };

  const failure = await guard(async () => {
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) return { ok: false, message: "An account with this email already exists. Log in instead.", fieldErrors: { email: "Already registered." } };
    const settings = await getSettings();
    const user = await prisma.user.create({
      data: { email, passwordHash: await hashPassword(password), annualInvestmentLimitCents: settings.annualInvestmentLimitCents, wallet: { create: {} } },
    });
    await audit(prisma, { actorId: user.id, action: "user.signup", entityType: "User", entityId: user.id, ipAddress: ip });
  });
  if (failure && !failure.ok) return failure;
  return signInOrMessage(email, password);
}

export async function logInAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const parsed = z.object({ email: emailSchema, password: z.string().min(1, "Enter your password.").max(200) }).safeParse(formObject(fd));
  if (!parsed.success) return zodFailure(parsed.error);
  return signInOrMessage(parsed.data.email, parsed.data.password);
}

export async function signOutAction(): Promise<void> {
  await signOut({ redirectTo: "/" });
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export async function requestPasswordResetAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const parsed = z.object({ email: emailSchema }).safeParse(formObject(fd));
  if (!parsed.success) return zodFailure(parsed.error);
  const ip = await clientIp();
  if (!(await rateLimit(`reset:ip:${ip}`, 5, 3600))) return { ok: false, message: "Too many requests. Please try again in an hour." };
  return guard(async () => {
    const user = await prisma.user.findUnique({ where: { email: parsed.data.email } });
    let demoLink = "";
    if (user) {
      const token = randomBytes(32).toString("base64url");
      await prisma.passwordResetToken.create({ data: { userId: user.id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + 60 * 60 * 1000) } });
      const url = `${process.env.APP_URL ?? "http://localhost:3000"}/reset-password/${token}`;
      await providers.email.send({ to: user.email, subject: `Reset your ${BRAND.name} password`, text: `Use this link within one hour to choose a new password:\n${url}\nIf you did not ask for this, you can ignore this email.` });
      await audit(prisma, { actorId: user.id, action: "user.password_reset_requested", entityType: "User", entityId: user.id, ipAddress: ip });
      if (process.env.NODE_ENV !== "production") demoLink = ` (Demo: email is logged to the server console. Link: ${url})`;
    }
    // Same answer whether or not the account exists.
    return { ok: true, message: `If an account exists for that email, a reset link is on its way. It works for one hour.${demoLink}` };
  });
}

export async function resetPasswordAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const parsed = z.object({ token: z.string().min(20).max(100), password: passwordSchema }).safeParse(formObject(fd));
  if (!parsed.success) return zodFailure(parsed.error);
  const result = await guard(async () => {
    const row = await prisma.passwordResetToken.findUnique({ where: { tokenHash: sha256(parsed.data.token) } });
    if (!row || row.usedAt || row.expiresAt.getTime() < Date.now()) return { ok: false, message: "This reset link has expired or was already used. Request a new one." };
    const passwordHash = await hashPassword(parsed.data.password);
    await prisma.$transaction([
      prisma.user.update({ where: { id: row.userId }, data: { passwordHash } }),
      prisma.passwordResetToken.updateMany({ where: { userId: row.userId, usedAt: null }, data: { usedAt: new Date() } }),
    ]);
    await audit(prisma, { actorId: row.userId, action: "user.password_reset", entityType: "User", entityId: row.userId, ipAddress: await clientIp() });
  });
  if (!result?.ok) return result;
  redirect("/login?reset=1");
}
