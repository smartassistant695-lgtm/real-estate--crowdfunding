import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ActionForm, Input, Submit } from "@/components/ui/form";
import { Note } from "@/components/ui/primitives";
import { currentUser } from "@/lib/session";
import { logInAction } from "../actions";

export const metadata: Metadata = { title: "Log in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ reset?: string }> }) {
  if (await currentUser()) redirect("/start");
  const { reset } = await searchParams;
  return (
    <>
      <p className="label mb-3">Welcome back</p>
      <h1 className="text-2xl">Log in</h1>
      {reset ? <Note className="mt-6" tone="neutral">Your password was changed. Log in with the new one.</Note> : null}
      <ActionForm action={logInAction} className="mt-8 space-y-5">
        <Input label="Email" name="email" type="email" autoComplete="email" required />
        <Input label="Password" name="password" type="password" autoComplete="current-password" required />
        <Submit size="lg" className="w-full" pendingLabel="Logging in…">Log in</Submit>
      </ActionForm>
      <div className="mt-6 flex justify-between text-sm">
        <Link href="/forgot-password" className="link">Forgot your password?</Link>
        <Link href="/signup" className="link">Open an account</Link>
      </div>
    </>
  );
}
