# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Primary: **first-time investors** — people who have never owned property and invest little or
nothing today, starting with $26–$500. They need plain language, real numbers and an honest
account of risk before they will put money in.

Secondary: **experienced small investors** who already hold stocks or funds and want rental
property in the mix. They want the detail — appraisals, monthly income statements, order book
depth, vote tallies — within reach, not on top.

Design for the first-timer; never hide what the experienced investor needs.

Also: **platform admins**, who enter monthly financials, approve and pay dividends, schedule
trading windows, run votes and edit settings.

## Product Purpose

Let anyone own a share of an individual rental home from $26, receive their share of the rent
monthly, sell to other investors during scheduled trading windows, and vote on major decisions
about the homes they own. ("Robinhood for rental properties", but calm and careful rather than
gamified.)

This codebase serves two purposes at once:
1. A **convincing demo** for investor and partner conversations — polish and believability matter.
2. The **foundation for a real launch** — every outside service sits behind an adapter so
   licensed partners (KYC, payments, custody, an SEC-registered ATS) can replace the mocks
   without rewriting the app.

Success: a first-time visitor understands what they would own, how they would earn, how they
could sell, and what could go wrong — and the numbers always add up.

## Positioning

One specific home per investment, not a pooled fund: a named street address, its own LLC, its
own monthly income statement, its own vote. Liquidity is honest and bounded — monthly trading
windows, a six-month holding period, and a capped liquidity-reserve buyback — rather than a
promise of instant sale.

## Operating Context

- Investors check in monthly: dividends land around the 10th; trading windows open on the 1st.
- Onboarding: sign up → profile → identity check → risk disclosure → fund wallet → tour.
- Admin cycle: financials entered after month-end → draft dividend → approve → pay.
- Votes run for about two weeks; planned-exit votes open automatically in the exit year.
- Printable monthly statements are a real artefact investors keep.

## Capabilities and Constraints

- **Simulated money only.** No real money, brokerage or identity checks. A "Demo mode: no real
  money" banner on every page.
- Money in integer cents, shares in micro-shares; every balance change writes an append-only,
  balanced ledger entry.
- Stack (existing): Next.js App Router, TypeScript strict, Tailwind, Prisma + PostgreSQL (Neon),
  Auth.js, Vercel + Vercel Cron.
- Settings (admin-editable): $26 minimum, $10,000 annual limit, 6-month holding period, first
  7 days of each month to trade, 10% of income to reserve, 5% buyback discount, $2,000 monthly
  buyback cap, 30% quorum, >50% to pass, 20% voting cap, ±25% circuit breaker.
- Legal pages are drafts that must be reviewed by a securities attorney before launch.
- Undecided: offering exemption, ATS partner, custodian, tax reporting provider, final brand name.

## Brand Commitments

- Working name **Lintel** (placeholder, confirmed for now). Lives only in `src/config/brand.ts`.
- Must feel like an established, trustworthy financial company — editorial, not a startup
  template — and must not look AI-generated (brief, Section 9).
- Voice: plain, specific, confident, like a trusted advisor. Short sentences, real numbers,
  jargon explained inline, risks in the same calm tone as benefits.
- Never: "Unlock", "Revolutionize", "Seamless", "Empower", "Next-generation", "Your journey",
  "Elevate", "Effortless".

## Evidence on Hand

- Seed data: 6 properties (Columbus OH, Kansas City MO, Tampa FL, Raleigh NC, Indianapolis IN,
  Birmingham AL), 21 investors, 12 months of financials, appraisals, trades, dividends and votes —
  all **fictional demo data**, labelled as such.
- Photography: royalty-free Unsplash images, representative of each property type, not the
  actual homes. Photographer credits still to be verified (README).
- **Absent — must not be fabricated:** testimonials, press logos, user counts, track record,
  returns history, regulatory registrations, partner names.

## Product Principles

1. **Honest before persuasive.** Show the risk next to the return, the appraisal next to the last
   traded price, and what happens if nobody buys.
2. **Every number reconciles.** Figures shown to a user come from the ledger and add up; rounding
   is never in the user's disfavour without being shown.
3. **Explain before asking.** Before any order or purchase, say in plain words what will happen,
   including the unhappy path.
4. **Newcomer first, depth on request.** Lead with the sentence a first-timer needs; keep the
   table an experienced investor needs one click away.
5. **Built to be swapped.** Mocks behind adapters today; licensed partners tomorrow.

## Accessibility & Inclusion

WCAG 2.2 AA: keyboard navigation, visible focus, labelled controls, 4.5:1 text contrast,
reduced-motion support, and a table alternative for every chart. Assume users on phones and
users with no finance background.
