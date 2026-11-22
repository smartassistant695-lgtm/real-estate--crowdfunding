import { ActionForm, Checkbox, Input, Submit } from "@/components/ui/form";
import { Note, PageHeader, SectionHeading } from "@/components/ui/primitives";
import { centsToInput } from "@/lib/domain/money";
import { requireAdmin } from "@/lib/session";
import { getSettings } from "@/lib/settings";
import { updateSettingsAction } from "../actions";

export const metadata = { title: "Settings" };
const pct = (bps: number) => (bps / 100).toFixed(2);

export default async function AdminSettings() {
  await requireAdmin();
  const s = await getSettings();
  return (
    <>
      <PageHeader title="Platform settings" lede="These rules apply to every investor. Each change is recorded in the audit log with the previous values." />
      <Note tone="notice" className="mt-6">Changes apply from now on. Votes already created keep the quorum, threshold and cap they started with. A new holding period applies to existing shares too.</Note>
      <ActionForm action={updateSettingsAction} className="space-y-12 pt-8">
        <fieldset className="space-y-5">
          <SectionHeading>Investing</SectionHeading>
          <div className="grid gap-5 md:grid-cols-2">
            <Input label="Minimum investment per purchase" name="minInvestment" prefix="$" inputMode="decimal" defaultValue={centsToInput(s.minInvestmentCents)} required />
            <Input label="Default annual limit per investor" name="annualLimit" prefix="$" inputMode="decimal" defaultValue={centsToInput(s.annualInvestmentLimitCents)} required hint="Applies to new accounts. Change existing ones under Users." />
          </div>
        </fieldset>
        <fieldset className="space-y-5">
          <SectionHeading>Trading</SectionHeading>
          <div className="grid gap-5 md:grid-cols-2">
            <Input label="Holding period before selling" name="holdingPeriodMonths" suffix="months" inputMode="numeric" defaultValue={s.holdingPeriodMonths} required />
            <Input label="Trading window length (from the 1st)" name="tradingWindowDays" suffix="days" inputMode="numeric" defaultValue={s.tradingWindowDays} required />
            <Input label="Price band around appraised value" name="circuitBreaker" suffix="%" inputMode="decimal" defaultValue={pct(s.circuitBreakerBps)} required />
          </div>
        </fieldset>
        <fieldset className="space-y-5">
          <SectionHeading>Liquidity reserve</SectionHeading>
          <div className="grid gap-5 md:grid-cols-2">
            <Input label="Share of monthly net income to reserve" name="reserveAllocation" suffix="%" inputMode="decimal" defaultValue={pct(s.reserveAllocationBps)} required />
            <Input label="Buyback discount to appraised value" name="buybackDiscount" suffix="%" inputMode="decimal" defaultValue={pct(s.buybackDiscountBps)} required />
            <Input label="Monthly buyback cap per property" name="buybackCap" prefix="$" inputMode="decimal" defaultValue={centsToInput(s.buybackMonthlyCapCents)} required />
          </div>
        </fieldset>
        <fieldset className="space-y-5">
          <SectionHeading>Voting</SectionHeading>
          <div className="grid gap-5 md:grid-cols-3">
            <Input label="Quorum" name="quorum" suffix="%" inputMode="decimal" defaultValue={pct(s.proposalQuorumBps)} required hint="Share of outstanding shares that must vote." />
            <Input label="Passes above" name="passThreshold" suffix="%" inputMode="decimal" defaultValue={pct(s.proposalPassThresholdBps)} required hint="Of for + against votes." />
            <Input label="Voting cap per holder" name="votingCap" suffix="%" inputMode="decimal" defaultValue={pct(s.votingCapBps)} required />
          </div>
        </fieldset>
        <Checkbox name="confirm" label="I understand these changes affect every investor and will be logged." required />
        <Submit size="lg" className="w-full sm:w-auto" pendingLabel="Saving…">Save settings</Submit>
      </ActionForm>
    </>
  );
}
