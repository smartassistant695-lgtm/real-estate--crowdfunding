import { createHash } from "node:crypto";
import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { ActionForm, Input, Submit } from "@/components/ui/form";
import { resetPasswordAction } from "../../actions";

export const metadata: Metadata = { title: "Choose a new password" };

export default async function ResetPasswordPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const row = token.length <= 100 ? await prisma.passwordResetToken.findUnique({ where: { tokenHash: createHash("sha256").update(token).digest("hex") } }) : null;
  if (!row || row.usedAt || row.expiresAt.getTime() < Date.now()) {
    return (
      <>
        <h1 className="text-2xl">This link has expired</h1>
        <p className="mt-3 text-ink-soft">Reset links work once, for one hour. Ask for a new one and use it straight away.</p>
        <p className="mt-6"><Link href="/forgot-password" className="link">Request a new reset link</Link></p>
      </>
    );
  }
  return (
    <>
      <h1 className="text-2xl">Choose a new password</h1>
      <ActionForm action={resetPasswordAction} className="mt-8 space-y-5">
        <input type="hidden" name="token" value={token} />
        <Input label="New password" name="password" type="password" autoComplete="new-password" required minLength={10} hint="At least 10 characters, with a letter and a number." />
        <Submit size="lg" className="w-full" pendingLabel="Saving…">Save new password</Submit>
      </ActionForm>
    </>
  );
}
