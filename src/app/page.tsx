import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { BRAND } from "@/config/brand";
import { loadHome } from "@/components/marketing/home-data";
import { VoteResult } from "@/components/marketing/vote-result";
import { InvestingDisclosure } from "@/components/site/footer";
import { PropertyCard } from "@/components/site/property-card";
import { ButtonLink } from "@/components/ui/button";
import { Facts, Page, SectionHeading, Table, Td, Th } from "@/components/ui/primitives";
import { formatPerShare } from "@/lib/domain/dividends";
import { formatBps, formatCents, formatCentsWhole, formatUnits, ratioBps } from "@/lib/domain/money";
import { monthLabel } from "@/lib/domain/trading-rules";
import { fmtDate, fmtDay, PROPERTY_TYPE } from "@/lib/labels";

export const metadata: Metadata = {
  title: { absolute: `${BRAND.name} — own a share of a rental home` },
  description: "Buy shares of individual rental homes from $26. Rent is paid out monthly. Demo platform: no real money, no real securities.",
};

export const dynamic = "force-dynamic";

export default async function Home() {
  const d = await loadHome();
  const { settings, featured: f, offering, year, example: ex } = d;
  const min = formatCents(settings.minInvestmentCents, { whole: true });
  const hero = offering ?? f;
  const heroPhoto = hero?.photos[0];
  const city = hero?.city ?? "your city";
  const fundedBps = offering ? ratioBps(offering.soldUnits, offering.totalUnits) : 0;
  const nav = f?.appraisals.at(-1) ?? null;
  const firstAppraisal = f?.appraisals[0] ?? null;
  const interior = f?.photos[2] ?? f?.photos[1] ?? null;
  const emptyMonth = year?.rows.find((r) => r.netIncomeCents <= 0n) ?? null;
  const windowLine = d.openWindow
    ? `A trading window is open now and is open through ${fmtDay(new Date(d.openWindow.closesAt.getTime() - 1))}.`
    : d.nextWindow
      ? `The next window opens ${fmtDay(d.nextWindow.opensAt)}.`
      : null;

  return (
    <>
      {/* Masthead: the headline is true of a home open for investment today. */}
      <section aria-labelledby="home-title" className="border-b border-ink lg:grid lg:grid-cols-[minmax(2rem,1fr)_minmax(0,40rem)_3rem_minmax(0,31rem)_minmax(0,1fr)]">
        <div className="px-4 pb-10 pt-10 md:px-8 lg:col-start-2 lg:px-0 lg:pb-14 lg:pt-20">
          <h1 id="home-title" className="text-3xl md:text-4xl xl:text-5xl">
            Own a share of a rental home in {city} for {min}.
          </h1>
          <p className="mt-6 max-w-prose text-md text-ink-soft">
            Rent is paid out monthly. Each home is owned by its own company, and you buy shares of that company: you receive your part of the rent after expenses, you can sell to other investors once a month, and you vote on the decisions that matter.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-4">
            <ButtonLink href="/properties" size="lg">See the {d.propertyCount} homes</ButtonLink>
            <Link href="/how-it-works" className="link text-sm">How it works, in four steps</Link>
          </div>

          {f && year ? (
            <dl className="mt-14 grid grid-cols-2 border-t border-ink sm:grid-cols-3">
              <div className="border-b border-rule py-3 pr-4">
                <dt className="label">Minimum</dt>
                <dd className="num mt-1 font-serif text-xl tracking-figure">{min}</dd>
              </div>
              <div className="border-b border-rule py-3 pr-4">
                <dt className="label">Paid to holders</dt>
                <dd className="num mt-1 font-serif text-xl tracking-figure">{formatCentsWhole(year.totals.paid)}</dd>
                <dd className="mt-1 text-xs text-stone">by {f.name}, last {year.rows.length} months</dd>
              </div>
              <div className="col-span-2 border-b border-rule py-3 sm:col-span-1">
                <dt className="label">Trading windows</dt>
                <dd className="mt-1 font-serif text-xl tracking-figure">Days 1–{settings.tradingWindowDays}</dd>
                <dd className="mt-1 text-xs text-stone">of every month</dd>
              </div>
            </dl>
          ) : null}
        </div>

        {hero && heroPhoto ? (
          <figure className="lg:col-span-2 lg:col-start-4 lg:flex lg:flex-col">
            <div className="relative aspect-[4/3] bg-paper-deep lg:aspect-auto lg:min-h-[36rem] lg:flex-1">
              <Image src={heroPhoto.url} alt={heroPhoto.alt} fill priority sizes="(min-width: 1024px) 50vw, 100vw" className="object-cover" />
            </div>
            <figcaption className="px-4 py-3 text-xs text-stone md:px-8 lg:pl-4">
              <Link href={`/properties/${hero.slug}`} className="link text-sm text-ink">{hero.name}</Link>, {hero.street}, {hero.city}, {hero.state}.
              {offering ? (
                <> Open for investment at <span className="num">{formatCents(offering.offeringPricePerShareCents)}</span> a share, <span className="num">{formatBps(fundedBps, { decimals: 0 })}</span> funded{offering.fundingDeadline ? <>, offering closes {fmtDate(offering.fundingDeadline)}</> : null}.</>
              ) : null}{" "}
              Photograph is representative, not the actual home.
            </figcaption>
          </figure>
        ) : null}
      </section>

      <Page>
        {/* What you own */}
        {f ? (
          <section aria-labelledby="own" className="grid grid-cols-[minmax(0,1fr)] gap-10 pt-16 lg:grid-cols-[minmax(0,1fr)_minmax(0,30rem)] lg:gap-20 lg:pt-24">
            <div className="max-w-prose">
              <h2 id="own" className="text-2xl md:text-3xl">What you own</h2>
              <p className="mt-5 text-md">One house, through the company that owns it. Not a fund, not a basket.</p>
              <p className="mt-4 text-ink-soft">
                {f.name} at {f.street} in {f.city} is owned by {f.entityName}, a company set up to hold that one home and nothing else. The company was divided into {formatUnits(f.totalUnits, 0)} shares and sold to investors at {formatCents(f.offeringPricePerShareCents)} each.
                {ex ? <> At that price, {min} bought {formatUnits(ex.units)} shares.</> : null}
              </p>
              <p className="mt-4 text-ink-soft">
                {f.propertyManagerName} finds tenants, collects rent and fixes what breaks. You do not deal with tenants or repairs. Holders vote only when something major is on the table.
              </p>
            </div>
            <div>
              <p className="mb-2 font-serif text-md">{f.name}</p>
              <Facts
                rows={[
                  { label: "Address", value: `${f.street}, ${f.city}, ${f.state} ${f.zip}` },
                  { label: "Home", value: `${PROPERTY_TYPE[f.propertyType]}, ${f.bedrooms} bed, ${f.bathrooms} bath, built ${f.yearBuilt}` },
                  { label: "Owned by", value: f.entityName },
                  { label: "Bought for", value: formatCentsWhole(f.purchasePriceCents) },
                  { label: "Shares", value: formatUnits(f.totalUnits, 0) },
                  { label: "Offering price", value: `${formatCents(f.offeringPricePerShareCents)} a share` },
                  { label: "Rent", value: `${formatCents(f.projectedMonthlyRentCents, { whole: true })} a month` },
                  { label: "Managed by", value: f.propertyManagerName },
                  { label: "Planned sale", value: String(f.plannedExitYear) },
                ]}
              />
              <p className="mt-3 text-xs text-stone">Fictional demo property. Figures are from this demo’s database.</p>
            </div>
          </section>
        ) : null}

        {/* How you earn: rent */}
        {f && year ? (
          <section aria-labelledby="earn" className="pt-20 lg:pt-28">
            <div className="max-w-prose">
              <h2 id="earn" className="text-2xl md:text-3xl">How you earn: rent first</h2>
              <p className="mt-5 text-ink-soft">
                Each month the manager collects the rent and pays the bills: management, repairs, property tax, insurance. What is left is net income. {formatBps(settings.reserveAllocationBps, { decimals: 0 })} of it goes to the property’s liquidity reserve, and the rest is divided among holders by shares held and paid around the 10th of the next month. This is {f.name}’s last {year.rows.length} months.
              </p>
            </div>

            <div className="mt-10 grid gap-12 lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-16">
              <div className="min-w-0">
                <div className="mb-3 flex items-baseline justify-between gap-4 border-b border-ink pb-2">
                  <p className="font-serif text-md">{f.name}, monthly income</p>
                  <p className="text-xs text-stone">Fictional demo data</p>
                </div>
                <Table caption={`${f.name}: rent, expenses and dividends for the last ${year.rows.length} months`}>
                  <thead>
                    <tr>
                      <Th>Month</Th>
                      <Th num>Rent collected</Th>
                      <Th num>Expenses</Th>
                      <Th num>Net income</Th>
                      <Th num>To reserve</Th>
                      <Th num>Paid to holders</Th>
                      <Th num>Per share</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {year.rows.map((r) => (
                      <tr key={r.month}>
                        <Td className="whitespace-nowrap">{monthLabel(r.month, "short")}</Td>
                        <Td num>{formatCents(r.rentCollectedCents)}</Td>
                        <Td num>{formatCents(r.expensesCents)}</Td>
                        <Td num>{formatCents(r.netIncomeCents)}</Td>
                        <Td num>{r.reserveCents !== null ? formatCents(r.reserveCents) : "—"}</Td>
                        <Td num>{r.paidCents !== null ? formatCents(r.paidCents) : <span className="text-stone">{r.status === "NONE" ? "—" : "Not paid yet"}</span>}</Td>
                        <Td num>{r.perShareMicroCents !== null ? formatPerShare(r.perShareMicroCents) : "—"}</Td>
                      </tr>
                    ))}
                    <tr className="font-semibold">
                      <Td className="border-ink">Total</Td>
                      <Td num className="border-ink">{formatCents(year.totals.rent)}</Td>
                      <Td num className="border-ink">{formatCents(year.totals.expenses)}</Td>
                      <Td num className="border-ink">{formatCents(year.totals.net)}</Td>
                      <Td num className="border-ink">{formatCents(year.totals.reserve)}</Td>
                      <Td num className="border-ink">{formatCents(year.totals.paid)}</Td>
                      <Td num className="border-ink">{formatPerShare(year.totals.perShareMicro)}</Td>
                    </tr>
                  </tbody>
                </Table>
                <div className="mt-4 grid gap-3 text-sm text-ink-soft md:grid-cols-2 md:gap-8">
                  {emptyMonth ? (
                    <p>
                      <span className="text-ink">{monthLabel(emptyMonth.month)}:</span> {emptyMonth.notes || "Net income was zero or below, so nothing was paid."} Net income was {formatCents(emptyMonth.netIncomeCents)}; holders received nothing that month.
                    </p>
                  ) : null}
                  <p>
                    A month marked “Not paid yet” is awaiting approval. Rent collected is rent due minus any vacancy. Expenses include the manager’s fee, repairs, property tax and insurance.
                  </p>
                </div>
              </div>

              {ex ? (
                <aside aria-labelledby="example" className="border-t-2 border-ink pt-4 lg:self-start">
                  <h3 id="example" className="text-lg">What {min} earned here</h3>
                  <p className="mt-3 text-sm text-ink-soft">Worked from the table, as if you had bought in {f.name}’s offering.</p>
                  <Facts
                    className="mt-4"
                    rows={[
                      { label: "You put in", value: formatCents(ex.amountCents) },
                      { label: "Price a share", value: formatCents(ex.priceCents) },
                      { label: "Shares bought", value: formatUnits(ex.units) },
                      { label: `${monthLabel(ex.lastMonth, "short")} dividend a share`, value: formatPerShare(ex.lastPerShareMicroCents) },
                      { label: `${monthLabel(ex.lastMonth, "short")} on your shares`, value: formatCents(ex.lastDividendCents), strong: true },
                      { label: `${ex.yearMonths} paid months`, value: formatCents(ex.yearDividendCents), strong: true },
                    ]}
                  />
                  <p className="mt-4 text-sm text-ink-soft">
                    {formatUnits(ex.units)} shares × {formatPerShare(ex.lastPerShareMicroCents)} = {formatCents(ex.lastDividendCents)}, rounded down to the cent. Small amounts, honestly shown: rent is a slow, steady return, not a fast one.
                  </p>
                  {ex.valueAtNavCents !== null && nav ? (
                    <p className="mt-3 text-sm text-ink-soft">
                      At the {fmtDate(nav.effectiveDate)} appraisal of {formatCents(nav.navPerShareCents)} a share, those shares are valued at {formatCents(ex.valueAtNavCents)}. That is an estimate, not a price anyone has offered.
                    </p>
                  ) : null}
                </aside>
              ) : null}
            </div>
          </section>
        ) : null}
      </Page>

      {/* Full-bleed interior: a change of pace between the two halves of the page. */}
      {interior && f ? (
        <figure className="mt-20 lg:mt-28">
          <div className="relative aspect-[3/2] bg-paper-deep md:aspect-[21/8]">
            <Image src={interior.url} alt={interior.alt} fill sizes="100vw" className="object-cover" />
          </div>
          <figcaption className="mx-auto max-w-page px-4 py-3 text-xs text-stone md:px-8">
            Inside a home like {f.name}. Photograph is representative, not the actual home.
          </figcaption>
        </figure>
      ) : null}

      <Page>
        {/* How you earn: appreciation */}
        {f && nav && firstAppraisal ? (
          <section aria-labelledby="value" className="grid grid-cols-[minmax(0,1fr)] gap-10 pt-16 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)] lg:gap-20 lg:pt-24">
            <div>
              <h2 id="value" className="text-2xl md:text-3xl">Then appreciation, if it comes</h2>
              <p className="mt-5 text-ink-soft">
                If the home is worth more when it is sold than when it was bought, holders share the gain. If it is worth less, they share the loss. Until then, an independent appraiser estimates its value every few months.
              </p>
              <p className="mt-4 text-ink-soft">
                The appraised value is an estimate. The last traded price is what two investors actually agreed on. They are often different, and we show both.
              </p>
            </div>
            <div className="min-w-0">
              <div className="mb-3 flex items-baseline justify-between gap-4 border-b border-ink pb-2">
                <p className="font-serif text-md">{f.name}, value over time</p>
                <p className="text-xs text-stone">Fictional demo data</p>
              </div>
              <Table caption={`${f.name} appraisals`}>
                <thead>
                  <tr>
                    <Th>Date</Th>
                    <Th>Source</Th>
                    <Th num>Home value</Th>
                    <Th num>Per share</Th>
                  </tr>
                </thead>
                <tbody>
                  {f.appraisals.map((a) => (
                    <tr key={a.id}>
                      <Td className="num whitespace-nowrap">{fmtDate(a.effectiveDate)}</Td>
                      <Td className="text-ink-soft">{a.source.replace("Independent appraisal — ", "Appraisal, ")}</Td>
                      <Td num>{formatCentsWhole(a.valueCents)}</Td>
                      <Td num>{formatCents(a.navPerShareCents)}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
              <Facts
                className="mt-6"
                rows={[
                  { label: "Offering price, per share", value: formatCents(f.offeringPricePerShareCents) },
                  { label: `Latest appraisal, ${fmtDate(nav.effectiveDate)}`, value: formatCents(nav.navPerShareCents) },
                  ...(f.lastTradePriceCents && f.lastTradeAt ? [{ label: `Last traded, ${fmtDate(f.lastTradeAt)}`, value: formatCents(f.lastTradePriceCents) }] : []),
                ]}
              />
              <p className="mt-3 text-sm text-ink-soft">
                The offering price is higher than the purchase price alone because it also covers closing costs and a cash reserve for repairs.
              </p>
            </div>
          </section>
        ) : null}

        {/* How selling works */}
        <section aria-labelledby="sell" className="grid grid-cols-[minmax(0,1fr)] gap-10 pt-20 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] lg:gap-20 lg:pt-28">
          <div>
            <h2 id="sell" className="text-2xl md:text-3xl">How selling works</h2>
            <p className="mt-5 text-md">Possible, not promised.</p>
            <p className="mt-4 text-ink-soft">These shares are not on a stock exchange. You sell to another investor who wants them, on dates set in advance.</p>
          </div>
          <dl className="border-t border-ink">
            {[
              {
                t: "Once a month",
                d: <>Orders can be placed during the first {settings.tradingWindowDays} days of each month. {windowLine}</>,
              },
              {
                t: `After ${settings.holdingPeriodMonths} months`,
                d: <>Each purchase can be sold {settings.holdingPeriodMonths} months after you bought it. Shares bought on different dates become sellable on different dates.</>,
              },
              {
                t: "At a price you name",
                d: (
                  <>
                    You set the lowest price you will accept. Your order fills only if a buyer’s order meets it.
                    {f?.lastTradePriceCents && f.lastTradeAt && nav ? <> {f.name} last traded at {formatCents(f.lastTradePriceCents)} a share on {fmtDate(f.lastTradeAt)}, against an appraisal of {formatCents(nav.navPerShareCents)}.</> : null}
                  </>
                ),
              },
              {
                t: "A reserve, with limits",
                d: (
                  <>
                    {formatBps(settings.reserveAllocationBps, { decimals: 0 })} of each month’s income goes into the property’s liquidity reserve. It buys up to {formatCents(settings.buybackMonthlyCapCents, { whole: true })} of shares a month, at {formatBps(settings.buybackDiscountBps, { decimals: 0 })} below appraised value, while its money lasts.
                    {f?.reserve ? <> {f.name}’s reserve holds {formatCents(f.reserve.balanceCents)} today.</> : null}
                  </>
                ),
              },
              {
                t: "No guarantee",
                d: <>If nobody buys, your order expires when the window closes and you keep your shares. Plan to hold until the home is sold{f ? <>; for {f.name} that is planned for {f.plannedExitYear}</> : null}.</>,
              },
            ].map((row) => (
              <div key={row.t} className="grid gap-2 border-b border-rule py-5 sm:grid-cols-[12rem_1fr] sm:gap-8">
                <dt className="font-serif text-md">{row.t}</dt>
                <dd className="text-ink-soft">{row.d}</dd>
              </div>
            ))}
          </dl>
        </section>

        {/* How voting works */}
        <section aria-labelledby="vote" className="grid grid-cols-[minmax(0,1fr)] gap-10 pt-20 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] lg:gap-20 lg:pt-28">
          <div className="lg:order-2">
            <h2 id="vote" className="text-2xl md:text-3xl">How voting works</h2>
            <p className="mt-5 text-ink-soft">
              Holders vote on major decisions only: selling the home, refinancing it, a large renovation, changing the manager, or moving the planned sale date. Day-to-day running is the manager’s job.
            </p>
            <Facts
              className="mt-6"
              rows={[
                { label: "One vote per", value: "share" },
                { label: "Quorum", value: `${formatBps(settings.proposalQuorumBps, { decimals: 0 })} of shares vote` },
                { label: "To pass", value: `more than ${formatBps(settings.proposalPassThresholdBps, { decimals: 0 })} For` },
                { label: "Most one holder counts", value: formatBps(settings.votingCapBps, { decimals: 0 }) },
              ]}
            />
            <p className="mt-3 text-sm text-ink-soft">
              The cap means no single holder decides alone, however many shares they own. Abstaining counts toward quorum, not toward the result.
            </p>
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)] gap-12 lg:order-1">
            {d.votes.map((v) => <VoteResult key={v.id} v={v} />)}
          </div>
        </section>

        {/* Open now */}
        {d.openCards.length ? (
          <section aria-labelledby="open" className="pt-20 lg:pt-28">
            <SectionHeading id="open" aside={<Link href="/properties" className="link text-sm text-ink">All {d.propertyCount} properties</Link>}>
              Open for investment, and next
            </SectionHeading>
            <div className="mt-6 grid gap-x-8 gap-y-12 sm:grid-cols-2 lg:grid-cols-3">
              {d.openCards.slice(0, 3).map(({ card }) => <PropertyCard key={card.slug} p={card} />)}
            </div>
            <p className="mt-8 max-w-prose text-sm text-ink-soft">
              If an offering does not sell every share by its deadline, it is cancelled and every investor is refunded in full.
            </p>
          </section>
        ) : null}
      </Page>

      {/* Risks: a sunk band, same calm voice. */}
      <section aria-labelledby="risks" className="mt-20 bg-paper-deep lg:mt-28">
        <Page className="grid grid-cols-[minmax(0,1fr)] gap-10 py-16 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] lg:gap-20 lg:py-24">
          <div>
            <h2 id="risks" className="text-2xl md:text-3xl">What can go wrong</h2>
            <p className="mt-5 text-ink-soft">The risks are as real as the rent. Here they are, with examples from this demo’s own homes.</p>
            <Link href="/legal/risks" className="link mt-6 inline-block text-sm">Read the full risk disclosure</Link>
          </div>
          <ul className="border-t border-ink">
            {[
              { t: "You can lose money.", d: "Home values fall as well as rise. If a home sells for less than it cost, holders get back less than they put in, possibly nothing." },
              emptyMonth && f
                ? { t: "Some months pay nothing.", d: `${f.name} paid holders nothing for ${monthLabel(emptyMonth.month)}. ${emptyMonth.notes || "Expenses were higher than rent."}` }
                : { t: "Some months pay nothing.", d: "A vacancy or a large repair can wipe out a month’s income. Dividends are not guaranteed." },
              d.tradedBelow
                ? {
                    t: "Shares can trade below what you paid.",
                    d: `${d.tradedBelow.name} in ${d.tradedBelow.city} was offered at ${formatCents(d.tradedBelow.offeringPricePerShareCents)} a share. Its last trade was at ${formatCents(d.tradedBelow.lastTradePriceCents ?? 0n)}${d.tradedBelow.lastTradeAt ? ` on ${fmtDate(d.tradedBelow.lastTradeAt)}` : ""}.`,
                  }
                : { t: "Shares can trade below what you paid.", d: "The price is whatever another investor will pay, and it can be lower than the appraisal or the offering price." },
              { t: "You may not be able to sell.", d: `Only in a trading window, only after ${settings.holdingPeriodMonths} months, and only if someone buys. The reserve’s budget is small and can run out.` },
              { t: "One home is not diversified.", d: "A local downturn, a storm or one bad tenant can affect all of a property’s income." },
              { t: "This is a demo.", d: "No real money and no real securities. Every figure on this page is fictional seed data." },
            ].map((r) => (
              <li key={r.t} className="grid gap-1 border-b border-edge py-4 sm:grid-cols-[16rem_1fr] sm:gap-8">
                <p className="font-medium">{r.t}</p>
                <p className="text-ink-soft">{r.d}</p>
              </li>
            ))}
          </ul>
        </Page>
      </section>

      <Page>
        <section aria-labelledby="start" className="grid gap-6 pt-16 md:grid-cols-[minmax(0,1fr)_auto] md:items-end lg:pt-20">
          <div className="max-w-prose">
            <h2 id="start" className="text-2xl md:text-3xl">Start with one home.</h2>
            <p className="mt-4 text-ink-soft">Read a property’s fact sheet, its monthly income and its risks before you decide. From {min}.</p>
          </div>
          <ButtonLink href="/properties" size="lg" className="w-full sm:w-auto">Browse properties</ButtonLink>
        </section>
        <InvestingDisclosure />
      </Page>
    </>
  );
}
