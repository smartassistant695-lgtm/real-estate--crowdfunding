import Link from "next/link";
import { notFound } from "next/navigation";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { Badge, Facts, Note, PageHeader, SectionHeading, Table, Td, Th } from "@/components/ui/primitives";
import { prisma } from "@/lib/db";
import { formatPerShare } from "@/lib/domain/dividends";
import { formatCents, formatUnits } from "@/lib/domain/money";
import { monthLabel } from "@/lib/domain/trading-rules";
import { fmtDateTime } from "@/lib/labels";
import { requireAdmin } from "@/lib/session";
import { approveDividendAction, payDividendAction } from "../../actions";

export const metadata = { title: "Dividend" };

export default async function DividendPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const d = await prisma.dividendDistribution.findUnique({ where: { id }, include: { property: true, payments: { include: { user: { select: { name: true, email: true } } }, orderBy: { amountCents: "desc" } } } });
  if (!d) notFound();
  const pool = d.netIncomeCents > 0n ? d.netIncomeCents - d.reserveAllocationCents + d.carryInCents : d.carryInCents;
  const payees = d.payments.filter((p) => p.amountCents > 0n).length;
  const tone = { DRAFT: "notice", APPROVED: "accent", PAID: "neutral" } as const;

  return (
    <>
      <PageHeader back={{ href: `/admin/financials?property=${d.propertyId}&month=${d.month}`, label: "Financials" }} title={`${d.property.name}, ${monthLabel(d.month)} dividend`} lede={`Holders on the record date, ${fmtDateTime(d.recordDate)}, are paid in proportion to their shares.`} actions={<Badge tone={tone[d.status]}>{d.status.toLowerCase()}</Badge>} />
      <div className="grid gap-12 pt-10 xl:grid-cols-[22rem_1fr]">
        <section aria-labelledby="calc">
          <SectionHeading id="calc">The calculation</SectionHeading>
          <Facts rows={[
            { label: "Net income", value: formatCents(d.netIncomeCents) },
            { label: "To liquidity reserve", value: `−${formatCents(d.reserveAllocationCents)}` },
            { label: "Rounding carried in from last month", value: `+${formatCents(d.carryInCents)}` },
            { label: "Available to pay", value: formatCents(pool), strong: true },
            { label: "Shares outstanding", value: formatUnits(d.outstandingUnits, 2, 2) },
            { label: "Per share", value: formatPerShare(d.perShareMicroCents) },
            { label: `Paid to ${payees} holders`, value: formatCents(d.distributedCents), strong: true },
            { label: "Carried to next month", value: formatCents(d.roundingRemainderCents) },
          ]} />
          <p className="mt-3 text-xs text-stone">Cents are allocated by the largest-remainder method: everyone gets their exact share rounded down, then leftover cents go one each to the largest fractions. Whatever cannot be paid in whole cents carries forward.</p>
          <div className="mt-6 flex flex-wrap gap-3">
            {d.status === "DRAFT" ? (
              <ConfirmAction action={approveDividendAction} fields={{ id: d.id }} trigger="Approve" title={`Approve paying ${formatCents(d.distributedCents)} to ${payees} holders?`} body="Approving recalculates from the ledger once more and locks the month’s figures. Paying is a separate step." confirm="Approve" />
            ) : null}
            {d.status === "APPROVED" ? (
              <ConfirmAction action={payDividendAction} idempotent fields={{ id: d.id }} trigger="Pay now" title={`Pay ${formatCents(d.distributedCents)} to ${payees} holders?`} body={<>Each holder’s wallet is credited and they are notified. {formatCents(d.reserveAllocationCents)} goes to the liquidity reserve. This cannot be undone.</>} confirm={`Pay ${formatCents(d.distributedCents)}`} />
            ) : null}
            {d.status === "PAID" ? <Note>Paid {d.paidAt ? fmtDateTime(d.paidAt) : ""}.</Note> : null}
          </div>
        </section>
        <section aria-labelledby="payees">
          <SectionHeading id="payees" aside={<Link href={`/properties/${d.property.slug}?tab=dividends`} className="link">Investor view</Link>}>Per-holder payments</SectionHeading>
          <Table caption="Payments">
            <thead><tr><Th>Holder</Th><Th num>Shares on record date</Th><Th num>Payment</Th></tr></thead>
            <tbody>
              {d.payments.map((p) => <tr key={p.id} className="hover:bg-paper-deep"><Td className="py-1">{p.user.name}<span className="block text-xs text-stone">{p.user.email}</span></Td><Td num className="py-1">{formatUnits(p.shareUnits, 2, 2)}</Td><Td num className="py-1">{formatCents(p.amountCents)}</Td></tr>)}
            </tbody>
            <tfoot><tr className="font-semibold"><td className="py-2">Total</td><td className="num py-2 pr-4 text-right">{formatUnits(d.outstandingUnits, 2, 2)}</td><td className="num py-2 text-right">{formatCents(d.payments.reduce((a, p) => a + p.amountCents, 0n))}</td></tr></tfoot>
          </Table>
        </section>
      </div>
    </>
  );
}
