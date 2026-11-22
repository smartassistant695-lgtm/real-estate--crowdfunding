import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BRAND } from "@/config/brand";
import { Wordmark } from "@/components/site/wordmark";
import { PrintButton } from "@/components/ui/print-button";
import { prisma } from "@/lib/db";
import { formatCents, formatUnits, valueOfUnits } from "@/lib/domain/money";
import { endOfMonth, monthKey, monthLabel } from "@/lib/domain/trading-rules";
import { fmtDate, fmtDateLong, LEDGER_TYPE } from "@/lib/labels";
import { requireInvestor } from "@/lib/session";
import { US_STATES } from "@/lib/us-states";

export const metadata: Metadata = { title: "Statement" };

const money = (c: bigint) => (c < 0n ? `(${formatCents(-c)})` : formatCents(c)); // accounting style: negatives in parentheses

export default async function StatementPage({ params }: { params: Promise<{ month: string }> }) {
  const user = await requireInvestor();
  const { month } = await params;
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || month >= monthKey(new Date())) notFound();
  const [y, m] = month.split("-").map(Number) as [number, number];
  const start = new Date(Date.UTC(y, m - 1, 1));
  const end = endOfMonth(month);
  const base = { userId: user.id, account: "USER_WALLET" as const };

  const [opening, entries, unitsAtEnd, props, appraisals] = await Promise.all([
    prisma.ledgerEntry.aggregate({ where: { ...base, createdAt: { lt: start } }, _sum: { amountCents: true } }),
    prisma.ledgerEntry.findMany({ where: { ...base, createdAt: { gte: start, lte: end } }, orderBy: { seq: "asc" } }),
    prisma.ledgerEntry.groupBy({ by: ["propertyId"], where: { ...base, shareUnits: { not: null }, createdAt: { lte: end } }, _sum: { shareUnits: true } }),
    prisma.property.findMany({ select: { id: true, name: true, city: true, state: true, entityName: true, offeringPricePerShareCents: true } }),
    prisma.appraisal.findMany({ where: { effectiveDate: { lte: end } }, orderBy: [{ effectiveDate: "asc" }, { createdAt: "asc" }], select: { propertyId: true, navPerShareCents: true, effectiveDate: true } }),
  ]);
  if (entries.length === 0 && (opening._sum.amountCents ?? 0n) === 0n) notFound();

  const openingCash = opening._sum.amountCents ?? 0n;
  const sum = (types: string[]) => entries.filter((e) => types.includes(e.type)).reduce((a, e) => a + e.amountCents, 0n);
  const summary: [string, bigint][] = [
    ["Deposits", sum(["DEPOSIT"])],
    ["Withdrawals", sum(["WITHDRAWAL"])],
    ["Shares purchased", sum(["PRIMARY_PURCHASE", "TRADE_BUY"])],
    ["Shares sold", sum(["TRADE_SELL", "BUYBACK_SALE", "EXIT_PROCEEDS"])],
    ["Dividends received", sum(["DIVIDEND"])],
    ["Refunds and adjustments", sum(["REFUND", "ADJUSTMENT", "FEE"])],
  ];
  const closingCash = openingCash + entries.reduce((a, e) => a + e.amountCents, 0n);

  const nav = new Map<string, { price: bigint; asOf: Date | null }>();
  for (const p of props) nav.set(p.id, { price: p.offeringPricePerShareCents, asOf: null });
  for (const a of appraisals) nav.set(a.propertyId, { price: a.navPerShareCents, asOf: a.effectiveDate });
  const holdings = unitsAtEnd
    .filter((u) => u.propertyId && (u._sum.shareUnits ?? 0n) > 0n)
    .map((u) => {
      const p = props.find((x) => x.id === u.propertyId)!;
      const n = nav.get(p.id)!;
      const units = u._sum.shareUnits ?? 0n;
      return { p, units, price: n.price, asOf: n.asOf, value: valueOfUnits(units, n.price) };
    })
    .sort((a, b) => (a.p.name < b.p.name ? -1 : 1));
  const holdingsValue = holdings.reduce((a, h) => a + h.value, 0n);
  let running = openingCash;

  const th = "border-b border-ink py-2 text-left text-xs font-medium uppercase tracking-[0.08em] text-stone";
  const td = "border-b border-rule py-2 align-top";

  return (
    <div className="mx-auto max-w-[52rem] px-4 pb-8 pt-8 print:max-w-none print:p-0">
      <div className="no-print mb-6 flex items-center justify-between">
        <Link href="/portfolio/statements" className="link text-sm">All statements</Link>
        <PrintButton />
      </div>

      {/* The sheet */}
      <article className="border border-rule bg-white px-6 py-8 text-sm leading-snug text-ink sm:px-12 sm:py-12 print:border-0 print:p-0">
        <header className="flex items-start justify-between border-b-2 border-ink pb-5">
          <div>
            <Wordmark href={null} size="lg" />
            <p className="mt-3 text-xs text-stone">{BRAND.legalName}</p>
          </div>
          <div className="text-right">
            <p className="font-serif text-xl">Account statement</p>
            <p className="num mt-1">{fmtDateLong(start)} – {fmtDateLong(end)}</p>
          </div>
        </header>

        <section className="grid grid-cols-2 gap-8 border-b border-rule py-5">
          <div>
            <p className="label">Account holder</p>
            <p className="mt-1 font-medium">{user.name}</p>
            <p className="text-ink-soft">{user.email}</p>
            {user.state ? <p className="text-ink-soft">{US_STATES[user.state]}</p> : null}
          </div>
          <div className="text-right">
            <p className="label">Account</p>
            <p className="num mt-1">{user.id.slice(-10).toUpperCase()}</p>
            <p className="label mt-3">Statement date</p>
            <p className="num mt-1">{fmtDate(new Date(end.getTime() + 1))}</p>
          </div>
        </section>

        <section className="grid gap-8 py-6 sm:grid-cols-2">
          <div>
            <h2 className="mb-2 font-sans text-xs font-semibold uppercase tracking-[0.08em]">Account value</h2>
            <table className="num w-full">
              <tbody>
                <tr><td className={td}>Cash</td><td className={`${td} text-right`}>{money(closingCash)}</td></tr>
                <tr><td className={td}>Shares, at appraised value</td><td className={`${td} text-right`}>{money(holdingsValue)}</td></tr>
                <tr className="font-semibold"><td className="border-b-2 border-ink py-2">Total, {fmtDate(end)}</td><td className="border-b-2 border-ink py-2 text-right">{money(closingCash + holdingsValue)}</td></tr>
              </tbody>
            </table>
          </div>
          <div>
            <h2 className="mb-2 font-sans text-xs font-semibold uppercase tracking-[0.08em]">Cash summary</h2>
            <table className="num w-full">
              <tbody>
                <tr><td className={td}>Opening cash balance</td><td className={`${td} text-right`}>{money(openingCash)}</td></tr>
                {summary.filter(([, v]) => v !== 0n).map(([label, v]) => (
                  <tr key={label}><td className={td}>{label}</td><td className={`${td} text-right`}>{money(v)}</td></tr>
                ))}
                <tr className="font-semibold"><td className="border-b-2 border-ink py-2">Closing cash balance</td><td className="border-b-2 border-ink py-2 text-right">{money(closingCash)}</td></tr>
              </tbody>
            </table>
          </div>
        </section>

        <section className="py-4">
          <h2 className="mb-2 font-sans text-xs font-semibold uppercase tracking-[0.08em]">Holdings at {fmtDate(end)}</h2>
          {holdings.length === 0 ? <p className="text-ink-soft">No shares held at month-end.</p> : (
            <table className="w-full">
              <thead><tr><th className={th}>Security</th><th className={`${th} text-right`}>Shares</th><th className={`${th} text-right`}>Appraised / share</th><th className={`${th} text-right`}>Value</th></tr></thead>
              <tbody>
                {holdings.map((h) => (
                  <tr key={h.p.id}>
                    <td className={td}>{h.p.entityName}<span className="block text-xs text-stone">{h.p.name}, {h.p.city}, {h.p.state}</span></td>
                    <td className={`${td} num text-right`}>{formatUnits(h.units, 6)}</td>
                    <td className={`${td} num text-right`}>{formatCents(h.price)}<span className="block text-xs text-stone">{h.asOf ? `as of ${fmtDate(h.asOf)}` : "offering price"}</span></td>
                    <td className={`${td} num text-right`}>{money(h.value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="py-4">
          <h2 className="mb-2 font-sans text-xs font-semibold uppercase tracking-[0.08em]">Activity</h2>
          {entries.length === 0 ? <p className="text-ink-soft">No activity this month.</p> : (
            <table className="w-full">
              <thead><tr><th className={th}>Date</th><th className={th}>Type</th><th className={th}>Description</th><th className={`${th} text-right`}>Amount</th><th className={`${th} pl-4 text-right`}>Cash balance</th></tr></thead>
              <tbody>
                {entries.map((e) => {
                  running += e.amountCents;
                  return (
                    <tr key={e.id} className="break-inside-avoid">
                      <td className={`${td} num whitespace-nowrap pr-3`}>{fmtDate(e.createdAt).replace(`, ${y}`, "")}</td>
                      <td className={`${td} whitespace-nowrap pr-3`}>{LEDGER_TYPE[e.type]}</td>
                      <td className={`${td} pr-3 text-ink-soft`}>{e.memo}</td>
                      <td className={`${td} num text-right`}>{money(e.amountCents)}</td>
                      <td className={`${td} num text-right`}>{money(running)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>

        <footer className="mt-6 border-t border-ink pt-4 text-xs leading-relaxed text-stone">
          <p>
            Share values use the most recent independent appraisal on or before the statement date and are estimates, not prices at which shares can be sold. Amounts in parentheses are money leaving your cash balance. This statement is generated from the account ledger.
          </p>
          <p className="mt-2">{BRAND.investingDisclosure} All balances on this statement are simulated.</p>
        </footer>
      </article>
    </div>
  );
}
