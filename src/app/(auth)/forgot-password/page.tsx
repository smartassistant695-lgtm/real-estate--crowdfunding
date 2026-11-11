import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm, Input, Submit } from "@/components/ui/form";
import { requestPasswordResetAction } from "../actions";

export const metadata: Metadata = { title: "Reset your password" };

export default function ForgotPasswordPage() {
  return (
    <>
      <h1 className="text-2xl">Reset your password</h1>
      <p className="mt-3 text-ink-soft">Enter the email you signed up with. We will send a link that works for one hour.</p>
      <ActionForm action={requestPasswordResetAction} toastOnSuccess={false} className="mt-8 space-y-5">
        <Input label="Email" name="email" type="email" autoComplete="email" required />
        <Submit size="lg" className="w-full" pendingLabel="Sending…">Send reset link</Submit>
      </ActionForm>
      <p className="mt-6 text-sm"><Link href="/login" className="link">Back to log in</Link></p>
    </>
  );
}
