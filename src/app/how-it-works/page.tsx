import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { BRAND } from "@/config/brand";
import { InvestingDisclosure } from "@/components/site/footer";
import { ButtonLink } from "@/components/ui/button";
import { Facts, Page, PageHeader } from "@/components/ui/primitives";
import { prisma } from "@/lib/db";
import { formatBps, formatCents, formatUnits, unitsForAmount } from "@/lib/domain/money";
import { fmtDate, fmtDay } from "@/lib/labels";
import { getSettings } from "@/lib/settings";

export const metadata: Metadata = {
  title: "How it works",
  description: "What you own, how you earn, how selling and voting work, and an honest list of common questions.",
};

export const dynamic = "force-dynamic";

export default async function HowItWorks() {
  const s = await getSettings();
  const [offering, exitVote, photo] = await Promise.all([
    prisma.property.findFirst({ where: { status: "FUNDING" }, orderBy: { offeringPricePerShareCents: "asc" } }),
    prisma.proposal.findFirst({ where: { isPlannedExit: true, status: "OPEN" }, include: { property: { select: { name: true, city: true, slug: true, plannedExitYear: true } } } }),
    prisma.propertyPhoto.findFirst({ where: { position: 1, property: { status: "TRADING" } }, orderBy: { url: "asc" }, include: { property: { select: { name: true } } } }),
  ]);
  const min = formatCents(s.minInvestmentCents, { whole: true });
  const pct = (bps: number) => formatBps(bps, { decimals: 0 });

  const steps: { title: string; body: ReactNode }[] = [
    {
      title: "Choose a home",
      body: (
        <>
          Every property has its own page: the address, photographs, the purchase price, the expected rent and costs, an independent appraisal, the inspection report and a list of what could go wrong with that particular house. Read it the way you would read a listing before buying a house yourself.
        </>
      ),
    },
    {
      title: `Buy shares, from ${min}`,
      body: (
        <>
          While an offering is open you buy shares at a fixed price. You can buy part of a share.
          {offering ? (
            <> {offering.name} in {offering.city} is offered at {formatCents(offering.offeringPricePerShareCents)} a share, so {min} buys {formatUnits(unitsForAmount(s.minInvestmentCents, offering.offeringPricePerShareCents))} shares.</>
          ) : null}{" "}
          You can put in up to {formatCents(s.annualInvestmentLimitCents, { whole: true })} a year. If the offering does not sell every share by its deadline, it is cancelled and you get every cent back.
        </>
      ),
    },
    {
      title: "Receive rent every month",
      body: (
        <>
          After the manager pays the bills, {pct(s.reserveAllocationBps)} of what is left goes to the property’s liquidity reserve and the rest is divided among holders by shares held. It lands in your account around the 10th. Some months it is small; some months it is nothing.
        </>
      ),
    },
    {
      title: "Sell, vote, or hold to the sale",
      body: (
        <>
          After {s.holdingPeriodMonths} months you can offer shares to other investors during the first {s.tradingWindowDays} days of any month. You vote on major decisions about the homes you own. When the home is sold, the proceeds are divided among holders.
        </>
      ),
    },
  ];

  const faq: { q: string; a: ReactNode }[] = [
    {
      q: "What if nobody wants to buy my shares?",
      a: (
        <>
          <p>Then they do not sell. Your sell order stays open until the trading window closes, then expires, and the shares stay in your account. You can try again next month, at the same or a lower price.</p>
          <p>Each property has a liquidity reserve, funded with {pct(s.reserveAllocationBps)} of its monthly income. It can buy shares at {pct(s.buybackDiscountBps)} below the appraised value, up to {formatCents(s.buybackMonthlyCapCents, { whole: true })} a month per property, and only while it has money. It is a small backstop, not a promise. If it runs out, it stops buying until it is topped up.</p>
          <p>The honest planning assumption: you may have to hold your shares until the home is sold.</p>
        </>
      ),
    },
    {
      q: "What happens when a property is sold?",
      a: (
        <>
          <p>Each home has a planned sale year. In that year holders vote on whether to sell. If the vote passes, the home is listed and sold; the sale price, minus the costs of selling, plus whatever is left in its reserve, is divided among holders by shares held, to the cent. If the vote fails or too few holders vote, the sale date moves back by a year or two, as stated in the proposal.</p>
          {exitVote ? (
            <p>
              Right now holders of <Link className="link" href={`/properties/${exitVote.property.slug}`}>{exitVote.property.name}</Link> in {exitVote.property.city} are voting on its planned {exitVote.property.plannedExitYear} sale. Voting closes {fmtDay(exitVote.closesAt)}.
            </p>
          ) : null}
          <p>Holders can also propose selling early. That needs the same quorum and majority as any other major decision.</p>
        </>
      ),
    },
    {
      q: "Who manages the property?",
      a: <p>A local property management company, named on each property’s page. It finds and screens tenants, collects rent, handles repairs and pays the property’s bills, for a fee that is shown as a line in every monthly income statement. {BRAND.name} oversees the manager and publishes the numbers. You never deal with tenants.</p>,
    },
    {
      q: "What do I get a vote on?",
      a: (
        <p>
          Major decisions only: selling, refinancing, a major renovation, changing the manager, or extending the sale date. A vote needs {pct(s.proposalQuorumBps)} of shares to take part (quorum) and more than {pct(s.proposalPassThresholdBps)} of the For and Against votes to pass. No single holder’s vote counts for more than {pct(s.votingCapBps)} of the shares, however many they own. Votes are counted on the shares you held at the record date, so buying shares mid-vote does not buy votes.
        </p>
      ),
    },
    {
      q: "How are taxes handled?",
      a: (
        <>
          <p>Each property company would send holders a tax form each year showing their share of its income, expenses and depreciation. Dividends and any gain on a sale are generally taxable. Exactly how depends on the legal structure, which is not final, and on your own situation.</p>
          <p>{BRAND.name} does not give tax advice. In this demo, tax forms are samples only. Talk to a tax professional.</p>
        </>
      ),
    },
    {
      q: "What fees do I pay?",
      a: <p>None in this demo. The platform charges no fee to buy, sell or hold. Every order review and statement still shows a fee line, set to $0.00, so you would see one if that ever changed. The property manager’s fee is a property expense and is already taken out before dividends are paid.</p>,
    },
    {
      q: "What is the difference between the appraised value and the last traded price?",
      a: (
        <>
          <p><strong>Appraised value</strong> is an independent appraiser’s estimate of what the home would sell for, divided by the number of shares. It is updated every few months. It is an opinion, not a price anyone has agreed to pay.</p>
          <p><strong>Last traded price</strong> is the price at which two investors last actually swapped shares. It can be above or below the appraised value. We show both, side by side, on every property.</p>
        </>
      ),
    },
    {
      q: "What happens if an offering does not sell out?",
      a: <p>If every share is not sold by the deadline, the offering is cancelled and every investor is refunded in full, to their account, with nothing deducted. The home is not bought.</p>,
    },
    {
      q: "Are dividends guaranteed?",
      a: <p>No. They come from rent after expenses. A vacancy, a tenant who stops paying, or a large repair can make a month’s dividend small or zero. Projected yields on property pages are estimates based on current rent and expected costs, not promises.</p>,
    },
    {
      q: "Can I lose money?",
      a: (
        <p>
          Yes. If the home sells for less than it cost, you get back less than you put in, and you could lose all of it. Read the <Link className="link" href="/legal/risks">risk disclosure</Link> before investing.
        </p>
      ),
    },
    {
      q: "Is any of this real?",
      a: <p>No. This is a demonstration. The money is simulated, the properties and investors are fictional, the photographs are representative, and no securities are offered. The legal pages are drafts that a securities attorney has not reviewed.</p>,
    },
  ];

  return (
    <Page>
      <PageHeader
        title="How it works"
        lede={`You buy shares of one rental home’s company, from ${min}. You receive your part of the rent each month. You can sell once a month to other investors, if one wants to buy. You vote on major decisions.`}
      />

      <section aria-labelledby="steps" className="grid grid-cols-[minmax(0,1fr)] gap-12 pt-14 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)] lg:gap-20">
        <div>
          <h2 id="steps" className="sr-only">Four steps</h2>
          <ol className="border-t border-ink">
            {steps.map((st, i) => (
              <li key={st.title} className="grid grid-cols-[3rem_1fr] gap-4 border-b border-rule py-6 sm:grid-cols-[5rem_1fr]">
                <span aria-hidden className="num font-serif text-3xl leading-none tracking-figure text-stone">{i + 1}</span>
                <div>
                  <h3 className="text-lg">{st.title}</h3>
                  <p className="mt-2 max-w-prose text-ink-soft">{st.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
        <aside aria-label="The rules in figures" className="lg:pt-6">
          {photo ? (
            <figure className="mb-8">
              <div className="relative aspect-[4/3] bg-paper-deep">
                <Image src={photo.url} alt={photo.alt} fill sizes="(min-width: 1024px) 384px, 100vw" className="object-cover" />
              </div>
              <figcaption className="mt-2 text-xs text-stone">Inside {photo.property.name}. Representative photograph.</figcaption>
            </figure>
          ) : null}
          <p className="mb-2 font-serif text-md">The rules, in figures</p>
          <Facts
            rows={[
              { label: "Minimum investment", value: min },
              { label: "Most you can invest a year", value: formatCents(s.annualInvestmentLimitCents, { whole: true }) },
              { label: "Holding period before selling", value: `${s.holdingPeriodMonths} months` },
              { label: "Trading window", value: `Days 1–${s.tradingWindowDays} of each month` },
              { label: "Income set aside for the reserve", value: pct(s.reserveAllocationBps) },
              { label: "Reserve buys at", value: `${pct(s.buybackDiscountBps)} below appraisal` },
              { label: "Reserve limit per property", value: `${formatCents(s.buybackMonthlyCapCents, { whole: true })} a month` },
              { label: "Price limit on orders", value: `±${pct(s.circuitBreakerBps)} of appraisal` },
              { label: "Voting quorum", value: pct(s.proposalQuorumBps) },
              { label: "Voting cap per holder", value: pct(s.votingCapBps) },
              { label: "Platform fees", value: "$0.00" },
            ]}
          />
          <p className="mt-3 text-xs text-stone">Current settings, as of {fmtDate(s.updatedAt)}. Platform settings can change.</p>
        </aside>
      </section>

      <section aria-labelledby="questions-title" id="questions" className="grid scroll-mt-8 gap-10 pt-20 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)] lg:gap-20 lg:pt-28">
        <div>
          <h2 id="questions-title" className="text-2xl md:text-3xl">Common questions</h2>
          <p className="mt-4 text-ink-soft">Including the ones we would rather you asked before investing than after.</p>
        </div>
        <div className="border-t border-ink">
          {faq.map((f) => (
            <details key={f.q} className="group border-b border-rule">
              <summary className="flex min-h-11 cursor-pointer list-none items-baseline justify-between gap-6 py-4 font-serif text-md hover:text-accent [&::-webkit-details-marker]:hidden">
                {f.q}
                <svg aria-hidden viewBox="0 0 12 12" className="size-3 shrink-0 text-stone transition-transform duration-150 group-open:rotate-180">
                  <path d="M2 4.5 6 8.5 10 4.5" fill="none" stroke="currentColor" strokeWidth="1.25" />
                </svg>
              </summary>
              <div className="prose-plain max-w-prose pb-6 text-ink-soft">{f.a}</div>
            </details>
          ))}
        </div>
      </section>

      <section aria-labelledby="next" className="mt-20 flex flex-col gap-6 border-t border-ink pt-8 md:flex-row md:items-end md:justify-between">
        <div className="max-w-prose">
          <h2 id="next" className="text-lg">See the homes</h2>
          <p className="mt-2 text-ink-soft">Every property page shows its monthly income, appraisals, documents and risks.</p>
        </div>
        <ButtonLink href="/properties" className="w-full sm:w-auto">Browse properties</ButtonLink>
      </section>

      <InvestingDisclosure />
    </Page>
  );
}
