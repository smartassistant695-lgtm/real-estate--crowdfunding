import "server-only";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";

/**
 * The signed-in user, read fresh from the database on each request (cached per request).
 * Role and KYC status therefore take effect immediately; the session cookie only identifies.
 */
export const currentUser = cache(async () => {
  const session = await auth();
  const id = session?.user?.id;
  if (!id) return null;
  return prisma.user.findUnique({ where: { id }, include: { wallet: true } });
});

export type SessionUser = NonNullable<Awaited<ReturnType<typeof currentUser>>>;

export async function requireUser(): Promise<SessionUser> {
  const user = await currentUser();
  if (!user) redirect("/login");
  return user;
}

/** An investor who has finished onboarding. Admins are sent to the admin panel. */
export async function requireInvestor(): Promise<SessionUser> {
  const user = await requireUser();
  if (user.role === "ADMIN") redirect("/admin");
  if (!user.onboardingCompletedAt) redirect("/onboarding");
  return user;
}

/** Every admin page and action calls this. Non-admins get a 404, not a hint that the page exists. */
export async function requireAdmin(): Promise<SessionUser> {
  const user = await currentUser();
  if (!user || user.role !== "ADMIN") notFound();
  return user;
}

/** Which onboarding step a user is on. Derived from their record, so it cannot be skipped by URL. */
export function onboardingStep(user: SessionUser): "profile" | "identity" | "disclosure" | "fund" | "tour" | "done" {
  if (!user.name || !user.state || !user.dateOfBirth) return "profile";
  if (user.kycStatus !== "APPROVED") return "identity";
  if (!user.riskDisclosureAcceptedAt) return "disclosure";
  if (!user.fundedAt && !user.onboardingCompletedAt) return "fund";
  if (!user.onboardingCompletedAt) return "tour";
  return "done";
}
