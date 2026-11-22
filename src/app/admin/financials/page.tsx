import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ActionForm, Input, Select, Submit, Textarea } from "@/components/ui/form";
import { Badge, Empty, Note, PageHeader, SectionHeading, Table, Td, Th } from "@/components/ui/primitives";
import { prisma } from "@/lib/db";
import { centsToInput, formatBps, formatCents } from "@/lib/domain/money";
import { monthKey, monthLabel } from "@/lib/domain/trading-rules";
import { requireAdmin } from "@/lib/session";
import { previewDividendAction, saveFinancialsAction } from "../actions";

export const metadata = { title: "Financials & dividends" };
const STATUS_TONE = { DRAFT: "notice", APPROVED: "accent", PAID: "neutral" } as const;

export default async function AdminFinancials({ searchParams }: { searchParams: Promise<{ property?: string; month?: string }> }) {
  await requireAdmin();
  const sp = await searchParams;
  const props = await prisma.property.findMany({ where: { status: { in: ["FUNDED", "TRADING", "EXIT_VOTE"] } }, orderBy: { sequence: "asc" } });
  const property = props.find((p) => p.id === sp.property) ?? props[0];
  if (!property) return (<><PageHeader title="Financials & dividends" /><Empty title="No funded properties yet.">Income statements start once a property is funded.</Empty></>);
  const lastMonth = monthKey(new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() - 1, 15)));
  const month = sp.month && /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.month) ? sp.month : lastMonth;
  const [rows, dists, current] = await Promise.all([
    prisma.monthlyFinancials.findMany({ where: { propertyId: property.id }, orderBy: { month: "desc" }, take: 14 }),
    prisma.dividendDistribution.findMany({ where: { propertyId: property.id }, orderBy: { month: "desc" }, take: 14 }),
    prisma.monthlyFinancials.findUnique({ where: { propertyId_month: { propertyId: property.id, month } } }),
  ]);
  const dist = new Map(dists.map((d) => [d.month, d]));
  const thisDist = dist.get(month);
  const locked = thisDist && thisDist.status !== "DRAFT";
  const v = (c?: bigint) => (c === undefined ? "" : centsToInput(c));

  return (
    <>
      <PageHeader title="Financials & dividends" lede="Enter each month’s income statement after month-end. The app works out net income, then the dividend: preview, approve, pay. Nothing is paid without both steps." />
      <form method="get" className="flex flex-wrap items-end gap-4 border-b border-rule py-5">
        <Select label="Property" name="property" defaultValue={property.id} className="min-w-64">
          {props.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </Select>
        <Input label="Month" name="month" type="month" defaultValue={month} max={lastMonth} />
        <Button type="submit" variant="secondary" size="md">Show</Button>
      </form>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-12 pt-10 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <section aria-labelledby="history">
          <SectionHeading id="history">{property.name}: recent months</SectionHeading>
          <Table caption="Monthly financials and dividends">
            <thead><tr><Th>Month</Th><Th num>Gross rent</Th><Th num>Net income</Th><Th num>Occupancy</Th><Th>Dividend</Th></tr></thead>
            <tbody>
              {rows.map((r) => {
                const d = dist.get(r.month);
                return (
                  <tr key={r.id} className={r.month === month ? "bg-paper-deep" : "hover:bg-paper-deep"}>
                    <Td className="py-1"><Link className="link" href={`/admin/financials?property=${property.id}&month=${r.month}`}>{monthLabel(r.month)}</Link></Td>
                    <Td num className="py-1">{formatCents(r.grossRentCents)}</Td>
                    <Td num className={`py-1 ${r.netIncomeCents < 0n ? "text-loss" : ""}`}>{formatCents(r.netIncomeCents)}</Td>
                    <Td num className="py-1">{formatBps(r.occupancyRateBps, { decimals: 0 })}</Td>
                    <Td className="py-1">{d ? <Link href={`/admin/dividends/${d.id}`}><Badge tone={STATUS_TONE[d.status]}>{d.status.toLowerCase()}</Badge></Link> : <span className="text-xs text-stone">none</span>}</Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </section>

        <section aria-labelledby="entry">
          <SectionHeading id="entry">{monthLabel(month)}</SectionHeading>
          {locked ? (
            <Note>This month’s dividend is {thisDist!.status.toLowerCase()}, so its figures are locked. <Link className="link" href={`/admin/dividends/${thisDist!.id}`}>Open the dividend</Link></Note>
          ) : (
            <>
              <ActionForm action={saveFinancialsAction} className="space-y-4">
                <input type="hidden" name="propertyId" value={property.id} />
                <input type="hidden" name="month" value={month} />
                <Input label="Gross rent (scheduled)" name="grossRent" prefix="$" inputMode="decimal" defaultValue={v(current?.grossRentCents)} required />
                <Input label="Vacancy and unpaid rent" name="vacancyLoss" prefix="$" inputMode="decimal" defaultValue={v(current?.vacancyLossCents)} />
                <Input label="Management fee" name="managementFee" prefix="$" inputMode="decimal" defaultValue={v(current?.managementFeeCents)} />
                <Input label="Maintenance and repairs" name="maintenance" prefix="$" inputMode="decimal" defaultValue={v(current?.maintenanceCents)} />
                <Input label="Property taxes" name="taxes" prefix="$" inputMode="decimal" defaultValue={v(current?.taxesCents)} />
                <Input label="Insurance" name="insurance" prefix="$" inputMode="decimal" defaultValue={v(current?.insuranceCents)} />
                <Input label="HOA" name="hoa" prefix="$" inputMode="decimal" defaultValue={v(current?.hoaCents)} />
                <Input label="Other expenses" name="otherExpenses" prefix="$" inputMode="decimal" defaultValue={v(current?.otherExpensesCents)} />
                <Input label="Occupancy" name="occupancy" suffix="%" inputMode="decimal" defaultValue={current ? (current.occupancyRateBps / 100).toFixed(2) : "100"} required />
                <Textarea label="Manager’s notes" name="notes" rows={3} defaultValue={current?.notes} hint="Shown to investors on the Financials tab." />
                <Submit className="w-full sm:w-auto" pendingLabel="Saving…">{current ? "Update figures" : "Save figures"}</Submit>
              </ActionForm>
              {current ? (
                <ActionForm action={previewDividendAction} className="mt-6 border-t border-rule pt-6">
                  <input type="hidden" name="propertyId" value={property.id} />
                  <input type="hidden" name="month" value={month} />
                  <p className="mb-3 text-sm text-ink-soft">Net income {formatCents(current.netIncomeCents)}. Next, see exactly who would be paid what.</p>
                  <Submit variant="secondary" pendingLabel="Working it out…">{thisDist ? "Refresh dividend preview" : "Preview dividend"}</Submit>
                </ActionForm>
              ) : null}
            </>
          )}
        </section>
      </div>
    </>
  );
}
