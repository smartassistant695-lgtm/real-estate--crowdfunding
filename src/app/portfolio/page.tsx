import type { Metadata } from "next";
import Link from "next/link";
import { TimeSeriesChart } from "@/components/charts/charts";
import { ChartFrame } from "@/components/charts/frame";
import { InvestingDisclosure } from "@/components/site/footer";
import { ButtonLink } from "@/components/ui/button";
import { CountUpDollars } from "@/components/ui/count-up";
import { Empty, Money, Note, Page, SectionHeading, Stat, Table, Td, Th } from "@/components/ui/primitives";
import { prisma } from "@/lib/db";
import { centsToNumber, formatBps, formatCents, formatUnits, ratioBps } from "@/lib/domain/money";
import { monthLabel } from "@/lib/domain/trading-rules";
import { daysUntil, fmtDate, fmtDay, LEDGER_TYPE, PROPERTY_STATUS } from "@/lib/labels";
import { loadPortfolio } from "@/lib/portfolio";
import { requireInvestor } from "@/lib/session";

export const metadata: Metadata = { title: "Portfolio" };

export default async function PortfolioPage({ searchParams }: { searchParams: Promise<{ bought?: string }> }) {
  const user = await requireInvestor();
  const { bought } = await searchParams;
  const now = new Date();
  const pf = await loadPortfolio(user.id, now);
  const propertyIds = pf.rows.map((r) => r.property.id);

  const [snapshots, flows, activity, openWindow, nextWindow, openProposals, pendingDividends, myVotes] = await Promise.all([
    prisma.portfolioSnapshot.findMany({ where: { userId: user.id, date: { gte: new Date(now.getTime() - 365 * 86_400_000) } }, orderBy: { date: "asc" } }),
    prisma.ledgerEntry.aggregate({ where: { userId: user.id, account: "USER_WALLET", type: { in: ["DEPOSIT", "WITHDRAWAL", "ADJUSTMENT"] } }, _sum: { amountCents: true } }),
    prisma.ledgerEntry.findMany({ where: { userId: user.id, account: "USER_WALLET" }, orderBy: { seq: "desc" }, take: 8, include: { property: { select: { name: true, slug: true } } } }),
    prisma.tradingWindow.findFirst({ where: { status: "OPEN", closesAt: { gt: now } }, orderBy: { closesAt: "asc" } }),
    prisma.tradingWindow.findFirst({ where: { status: "SCHEDULED", closesAt: { gt: now } }, orderBy: { opensAt: "asc" } }),
    prisma.proposal.findMany({ where: { status: "OPEN", propertyId: { in: propertyIds } }, include: { property: { select: { name: true } } }, orderBy: { closesAt: "asc" } }),
    prisma.dividendDistribution.findMany({ where: { status: { in: ["DRAFT", "APPROVED"] }, propertyId: { in: propertyIds } }, include: { property: { select: { name: true } } }, orderBy: { month: "asc" } }),
    prisma.vote.findMany({ where: { userId: user.id, proposal: { status: "OPEN" } }, select: { proposalId: true } }),
  ]);
  const netDeposited = flows._sum.amountCents ?? 0n;
  const gain = pf.totalCents - netDeposited;
  const gainBps = netDeposited > 0n ? ratioBps(gain, netDeposited) : 0;
  const voted = new Set(myVotes.map((v) => v.proposalId));
  const series = snapshots.map((s) => ({ t: s.date.getTime(), a: centsToNumber(s.totalCents), b: centsToNumber(s.holdingsCents) }));
  const first = snapshots[0], lastSnap = snapshots[snapshots.length - 1];

  return (
    <Page className="pb-8">
      {bought ? <Note className="mt-8" title="Purchase confirmed">Your shares are in your portfolio below. Your money stays in escrow until the offering is fully funded.</Note> : null}

      {/* Headline: one large figure, the rest on a ruled row */}
      <header className="grid gap-8 border-b border-ink pb-8 pt-10 md:grid-cols-[1.2fr_2fr] md:items-end md:pt-14">
        <div>
          <p className="label">Total account value</p>
          <p className="num mt-2 font-serif text-3xl tracking-figure sm:text-4xl">
            <CountUpDollars cents={pf.totalCents.toString()} />
          </p>
          <p className="mt-2 text-sm text-ink-soft">Shares at appraised value, plus cash. {user.name ? `Account of ${user.name}.` : ""}</p>
        </div>
        <dl className="grid grid-cols-2 gap-x-8 gap-y-6 sm:grid-cols-4">
          <Stat label="Cash available" value={formatCents(pf.wallet.availableCents)} note={pf.wallet.heldCents > 0n ? `${formatCents(pf.wallet.heldCents)} held for orders` : undefined} size="sm" />
          <Stat label="Invested" value={formatCents(pf.investedCents)} note="Cost of shares you hold" size="sm" />
          <Stat label="Dividends earned" value={formatCents(pf.dividendsCents)} size="sm" />
          <Stat label="Overall gain / loss" value={formatCents(gain, { sign: true })} tone={gain > 0n ? "gain" : gain < 0n ? "loss" : undefined} note={`${formatBps(gainBps, { sign: true })} on ${formatCents(netDeposited, { whole: true })} deposited`} size="sm" />
        </dl>
      </header>

      {pf.rows.length === 0 ? (
        <Empty title="You do not own any shares yet." action={<ButtonLink href="/properties">Browse properties</ButtonLink>}>
          {pf.wallet.availableCents > 0n ? `You have ${formatCents(pf.wallet.availableCents)} ready. ` : ""}Pick a home that is open for investment and buy from $26. It will show up here straight away.
        </Empty>
      ) : (
        <>
          <div className="grid gap-12 pt-10 lg:grid-cols-[1fr_20rem]">
            <section aria-label="Value over time">
              {series.length > 1 && first && lastSnap ? (
                <ChartFrame
                  title="Account value, last 12 months"
                  summary={`From ${formatCents(first.totalCents)} on ${fmtDate(first.date)} to ${formatCents(lastSnap.totalCents)} on ${fmtDate(lastSnap.date)}. Includes deposits and withdrawals, so a step up may simply be money you added.`}
                  keys={[{ label: "Total (shares + cash)", style: "accent" }, { label: "Shares at appraised value", style: "ink-dashed" }]}
                  table={{ head: ["Date", "Total", "Shares"], rows: snapshots.filter((_, i) => i % 7 === 0 || i === snapshots.length - 1).map((s) => [fmtDate(s.date), formatCents(s.totalCents), formatCents(s.holdingsCents)]) }}
                >
                  <TimeSeriesChart data={series} names={{ a: "Total", b: "Shares" }} />
                </ChartFrame>
              ) : (
                <Note>Your value-over-time chart starts after the first nightly snapshot.</Note>
              )}
            </section>

            <aside aria-labelledby="upcoming">
              <SectionHeading id="upcoming">Coming up</SectionHeading>
              <ul className="text-sm">
                <li className="border-b border-rule py-3">
                  <p className="label">Trading window</p>
                  {openWindow ? <p className="mt-1">Open now, until {fmtDay(new Date(openWindow.closesAt.getTime() - 1))} ({daysUntil(openWindow.closesAt)}). <Link href="/orders" className="link">Your orders</Link></p> : nextWindow ? <p className="mt-1">Opens {fmtDay(nextWindow.opensAt)} ({daysUntil(nextWindow.opensAt)}) for {Math.round((nextWindow.closesAt.getTime() - nextWindow.opensAt.getTime()) / 86_400_000)} days.</p> : <p className="mt-1 text-ink-soft">Not yet scheduled.</p>}
                </li>
                <li className="border-b border-rule py-3">
                  <p className="label">Next dividends</p>
                  {pendingDividends.length ? pendingDividends.map((d) => (
                    <p key={d.id} className="mt-1">{monthLabel(d.month)} rent from {d.property.name}: <span className="text-ink-soft">{d.status === "APPROVED" ? "approved, payment pending" : "being reviewed"}</span></p>
                  )) : <p className="mt-1 text-ink-soft">Each month’s rent is reported after month-end, reviewed, then paid, usually around the 10th.</p>}
                </li>
                <li className="py-3">
                  <p className="label">Votes</p>
                  {openProposals.length ? openProposals.map((p) => (
                    <p key={p.id} className="mt-1">
                      <Link href={`/proposals/${p.id}`} className="link">{p.title}</Link>
                      <span className="block text-xs text-stone">{p.property.name} · closes {daysUntil(p.closesAt)} · {voted.has(p.id) ? "you have voted" : "you have not voted"}</span>
                    </p>
                  )) : <p className="mt-1 text-ink-soft">Nothing is open for a vote.</p>}
                </li>
              </ul>
            </aside>
          </div>

          <section className="pt-14" aria-labelledby="holdings">
            <SectionHeading id="holdings" aside="Two values are shown because they answer different questions">Holdings</SectionHeading>
            <Table caption="Your holdings">
              <thead>
                <tr>
                  <Th>Property</Th>
                  <Th num>Shares</Th>
                  <Th num>Cost basis</Th>
                  <Th num>Value at appraisal</Th>
                  <Th num>Value at last trade</Th>
                  <Th num>Dividends</Th>
                  <Th>Sellable</Th>
                </tr>
              </thead>
              <tbody>
                {pf.rows.map((r) => {
                  const delta = r.valueAtNavCents - r.holding.costBasisCents;
                  const st = r.property.status;
                  return (
                    <tr key={r.holding.id}>
                      <Td>
                        <Link href={`/properties/${r.property.slug}`} className="font-medium underline-offset-4 hover:underline">{r.property.name}</Link>
                        <span className="block text-xs text-stone">{r.property.city}, {r.property.state} · {PROPERTY_STATUS[st].label}</span>
                      </Td>
                      <Td num>{formatUnits(r.holding.shareUnits)}</Td>
                      <Td num>{formatCents(r.holding.costBasisCents)}</Td>
                      <Td num>
                        {formatCents(r.valueAtNavCents)}
                        <span className="block text-xs"><Money cents={delta} gainLoss /></span>
                      </Td>
                      <Td num>{r.valueAtLastTradeCents !== null ? formatCents(r.valueAtLastTradeCents) : <span className="text-stone">No trades</span>}</Td>
                      <Td num>{formatCents(r.dividendsCents)}</Td>
                      <Td className="text-xs">
                        {st === "FUNDING" ? <span className="text-ink-soft">After the offering closes, plus {pf.settings.holdingPeriodMonths} months</span> : (
                          <>
                            <span className="num">{formatUnits(r.sellableUnits)}</span> now
                            {r.nextSellable ? <span className="block text-stone"><span className="num">{formatUnits(r.nextSellable.units)}</span> from {fmtDate(r.nextSellable.at)}</span> : null}
                            {st === "TRADING" ? <Link href={`/properties/${r.property.slug}/trade`} className="link mt-1 block">Trade</Link> : null}
                          </>
                        )}
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="font-medium">
                  <td className="py-2">Total</td>
                  <td />
                  <td className="num py-2 pr-4 text-right">{formatCents(pf.investedCents)}</td>
                  <td className="num py-2 pr-4 text-right">{formatCents(pf.holdingsValueCents)}</td>
                  <td />
                  <td className="num py-2 pr-4 text-right">{formatCents(pf.rows.reduce((a, r) => a + r.dividendsCents, 0n))}</td>
                  <td />
                </tr>
              </tfoot>
            </Table>
            <div className="mt-5 grid gap-6 text-xs text-stone sm:grid-cols-2">
              <p><strong className="font-medium text-ink-soft">Value at appraisal</strong> uses the latest independent appraisal. It is an estimate of worth, not an offer to buy.</p>
              <p><strong className="font-medium text-ink-soft">Value at last trade</strong> uses the most recent price two investors agreed on. It is real, but may be old and for a small quantity. You might get more or less.</p>
            </div>
          </section>
        </>
      )}

      <section className="pt-14" aria-labelledby="activity">
        <SectionHeading id="activity" aside={<span className="flex gap-4"><Link href="/portfolio/activity" className="link">All activity</Link><Link href="/portfolio/statements" className="link">Statements</Link></span>}>Recent activity</SectionHeading>
        {activity.length === 0 ? <p className="py-4 text-sm text-stone">Nothing yet.</p> : (
          <Table caption="Recent activity">
            <tbody>
              {activity.map((e) => (
                <tr key={e.id}>
                  <Td className="num w-28 text-ink-soft whitespace-nowrap">{fmtDate(e.createdAt)}</Td>
                  <Td className="w-32">{LEDGER_TYPE[e.type]}</Td>
                  <Td className="text-ink-soft">{e.memo}</Td>
                  <Td num><Money cents={e.amountCents} sign /></Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </section>
      <InvestingDisclosure />
    </Page>
  );
}
