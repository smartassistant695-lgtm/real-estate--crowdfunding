import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Button, ButtonLink } from "@/components/ui/button";
import { ActionForm, Input, Select, Submit } from "@/components/ui/form";
import { Facts, Note, Page } from "@/components/ui/primitives";
import { RiskDisclosureText } from "@/components/site/risk-text";
import { cn } from "@/lib/cn";
import { formatCents } from "@/lib/domain/money";
import { onboardingStep, requireUser } from "@/lib/session";
import { US_STATES } from "@/lib/us-states";
import { acceptRiskDisclosureAction, checkKycAction, finishOnboardingAction, fundWalletAction, retryKycAction, saveProfileAction, skipFundingAction, startKycAction } from "./actions";
import { DisclosureGate, FundForm, KycPoller } from "./client";

export const metadata: Metadata = { title: "Set up your account" };

const STEPS = [
  { key: "profile", label: "About you" },
  { key: "identity", label: "Identity check" },
  { key: "disclosure", label: "Risks" },
  { key: "fund", label: "Add funds" },
  { key: "tour", label: "Look around" },
] as const;

export default async function OnboardingPage({ searchParams }: { searchParams: Promise<{ kyc?: string }> }) {
  const user = await requireUser();
  if (user.role === "ADMIN") redirect("/admin");
  const step = onboardingStep(user);
  if (step === "done") redirect("/portfolio");
  const { kyc } = await searchParams;
  const index = STEPS.findIndex((s) => s.key === step);

  return (
    <Page narrow className="pb-8 pt-10 md:pt-16">
      <ol aria-label="Account setup progress" className="mb-10 grid grid-cols-5 gap-2">
        {STEPS.map((s, i) => (
          <li key={s.key} aria-current={i === index ? "step" : undefined} className={cn("border-t-2 pt-2", i <= index ? "border-ink" : "border-rule")}>
            <span className={cn("label", i === index && "text-ink!")}>
              <span className="num mr-1.5">{i + 2}</span>
              <span className="hidden sm:inline">{s.label}</span>
            </span>
            {i < index ? <span className="sr-only"> (done)</span> : null}
          </li>
        ))}
      </ol>

      {step === "profile" ? (
        <section>
          <h1 className="text-2xl">About you</h1>
          <p className="mt-3 max-w-prose text-ink-soft">We need your legal name, where you live, and your date of birth to check your identity. Investing rules also differ by state.</p>
          <ActionForm action={saveProfileAction} className="mt-8 max-w-md space-y-5">
            <Input label="Full legal name" name="name" autoComplete="name" defaultValue={user.name} required />
            <Select label="State of residence" name="state" defaultValue={user.state ?? ""} required>
              <option value="" disabled>Choose a state</option>
              {Object.entries(US_STATES).map(([code, name]) => (
                <option key={code} value={code}>{name}</option>
              ))}
            </Select>
            <Input label="Date of birth" name="dateOfBirth" type="date" autoComplete="bday" required defaultValue={user.dateOfBirth?.toISOString().slice(0, 10)} />
            <Submit size="lg">Continue</Submit>
          </ActionForm>
        </section>
      ) : null}

      {step === "identity" ? (
        <section>
          <h1 className="text-2xl">Identity check</h1>
          {user.kycStatus === "NOT_STARTED" ? (
            <>
              <p className="mt-3 max-w-prose text-ink-soft">
                Financial platforms must confirm who their customers are. In a live product this step would ask for a photo ID and check it against official records. In this demo it is simulated: we use the details below and approve after a short pause.
              </p>
              <Facts className="mt-6 max-w-md" rows={[
                { label: "Name", value: user.name },
                { label: "State", value: US_STATES[user.state ?? ""] ?? "" },
                { label: "Date of birth", value: user.dateOfBirth?.toLocaleDateString("en-US", { timeZone: "UTC", dateStyle: "long" }) ?? "" },
              ]} />
              {kyc === "limit" ? <Note tone="loss" className="mt-6">Too many attempts. Please try again in an hour.</Note> : null}
              <form action={startKycAction} className="mt-8">
                <Button type="submit" size="lg">Verify my identity</Button>
              </form>
              <p className="mt-4 text-xs text-stone">Demo tip: an email address containing “+reject@” is always rejected, so you can see that path.</p>
            </>
          ) : null}
          {user.kycStatus === "PENDING" ? <div className="mt-8"><KycPoller check={checkKycAction} /></div> : null}
          {user.kycStatus === "REJECTED" ? (
            <>
              <Note tone="loss" title="We could not verify your identity" className="mt-6">
                The details you gave did not match our records, so you cannot invest yet. This does not affect your credit. If you think this is a mistake, check your details and try again, or contact support.
              </Note>
              <form action={retryKycAction} className="mt-6">
                <Button type="submit" variant="secondary">Try again</Button>
              </form>
            </>
          ) : null}
        </section>
      ) : null}

      {step === "disclosure" ? (
        <section>
          <h1 className="text-2xl">Understand the risks</h1>
          <p className="mb-6 mt-3 max-w-prose text-ink-soft">Read this through to the end. It is written to be understood, not to be skipped.</p>
          <DisclosureGate action={acceptRiskDisclosureAction}>
            <RiskDisclosureText />
          </DisclosureGate>
        </section>
      ) : null}

      {step === "fund" ? (
        <section>
          <h1 className="text-2xl">Add funds</h1>
          <p className="mb-8 mt-3 max-w-prose text-ink-soft">Your wallet holds cash until you invest it, and receives your dividends. The smallest investment is $26.</p>
          <FundForm action={fundWalletAction} />
          <form action={skipFundingAction} className="mt-6">
            <button type="submit" className="text-sm text-ink-soft underline decoration-rule underline-offset-4 hover:text-ink">Skip for now</button>
          </form>
        </section>
      ) : null}

      {step === "tour" ? (
        <section>
          <h1 className="text-2xl">You are set up</h1>
          <p className="mt-3 max-w-prose text-ink-soft">
            {user.wallet && user.wallet.availableCents > 0n ? `You have ${formatCents(user.wallet.availableCents)} ready to invest. ` : ""}
            Here is where things are.
          </p>
          <dl className="mt-8 border-t border-ink">
            {[
              ["Properties", "Every home on the platform, with its numbers, documents and risks. Buy shares in homes that are still funding."],
              ["Portfolio", "What you own, what it is worth at the appraised value and at the last traded price, and the dividends you have been paid."],
              ["Orders", "Buy or sell shares with other investors during the first seven days of each month."],
              ["Votes", "Major decisions about homes you own, such as selling one, are put to a vote."],
              ["Wallet", "Your cash. Dividends arrive here. Add or withdraw simulated funds any time."],
            ].map(([t, d]) => (
              <div key={t} className="grid gap-1 border-b border-rule py-4 sm:grid-cols-[9rem_1fr]">
                <dt className="font-serif text-md">{t}</dt>
                <dd className="text-sm text-ink-soft">{d}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-8 flex flex-wrap gap-3">
            <form action={finishOnboardingAction}>
              <input type="hidden" name="to" value="properties" />
              <Button type="submit" size="lg">Browse properties</Button>
            </form>
            <form action={finishOnboardingAction}>
              <Button type="submit" size="lg" variant="secondary">Go to my portfolio</Button>
            </form>
          </div>
        </section>
      ) : null}

      <p className="mt-12 text-xs text-stone">
        Need to stop? Your progress is saved. <Link href="/properties" className="link">Browse properties</Link> in the meantime.
      </p>
    </Page>
  );
}
