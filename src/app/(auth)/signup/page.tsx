import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ActionForm, Input, Submit } from "@/components/ui/form";
import { currentUser } from "@/lib/session";
import { signUpAction } from "../actions";

export const metadata: Metadata = { title: "Open an account" };

export default async function SignupPage() {
  if (await currentUser()) redirect("/start");
  return (
    <>
      <p className="label mb-3">Step 1 of 5</p>
      <h1 className="text-2xl">Open an account</h1>
      <p className="mt-3 text-ink-soft">It takes about three minutes. This is a demo: you will fund your account with simulated money.</p>
      <ActionForm action={signUpAction} className="mt-8 space-y-5">
        <Input label="Email" name="email" type="email" autoComplete="email" required />
        <Input label="Password" name="password" type="password" autoComplete="new-password" required minLength={10} hint="At least 10 characters, with a letter and a number." />
        <Submit size="lg" className="w-full" pendingLabel="Creating your account…">Create account</Submit>
      </ActionForm>
      <p className="mt-6 text-sm text-ink-soft">
        Already have an account? <Link href="/login" className="link text-ink">Log in</Link>
      </p>
      <p className="mt-6 text-xs text-stone">
        By creating an account you agree to the <Link className="link" href="/legal/terms">Terms of Service</Link> and <Link className="link" href="/legal/privacy">Privacy Policy</Link>, both of which are unreviewed drafts in this demo.
      </p>
    </>
  );
}
