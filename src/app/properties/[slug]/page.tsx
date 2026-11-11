import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { MonthlyBars, TimeSeriesChart, type SeriesPoint } from "@/components/charts/charts";
import { ChartFrame } from "@/components/charts/frame";
import { InvestingDisclosure } from "@/components/site/footer";
import { OrderBook, RecentTrades } from "@/components/site/order-book";
import { ButtonLink } from "@/components/ui/button";
import { Badge, Empty, Facts, Note, Page, SectionHeading, Table, Tabs, Td, Th } from "@/components/ui/primitives";
import { prisma } from "@/lib/db";
import { formatPerShare } from "@/lib/domain/dividends";
import { centsToNumber, formatBps, formatCents, formatCentsWhole, formatUnits, ratioBps } from "@/lib/domain/money";
import { monthLabel } from "@/lib/domain/trading-rules";
import { daysUntil, DOCUMENT_CATEGORY, fmtDate, fmtDay, PROPERTY_STATUS, PROPERTY_TYPE, PROPOSAL_STATUS, PROPOSAL_TYPE } from "@/lib/labels";
import { nextWindowFor, openWindowFor } from "@/lib/services/trading";
import { currentUser } from "@/lib/session";
import { getSettings } from "@/lib/settings";

type Params = { params: Promise<{ slug: string }>; searchParams: Promise<{ tab?: string }> };

async function load(slug: string) {
  return prisma.property.findUnique({
    where: { slug },
    include: { photos: { orderBy: { position: "asc" } }, appraisals: { orderBy: [{ effectiveDate: "asc" }, { createdAt: "asc" }] }, reserve: true },
  });
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const p = await load((await params).slug);
  return p ? { title: `${p.name}, ${p.city} ${p.state}`, description: p.description.slice(0, 150) } : {};
}

export default async function PropertyPage({ params, searchParams }: Params) {
  const [{ slug }, sp] = await Promise.all([params, searchParams]);
  const p = await load(slug);
  if (!p) notFound();
  const [user, settings] = await Promise.all([currentUser(), getSettings()]);

  const status = PROPERTY_STATUS[p.status];
  const appraisal = p.appraisals[p.appraisals.length - 1];
  const outstanding = p.soldUnits - p.retiredUnits;
  const raise = p.purchasePriceCents + p.closingCostsCents + p.reserveFundCents;
  const fundedBps = ratioBps(p.soldUnits, p.totalUnits);
  const live = ["FUNDED", "TRADING", "EXIT_VOTE", "SOLD"].includes(p.status);
  const latestFin = live ? await prisma.monthlyFinancials.findFirst({ where: { propertyId: p.id }, orderBy: { month: "desc" } }) : null;
  const holding = user ? await prisma.holding.findUnique({ where: { userId_propertyId: { userId: user.id, propertyId: p.id } } }) : null;
  const exitPayout = user && p.status === "SOLD" ? await prisma.exitPayout.findUnique({ where: { propertyId_userId: { propertyId: p.id, userId: user.id } } }) : null;

  const tabs = [
    { key: "overview", label: "Overview" },
    ...(live ? [{ key: "financials", label: "Financials" }, { key: "dividends", label: "Dividends" }] : []),
    { key: "documents", label: "Documents" },
    ...(live ? [{ key: "governance", label: "Votes" }] : []),
    ...(p.status === "TRADING" ? [{ key: "trading", label: "Trading" }] : []),
  ].map((t) => ({ ...t, href: `/properties/${p.slug}${t.key === "overview" ? "" : `?tab=${t.key}`}` }));
  const tab = tabs.some((t) => t.key === sp.tab) ? sp.tab! : "overview";
  const gated = !user && tab !== "overview";

  const [hero, ...rest] = p.photos;
  const credits = [...new Set(p.photos.map((ph) => ph.credit).filter(Boolean))];

  return (
    <Page className="pb-8">
      {/* Masthead */}
      <header className="grid gap-4 pb-6 pt-8 md:grid-cols-[1fr_auto] md:items-end md:pt-12">
        <div>
          <p className="label mb-3 flex flex-wrap items-center gap-x-3 gap-y-1">
            <Link href="/properties" className="hover:text-ink">Properties</Link>
            <span aria-hidden>/</span>
            <span>No. {String(p.sequence).padStart(3, "0")}</span>
            <span aria-hidden>·</span>
            <span>{PROPERTY_TYPE[p.propertyType]}</span>
          </p>
          <h1 className="text-3xl md:text-4xl">{p.name}</h1>
          <p className="mt-2 text-md text-ink-soft">{p.street}, {p.city}, {p.state} {p.zip}</p>
        </div>
        <div className="md:text-right">
          <Badge tone={status.tone}>{status.label}</Badge>
          <p className="mt-2 max-w-xs text-xs text-stone md:ml-auto">{status.explain}</p>
        </div>
      </header>

      {/* Gallery: one large frame and a column of smaller ones */}
      {hero ? (
        <div className="-mx-4 grid gap-1 md:mx-0 md:grid-cols-[2fr_1fr]">
          <div className="relative aspect-[3/2] bg-paper-deep md:aspect-auto md:min-h-[26rem]">
            <Image src={hero.url} alt={hero.alt} fill priority sizes="(min-width: 768px) 66vw, 100vw" className="object-cover" />
          </div>
          {rest.length ? (
            <div className={`grid gap-1 ${rest.length >= 3 ? "grid-cols-3 md:grid-cols-1 md:grid-rows-3" : rest.length === 2 ? "grid-cols-2 md:grid-cols-1 md:grid-rows-2" : "grid-cols-1"}`}>
              {rest.slice(0, 3).map((ph) => (
                <div key={ph.id} className="relative aspect-[4/3] bg-paper-deep md:aspect-auto md:min-h-32">
                  <Image src={ph.url} alt={ph.alt} fill sizes="(min-width: 768px) 33vw, 34vw" className="object-cover" />
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
      <p className="mt-2 text-micro text-stone">
        Photographs are representative stock images from Unsplash{credits.length ? ` (${credits.join(", ")})` : ""}, not this property. Demo only.
      </p>

      <div className="mt-10 grid gap-12 lg:grid-cols-[1fr_22rem]">
        <div className="min-w-0">
          <Tabs tabs={tabs} current={tab} label="Property sections" />
          <div className="pt-8">
            {gated ? (
              <Empty title="Open an account to see the full file." action={<div className="flex gap-3"><ButtonLink href="/signup">Open an account</ButtonLink><ButtonLink href="/login" variant="secondary">Log in</ButtonLink></div>}>
                Monthly income statements, dividend history, documents, votes and the order book are available to account holders. It is free and takes about three minutes.
              </Empty>
            ) : tab === "overview" ? (
              <Overview p={p} settingsBand={settings.circuitBreakerBps} />
            ) : tab === "financials" ? (
              <Financials propertyId={p.id} />
            ) : tab === "dividends" ? (
              <Dividends propertyId={p.id} reserveBps={settings.reserveAllocationBps} />
            ) : tab === "documents" ? (
              <Documents propertyId={p.id} />
            ) : tab === "governance" ? (
              <Governance propertyId={p.id} />
            ) : (
              <Trading propertyId={p.id} slug={p.slug} />
            )}
          </div>
        </div>

        {/* Fact sheet */}
        <aside aria-label="Key numbers" className="lg:sticky lg:top-6 lg:self-start">
          <div className="border-t-2 border-ink pt-4">
            <p className="label">Fact sheet</p>
            {p.status === "FUNDING" ? (
              <div className="mt-3">
                <p className="num font-serif text-3xl">{formatCents(p.offeringPricePerShareCents)}</p>
                <p className="text-sm text-ink-soft">per share · minimum {formatCents(settings.minInvestmentCents, { whole: true })}</p>
                <div role="img" aria-label={`${formatBps(fundedBps, { decimals: 0 })} funded`} className="mt-4 h-1.5 bg-rule"><div className="h-full bg-accent" style={{ width: `${fundedBps / 100}%` }} /></div>
                <p className="num mt-2 text-sm">
                  {formatBps(fundedBps, { decimals: 0 })} funded · {formatUnits(p.totalUnits - p.soldUnits, 0)} shares left
                </p>
                {p.fundingDeadline ? <p className="text-xs text-stone">Closes {fmtDay(p.fundingDeadline)} ({daysUntil(p.fundingDeadline)}). If it has not sold out by then, everyone is refunded.</p> : null}
                <ButtonLink href={user ? `/properties/${p.slug}/invest` : "/signup"} size="lg" className="mt-5 w-full">{user ? "Invest in this home" : "Open an account to invest"}</ButtonLink>
              </div>
            ) : p.status === "TRADING" ? (
              <div className="mt-3">
                <p className="num font-serif text-3xl">{appraisal ? formatCents(appraisal.navPerShareCents) : "—"}</p>
                <p className="text-sm text-ink-soft">appraised value per share</p>
                <ButtonLink href={user ? `/properties/${p.slug}/trade` : "/signup"} size="lg" className="mt-5 w-full">{user ? "Buy or sell shares" : "Open an account to trade"}</ButtonLink>
              </div>
            ) : p.status === "SOLD" ? (
              <div className="mt-3">
                <p className="num font-serif text-3xl">{p.salePriceCents ? formatCentsWhole(p.salePriceCents) : "—"}</p>
                <p className="text-sm text-ink-soft">sale price{p.soldAt ? `, ${fmtDate(p.soldAt)}` : ""}</p>
              </div>
            ) : (
              <p className="mt-3 text-sm text-ink-soft">{status.explain}</p>
            )}
            {holding && holding.shareUnits > 0n ? (
              <Note className="mt-5">You own <span className="num font-medium text-ink">{formatUnits(holding.shareUnits)}</span> shares. <Link className="link" href="/portfolio">See your portfolio</Link></Note>
            ) : null}
            {exitPayout ? (
              <Note className="mt-5" title="Your final return">
                {formatUnits(exitPayout.shareUnits)} shares paid out {formatCents(exitPayout.amountCents)}. With {formatCents(exitPayout.dividendsCents)} of dividends on {formatCents(exitPayout.costBasisCents)} invested, your total return was{" "}
                <span className="num font-medium text-ink">{formatCents(exitPayout.amountCents + exitPayout.dividendsCents - exitPayout.costBasisCents, { sign: true })}</span>
                {exitPayout.costBasisCents > 0n ? ` (${formatBps(ratioBps(exitPayout.amountCents + exitPayout.dividendsCents - exitPayout.costBasisCents, exitPayout.costBasisCents), { sign: true })})` : ""}.
              </Note>
            ) : null}
          </div>
          <Facts className="mt-6" rows={[
            { label: "Purchase price", value: formatCentsWhole(p.purchasePriceCents) },
            { label: "Closing costs", value: formatCentsWhole(p.closingCostsCents) },
            { label: "Repair reserve at purchase", value: formatCentsWhole(p.reserveFundCents) },
            { label: "Total raised from investors", value: formatCentsWhole(raise), strong: true },
            { label: "Offering price per share", value: formatCents(p.offeringPricePerShareCents) },
            ...(appraisal ? [
              { label: `Appraised value (${fmtDate(appraisal.effectiveDate)})`, value: formatCentsWhole(appraisal.valueCents) },
              { label: "Appraised value per share", value: formatCents(appraisal.navPerShareCents) },
            ] : []),
            ...(live ? [{ label: "Last traded price", value: p.lastTradePriceCents ? formatCents(p.lastTradePriceCents) : "No trades yet" }] : []),
            { label: "Projected annual yield", value: formatBps(p.projectedAnnualYieldBps, { decimals: 1 }) },
            ...(latestFin ? [{ label: `Occupancy, ${monthLabel(latestFin.month, "short")}`, value: formatBps(latestFin.occupancyRateBps, { decimals: 0 }) }] : []),
            { label: "Planned exit", value: String(p.plannedExitYear) },
            { label: live ? "Shares outstanding" : "Shares offered", value: formatUnits(live ? outstanding : p.totalUnits, 0) },
          ]} />
          <Facts className="mt-6" rows={[
            { label: "Bedrooms / baths", value: `${p.bedrooms} / ${p.bathrooms}` },
            { label: "Living area", value: `${p.squareFeet.toLocaleString("en-US")} sq ft` },
            { label: "Built", value: String(p.yearBuilt) },
            { label: "Managed by", value: p.propertyManagerName },
            { label: "Owned by", value: p.entityName },
          ]} />
        </aside>
      </div>
      <InvestingDisclosure />
    </Page>
  );
}

type Loaded = NonNullable<Awaited<ReturnType<typeof load>>>;

async function Overview({ p, settingsBand }: { p: Loaded; settingsBand: number }) {
  const trades = await prisma.trade.findMany({ where: { propertyId: p.id, isBuyback: false }, orderBy: { executedAt: "asc" }, select: { executedAt: true, priceCents: true } });
  const points: SeriesPoint[] = [
    ...p.appraisals.map((a) => ({ t: a.effectiveDate.getTime(), a: centsToNumber(a.navPerShareCents) })),
    ...trades.map((t) => ({ t: t.executedAt.getTime(), b: centsToNumber(t.priceCents) })),
  ].sort((x, y) => x.t - y.t);
  const last = p.appraisals[p.appraisals.length - 1];
  if (last && points.length) points.push({ t: Date.now(), a: centsToNumber(last.navPerShareCents) });
  const lastTrade = trades[trades.length - 1];
  const gapBps = last && lastTrade ? ratioBps(lastTrade.priceCents - last.navPerShareCents, last.navPerShareCents) : null;

  return (
    <div className="space-y-14">
      <section>
        <p className="max-w-prose font-serif text-lg leading-relaxed">{p.description}</p>
      </section>

      {p.appraisals.length > 1 || trades.length > 0 ? (
        <section aria-labelledby="value">
          <SectionHeading id="value">Appraised value vs. last traded price</SectionHeading>
          <ChartFrame
            title="Per share"
            summary={
              gapBps === null
                ? "The appraised value per share, as estimated by an independent appraiser."
                : `Shares last changed hands at ${formatCents(lastTrade!.priceCents)}, ${formatBps(Math.abs(gapBps))} ${gapBps >= 0 ? "above" : "below"} the appraised value of ${formatCents(last!.navPerShareCents)}.`
            }
            keys={[{ label: "Appraised value per share", style: "accent" }, ...(trades.length ? [{ label: "Trades between investors", style: "ink-dots" as const }] : [])]}
            table={{
              head: ["Date", "Appraised / share", "Traded at"],
              rows: points.slice(0, -1).map((pt) => [fmtDate(new Date(pt.t)), pt.a != null ? `$${pt.a.toFixed(2)}` : "", pt.b != null ? `$${pt.b.toFixed(2)}` : ""]),
            }}
          >
            <TimeSeriesChart data={points} names={{ a: "Appraised", b: trades.length ? "Traded" : undefined }} digits={2} stepA dotsB />
          </ChartFrame>
          <div className="mt-6 grid gap-6 text-sm text-ink-soft sm:grid-cols-2">
            <p>
              <strong className="font-medium text-ink">Appraised value</strong> is an independent appraiser’s estimate of what the home would sell for, plus the cash the property holds, divided by the shares outstanding. It changes only when a new appraisal is done, which is why the line moves in steps.
            </p>
            <p>
              <strong className="font-medium text-ink">Last traded price</strong> is what one investor actually paid another. It can sit above or below the appraisal: buyers may pay more for a home they expect to rise, and sellers who want cash now may accept less. Orders must be within {formatBps(settingsBand, { decimals: 0 })} of the appraised value.
            </p>
          </div>
        </section>
      ) : null}

      <section aria-labelledby="neighborhood" className="grid gap-8 md:grid-cols-[1.3fr_1fr]">
        <div>
          <SectionHeading id="neighborhood">The neighborhood</SectionHeading>
          <p className="max-w-prose text-ink-soft">{p.neighborhood}</p>
        </div>
        <dl className="space-y-4 border-l border-rule pl-6 text-sm">
          <div><dt className="label">Schools</dt><dd className="mt-1 text-ink-soft">{p.schoolsNote}</dd></div>
          <div><dt className="label">Transit</dt><dd className="mt-1 text-ink-soft">{p.transitNote}</dd></div>
        </dl>
      </section>

      <section aria-labelledby="risks">
        <SectionHeading id="risks" aside={<Link className="link" href="/legal/risks">General risk disclosures</Link>}>Risks specific to this home</SectionHeading>
        <ol className="max-w-prose">
          {p.risks.map((r, i) => (
            <li key={i} className="grid grid-cols-[2rem_1fr] border-b border-rule py-3 text-ink-soft">
              <span className="num label pt-1">{String(i + 1).padStart(2, "0")}</span>
              <span>{r}</span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

async function Financials({ propertyId }: { propertyId: string }) {
  const rows = (await prisma.monthlyFinancials.findMany({ where: { propertyId }, orderBy: { month: "desc" }, take: 12 })).reverse();
  if (rows.length === 0) return <Empty title="No monthly statements yet.">The first income statement is published after the home’s first full month of ownership.</Empty>;
  const lines: [string, (r: (typeof rows)[number]) => bigint, boolean?][] = [
    ["Gross rent", (r) => r.grossRentCents],
    ["Vacancy loss", (r) => -r.vacancyLossCents],
    ["Management fee", (r) => -r.managementFeeCents],
    ["Maintenance", (r) => -r.maintenanceCents],
    ["Property taxes", (r) => -r.taxesCents],
    ["Insurance", (r) => -r.insuranceCents],
    ["HOA", (r) => -r.hoaCents],
    ["Other", (r) => -r.otherExpensesCents],
    ["Net income", (r) => r.netIncomeCents, true],
  ];
  const notes = rows.filter((r) => r.notes);
  const total = (f: (r: (typeof rows)[number]) => bigint) => rows.reduce((a, r) => a + f(r), 0n);
  return (
    <section>
      <SectionHeading aside="Whole dollars. Expenses shown as negatives.">Income statement, last {rows.length} months</SectionHeading>
      <Table caption="Monthly income statement" className="text-xs">
        <thead>
          <tr>
            <Th className="sticky left-0 bg-paper">&nbsp;</Th>
            {rows.map((r) => <Th key={r.month} num>{monthLabel(r.month, "short").replace(" 20", " ’")}</Th>)}
            <Th num>Total</Th>
          </tr>
        </thead>
        <tbody>
          {lines.filter(([label, f]) => label !== "HOA" || total(f) !== 0n).map(([label, f, strong]) => (
            <tr key={label} className={strong ? "font-medium" : ""}>
              <th scope="row" className={`sticky left-0 bg-paper py-2 pr-4 text-left font-normal whitespace-nowrap ${strong ? "border-y border-ink font-medium" : "border-b border-rule text-ink-soft"}`}>{label}</th>
              {rows.map((r) => {
                const v = f(r);
                return <td key={r.month} className={`num py-2 pr-4 text-right ${strong ? "border-y border-ink" : "border-b border-rule"} ${v < 0n && strong ? "text-loss" : ""}`}>{v === 0n ? "–" : formatCentsWhole(v).replace("$", "")}</td>;
              })}
              <td className={`num py-2 text-right ${strong ? "border-y border-ink" : "border-b border-rule"}`}>{formatCentsWhole(total(f)).replace("$", "")}</td>
            </tr>
          ))}
          <tr>
            <th scope="row" className="sticky left-0 bg-paper py-2 pr-4 text-left font-normal text-ink-soft">Occupancy</th>
            {rows.map((r) => <td key={r.month} className="num py-2 pr-4 text-right text-ink-soft">{formatBps(r.occupancyRateBps, { decimals: 0 })}</td>)}
            <td />
          </tr>
        </tbody>
      </Table>
      {notes.length ? (
        <div className="mt-8">
          <p className="label mb-2">Manager’s notes</p>
          <dl className="max-w-prose text-sm">
            {notes.map((n) => (
              <div key={n.month} className="grid grid-cols-[6rem_1fr] border-b border-rule py-2">
                <dt className="num text-stone">{monthLabel(n.month, "short")}</dt>
                <dd className="text-ink-soft">{n.notes}</dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}
    </section>
  );
}

async function Dividends({ propertyId, reserveBps }: { propertyId: string; reserveBps: number }) {
  const rows = (await prisma.dividendDistribution.findMany({ where: { propertyId, status: "PAID" }, orderBy: { month: "desc" }, take: 24 })).reverse();
  if (rows.length === 0) return <Empty title="No dividends have been paid yet.">Dividends start after the first full month of rent has been collected and the statement has been approved.</Empty>;
  const totalMicro = rows.slice(-12).reduce((a, r) => a + r.perShareMicroCents, 0n);
  const zero = rows.filter((r) => r.distributedCents === 0n).length;
  return (
    <section className="space-y-8">
      <SectionHeading aside={`${formatBps(reserveBps, { decimals: 0 })} of net income goes to the liquidity reserve first`}>Dividends paid per share</SectionHeading>
      <ChartFrame
        title="Monthly dividend per share"
        summary={`Over the last ${Math.min(12, rows.length)} months this home paid ${formatPerShare(totalMicro)} per share in total.${zero ? ` ${zero === 1 ? "One month" : `${zero} months`} paid nothing.` : ""}`}
        table={{ head: ["Month", "Per share"], rows: rows.map((r) => [monthLabel(r.month), formatPerShare(r.perShareMicroCents)]) }}
      >
        <MonthlyBars data={rows.map((r) => ({ label: monthLabel(r.month, "short").split(" ")[0]!, v: Number(r.perShareMicroCents) / 100_000_000 }))} name="Per share" digits={2} />
      </ChartFrame>
      <Table caption="Dividend history">
        <thead>
          <tr><Th>Month</Th><Th num>Net income</Th><Th num>To reserve</Th><Th num>Paid to holders</Th><Th num>Per share</Th><Th>Paid on</Th></tr>
        </thead>
        <tbody>
          {[...rows].reverse().map((r) => (
            <tr key={r.id}>
              <Td>{monthLabel(r.month)}</Td>
              <Td num className={r.netIncomeCents < 0n ? "text-loss" : ""}>{formatCents(r.netIncomeCents)}</Td>
              <Td num>{formatCents(r.reserveAllocationCents)}</Td>
              <Td num>{formatCents(r.distributedCents)}</Td>
              <Td num>{formatPerShare(r.perShareMicroCents)}</Td>
              <Td className="text-ink-soft">{r.paidAt ? fmtDate(r.paidAt) : ""}</Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </section>
  );
}

async function Documents({ propertyId }: { propertyId: string }) {
  const docs = await prisma.document.findMany({ where: { propertyId }, orderBy: { publishedAt: "desc" } });
  if (docs.length === 0) return <Empty title="Documents are not published yet.">The offering circular, inspection report and appraisal are posted before an offering opens.</Empty>;
  return (
    <section>
      <SectionHeading aside="Placeholders in this demo">Documents</SectionHeading>
      <Table caption="Property documents">
        <thead><tr><Th>Document</Th><Th>Type</Th><Th>Published</Th></tr></thead>
        <tbody>
          {docs.map((d) => (
            <tr key={d.id}>
              <Td><Link className="link" href={d.url}>{d.title}</Link></Td>
              <Td className="text-ink-soft">{DOCUMENT_CATEGORY[d.category]}</Td>
              <Td className="num text-ink-soft">{fmtDate(d.publishedAt)}</Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </section>
  );
}

async function Governance({ propertyId }: { propertyId: string }) {
  const proposals = await prisma.proposal.findMany({ where: { propertyId, status: { not: "DRAFT" } }, orderBy: { opensAt: "desc" } });
  if (proposals.length === 0) return <Empty title="Nothing has been put to a vote.">Holders vote only on major decisions: selling, refinancing, a large renovation, changing the manager, or moving the exit date. Day-to-day management is left to the manager.</Empty>;
  return (
    <section>
      <SectionHeading>Votes on this property</SectionHeading>
      <ul>
        {proposals.map((pr) => (
          <li key={pr.id} className="grid gap-2 border-b border-rule py-4 sm:grid-cols-[1fr_auto] sm:items-baseline">
            <div>
              <p className="label">{PROPOSAL_TYPE[pr.type]}</p>
              <Link href={`/proposals/${pr.id}`} className="font-serif text-md underline-offset-4 hover:underline">{pr.title}</Link>
              <p className="mt-1 text-sm text-ink-soft">{pr.status === "OPEN" ? `Voting closes ${fmtDay(pr.closesAt)} (${daysUntil(pr.closesAt)})` : `Closed ${fmtDate(pr.finalizedAt ?? pr.closesAt)}`}</p>
            </div>
            <Badge tone={PROPOSAL_STATUS[pr.status].tone}>{PROPOSAL_STATUS[pr.status].label}</Badge>
          </li>
        ))}
      </ul>
    </section>
  );
}

async function Trading({ propertyId, slug }: { propertyId: string; slug: string }) {
  const [open, next] = await Promise.all([openWindowFor(prisma, propertyId), nextWindowFor(prisma, propertyId)]);
  return (
    <section className="space-y-10">
      <Note tone={open ? "neutral" : "notice"} title={open ? `The trading window is open until ${fmtDay(new Date(open.closesAt.getTime() - 1))}` : "The trading window is closed"}>
        {open ? "Orders that are not matched by then expire. " : "Orders can only be placed while a window is open. "}
        {next ? `The next window runs ${fmtDay(next.opensAt)} to ${fmtDay(new Date(next.closesAt.getTime() - 1))}.` : ""}{" "}
        <Link className="link text-ink" href={`/properties/${slug}/trade`}>Place an order</Link>
      </Note>
      <div>
        <SectionHeading aside="Open orders, grouped by price">Order book</SectionHeading>
        <OrderBook propertyId={propertyId} />
      </div>
      <div>
        <SectionHeading>Recent trades</SectionHeading>
        <RecentTrades propertyId={propertyId} />
      </div>
    </section>
  );
}
