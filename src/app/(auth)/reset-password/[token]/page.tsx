import type { Metadata } from "next";
import { ActionForm, Input, Submit } from "@/components/ui/form";
import { resetPasswordAction } from "../../actions";

export const metadata: Metadata = { title: "Choose a new password" };

export default async function ResetPasswordPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
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
