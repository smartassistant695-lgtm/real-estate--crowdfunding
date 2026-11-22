import Link from "next/link";
import { Note, PageHeader, SectionHeading, Stat, Table, Td, Th } from "@/components/ui/primitives";
import { prisma } from "@/lib/db";
import { formatCents, formatCentsWhole, valueOfUnits } from "@/lib/domain/money";
import { monthLabel } from "@/lib/domain/trading-rules";
import { daysUntil, fmtDay } from "@/lib/labels";
import { reconcile } from "@/lib/services/ledger";
import { navByProperty } from "@/lib/services/snapshots";
import { requireAdmin } from "@/lib/session";

export default async function AdminHome() {
  await requireAdmin();
  const now = new Date();
  const [props, nav, investors, kycPending, reserves, drafts, approved, windows, closing, offerings, books] = await Promise.all([
    prisma.property.findMany({ select: { id: true, status: true, soldUnits: true, retiredUnits: true, offeringPricePerShareCents: true } }),
    navByProperty(),
    prisma.user.count({ where: { role: "INVESTOR" } }),
    prisma.user.count({ where: { role: "INVESTOR", kycStatus: "PENDING" } }),
    prisma.liquidityReserve.aggregate({ _sum: { balanceCents: true } }),
    prisma.dividendDistribution.findMany({ where: { status: "DRAFT" }, include: { property: { select: { name: true } } }, orderBy: { month: "asc" } }),
    prisma.dividendDistribution.findMany({ where: { status: "APPROVED" }, include: { property: { select: { name: true } } } }),
    prisma.tradingWindow.findMany({ where: { status: { in: ["OPEN", "SCHEDULED"] } }, orderBy: { opensAt: "asc" }, take: 3 }),
    prisma.proposal.findMany({ where: { status: { in: ["OPEN", "DRAFT"] } }, include: { property: { select: { name: true } } }, orderBy: { closesAt: "asc" } }),
    prisma.property.findMany({ where: { status: "FUNDING" }, orderBy: { fundingDeadline: "asc" } }),
    reconcile(),
  ]);
  const live = props.filter((p) => ["FUNDED", "TRADING", "EXIT_VOTE"].includes(p.status));
  const aum = live.reduce((a, p) => a + valueOfUnits(p.soldUnits - p.retiredUnits, nav.get(p.id) ?? p.offeringPricePerShareCents), 0n);
  const tasks = [
    ...drafts.map((d) => ({ href: `/admin/dividends/${d.id}`, text: `Review the ${monthLabel(d.month)} dividend for ${d.property.name}` })),
    ...approved.map((d) => ({ href: `/admin/dividends/${d.id}`, text: `Pay the approved ${monthLabel(d.month)} dividend for ${d.property.name}` })),
    ...closing.filter((p) => p.status === "DRAFT").map((p) => ({ href: `/admin/proposals/${p.id}`, text: `Publish the draft proposal “${p.title}”` })),
    ...closing.filter((p) => p.status === "OPEN" && p.closesAt <= now).map((p) => ({ href: `/admin/proposals/${p.id}`, text: `Record the result of “${p.title}”` })),
    ...(kycPending ? [{ href: "/admin/users?kyc=PENDING", text: `${kycPending} identity ${kycPending === 1 ? "check" : "checks"} waiting` }] : []),
  ];

  return (
    <>
      <PageHeader title="Overview" lede="The state of the platform today. Every figure comes from the ledger." />
      {books.ok ? (
        <Note className="mt-6">Books reconcile: every wallet, holding, reserve and rounding carry matches the ledger, and the ledger sums to zero. Checked just now.</Note>
      ) : (
        <Note tone="loss" className="mt-6" title="The books do not reconcile">
          <ul className="mt-2 list-disc pl-5">{books.issues.slice(0, 8).map((i) => <li key={i}>{i}</li>)}</ul>
        </Note>
      )}
      <dl className="grid grid-cols-2 gap-8 border-b border-rule py-8 lg:grid-cols-4">
        <Stat label="Assets under management" value={formatCentsWhole(aum)} note="Shares outstanding at appraised value" />
        <Stat label="Investors" value={String(investors)} note={kycPending ? `${kycPending} waiting for an identity check` : "No identity checks waiting"} />
        <Stat label="Funded properties" value={String(live.length)} note={`${offerings.length} ${offerings.length === 1 ? "offering" : "offerings"} open`} />
        <Stat label="Liquidity reserves" value={formatCents(reserves._sum.balanceCents ?? 0n)} note="Across all properties" />
      </dl>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-12 pt-10 xl:grid-cols-2">
        <section aria-labelledby="tasks">
          <SectionHeading id="tasks">To do</SectionHeading>
          {tasks.length ? <ul className="text-sm">{tasks.map((t) => <li key={t.href + t.text} className="border-b border-rule py-3"><Link href={t.href} className="link">{t.text}</Link></li>)}</ul> : <p className="text-sm text-stone">Nothing needs attention.</p>}
        </section>
        <section aria-labelledby="calendar">
          <SectionHeading id="calendar">Coming up</SectionHeading>
          <Table caption="Upcoming events">
            <tbody>
              {windows.map((w) => <tr key={w.id}><Td>{w.status === "OPEN" ? `Trading window open through${w.period ? "" : " (demo window)"}` : "Trading window opens"}</Td><Td num>{w.status === "OPEN" ? fmtDay(new Date(w.closesAt.getTime() - 1)) : fmtDay(w.opensAt)} ({daysUntil(w.status === "OPEN" ? w.closesAt : w.opensAt)})</Td></tr>)}
              {offerings.map((o) => <tr key={o.id}><Td>Offering deadline: {o.name}</Td><Td num>{o.fundingDeadline ? `${fmtDay(o.fundingDeadline)} (${daysUntil(o.fundingDeadline)})` : "—"}</Td></tr>)}
              {closing.filter((p) => p.status === "OPEN").map((p) => <tr key={p.id}><Td>Vote closes: {p.property.name}</Td><Td num>{fmtDay(p.closesAt)} ({daysUntil(p.closesAt)})</Td></tr>)}
            </tbody>
          </Table>
          <p className="mt-3 text-xs text-stone">Ledger total: {formatCents(books.ledgerSumCents)} (must be $0.00).</p>
        </section>
      </div>
    </>
  );
}
