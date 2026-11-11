/**
 * Seed: builds a believable 20-month history by running the REAL services with backdated
 * clocks, so every balance, lot and ledger entry is produced by the same code the app uses.
 * Finishes by reconciling the books; the seed fails if they do not balance.
 *
 *   pnpm db:seed          (wipes the database first)
 */
import "dotenv/config";
import bcrypt from "bcryptjs";
import { BRAND, entityName } from "../src/config/brand";
import { prisma } from "../src/lib/db";
import { addMonths } from "../src/lib/domain/holding";
import { perShare, UNITS_PER_SHARE, valueOfUnits } from "../src/lib/domain/money";
import { monthKey } from "../src/lib/domain/trading-rules";
import { approveDistribution, payDistribution, previewDistribution, saveFinancials } from "../src/lib/services/dividends";
import { castVote, createExitVotes, createProposal, finalizeProposal, publishProposal } from "../src/lib/services/governance";
import { postLedger, reconcile } from "../src/lib/services/ledger";
import { buyPrimary } from "../src/lib/services/purchase";
import { closeWindow, placeOrder, sellToReserve } from "../src/lib/services/trading";
import { DEMO, INVESTOR_NAMES, INVESTOR_STATES, PROPERTIES, type SeedProperty } from "./seed-data";

process.env.QUIET_EMAIL = "1";

// ---------- deterministic randomness ----------
let seedState = 20261111;
function rnd(): number {
  seedState |= 0;
  seedState = (seedState + 0x6d2b79f5) | 0;
  let t = Math.imul(seedState ^ (seedState >>> 15), 1 | seedState);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const between = (a: number, b: number) => a + rnd() * (b - a);
const int = (a: number, b: number) => Math.floor(between(a, b + 1));
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)]!;
const shuffle = <T>(xs: readonly T[]): T[] => {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
};

// ---------- time ----------
const NOW = new Date();
const DAY = 24 * 3600 * 1000;
const monthStart = (offset: number) => new Date(Date.UTC(NOW.getUTCFullYear(), NOW.getUTCMonth() - offset, 1));
const at = (offset: number, day: number, hour = 15) => new Date(Date.UTC(NOW.getUTCFullYear(), NOW.getUTCMonth() - offset, day, hour, int(0, 59)));
const daysAgo = (n: number, hour = 14) => new Date(NOW.getTime() - n * DAY - (NOW.getUTCHours() - hour) * 3600 * 1000 * 0);
const cents = (dollars: number) => BigInt(Math.round(dollars * 100));
const LOT = 10_000n;
let keyN = 0;
const key = () => `seed-${String(++keyN).padStart(6, "0")}-${Math.floor(rnd() * 1e12).toString(36).padStart(8, "0")}`;

type U = { id: string; name: string; email: string };

async function wipe() {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname = current_schema() AND tablename <> '_prisma_migrations'`;
  await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} RESTART IDENTITY CASCADE`);
}

async function depositAt(userId: string, amountCents: bigint, when: Date) {
  await prisma.$transaction(async (tx) => {
    await tx.wallet.update({ where: { userId }, data: { availableCents: { increment: amountCents } } });
    await postLedger(tx, `seed_dep_${userId}_${when.getTime()}`, [
      { account: "USER_WALLET", userId, type: "DEPOSIT", amountCents, memo: "Simulated deposit from linked bank" },
      { account: "EXTERNAL", type: "DEPOSIT", amountCents: -amountCents, memo: "Simulated bank transfer in (seed)" },
    ], when);
  });
}

function projectedYieldBps(p: SeedProperty): number {
  const raise = p.purchasePrice + p.closingCosts + p.reserveFund;
  const monthlyNet = p.monthlyRent * 0.95 * 0.92 - p.avgMaintenance - p.annualTaxes / 12 - p.annualInsurance / 12 - p.monthlyHoa;
  return Math.round(((monthlyNet * 12 * 0.9) / raise) * 10_000);
}

async function addAppraisal(propertyId: string, valueDollars: number, effectiveDate: Date, source: string, notes = "") {
  const p = await prisma.property.findUniqueOrThrow({ where: { id: propertyId } });
  const outstanding = p.soldUnits - p.retiredUnits;
  const basis = outstanding > 0n ? outstanding : p.totalUnits;
  const valueCents = cents(valueDollars);
  await prisma.appraisal.create({
    data: { propertyId, valueCents, navPerShareCents: perShare(valueCents + p.reserveFundCents, basis), effectiveDate, source, notes, createdAt: effectiveDate },
  });
}

async function main() {
  console.log("Seeding… (this runs a 20-month simulation and takes a minute or two)");
  await wipe();
  const settings = await prisma.platformSettings.create({ data: { id: 1 } });

  // ---------- users ----------
  const joined = at(22, 3);
  const [adminHash, investorHash] = await Promise.all([bcrypt.hash(DEMO.admin.password, 12), bcrypt.hash(DEMO.investor.password, 12)]);
  const admin = await prisma.user.create({
    data: { email: DEMO.admin.email, passwordHash: adminHash, name: DEMO.admin.name, role: "ADMIN", kycStatus: "APPROVED", annualInvestmentLimitCents: 0n, onboardingCompletedAt: joined, createdAt: joined, wallet: { create: {} } },
  });
  const onboarded = (when: Date) => ({
    kycStatus: "APPROVED" as const,
    kycSubmittedAt: when,
    riskDisclosureAcceptedAt: when,
    tradingDisclosureAcceptedAt: when,
    fundedAt: when,
    onboardingCompletedAt: when,
    createdAt: when,
  });
  const demo: U = await prisma.user.create({
    data: { email: DEMO.investor.email, passwordHash: investorHash, name: DEMO.investor.name, state: "OH", dateOfBirth: new Date("1988-04-17"), annualInvestmentLimitCents: settings.annualInvestmentLimitCents, ...onboarded(joined), wallet: { create: {} } },
  });
  const others: U[] = [];
  for (const [i, name] of INVESTOR_NAMES.entries()) {
    const when = at(22, 3 + (i % 20));
    const email = `${name.toLowerCase().normalize("NFD").replace(/[^a-z ]/g, "").replace(/ +/g, ".")}@demo.test`;
    others.push(
      await prisma.user.create({
        data: {
          email, passwordHash: investorHash, name, state: INVESTOR_STATES[i]!, dateOfBirth: new Date(Date.UTC(1962 + ((i * 7) % 35), i % 12, 1 + ((i * 5) % 27))),
          // Demo-only: with just 20 investors, each must hold far more than a real investor would, so their limits are raised.
          annualInvestmentLimitCents: cents(500_000), ...onboarded(when), wallet: { create: {} },
        },
      }),
    );
  }
  const whale = others[3]!; // holds >20% of one property so the voting cap is visible

  // ---------- properties ----------
  const year = NOW.getUTCFullYear();
  const props = new Map<string, { id: string; seed: SeedProperty; totalUnits: bigint; fundedAt?: Date }>();
  for (const s of PROPERTIES) {
    const raise = s.purchasePrice + s.closingCosts + s.reserveFund;
    const totalUnits = (BigInt(raise) / BigInt(s.sharePrice)) * UNITS_PER_SHARE;
    if (BigInt(raise) % BigInt(s.sharePrice) !== 0n) throw new Error(`${s.slug}: raise must divide by share price`);
    const fundedAt = s.fundedMonthsAgo ? at(s.fundedMonthsAgo, 18) : undefined;
    const createdAt = fundedAt ? new Date(fundedAt.getTime() - 35 * DAY) : s.seedStatus === "FUNDING" ? daysAgo(s.slug.includes("raleigh") ? 21 : 10) : daysAgo(4);
    const p = await prisma.property.create({
      data: {
        slug: s.slug, name: s.name, street: s.street, city: s.city, state: s.state, zip: s.zip, propertyType: s.propertyType,
        bedrooms: s.bedrooms, bathrooms: s.bathrooms, squareFeet: s.squareFeet, yearBuilt: s.yearBuilt, description: s.description,
        neighborhood: s.neighborhood, schoolsNote: s.schoolsNote, transitNote: s.transitNote, risks: s.risks,
        purchasePriceCents: cents(s.purchasePrice), closingCostsCents: cents(s.closingCosts), reserveFundCents: cents(s.reserveFund),
        totalUnits, offeringPricePerShareCents: cents(s.sharePrice), projectedMonthlyRentCents: cents(s.monthlyRent),
        projectedAnnualYieldBps: projectedYieldBps(s), plannedExitYear: year + s.plannedExitOffsetYears,
        status: s.seedStatus === "COMING_SOON" ? "COMING_SOON" : "FUNDING",
        fundingDeadline: fundedAt ? new Date(fundedAt.getTime() + 10 * DAY) : s.deadlineInDays ? new Date(NOW.getTime() + s.deadlineInDays * DAY) : null,
        propertyManagerName: s.propertyManagerName, entityName: "", createdAt,
        photos: { create: s.photos.map((ph, position) => ({ ...ph, position })) },
      },
    });
    await prisma.property.update({ where: { id: p.id }, data: { entityName: entityName(p.sequence) } });
    props.set(s.slug, { id: p.id, seed: s, totalUnits, fundedAt });

    const docs: [string, "OFFERING_CIRCULAR" | "OPERATING_AGREEMENT" | "APPRAISAL" | "INSPECTION" | "FINANCIAL_STATEMENT" | "TAX_FORM"][] = [
      [`Offering circular — ${s.name}`, "OFFERING_CIRCULAR"],
      [`Operating agreement — ${entityName(p.sequence)}`, "OPERATING_AGREEMENT"],
      ["Pre-purchase inspection report", "INSPECTION"],
      ["Pre-purchase appraisal", "APPRAISAL"],
    ];
    if (fundedAt) docs.push([`Annual financial statement ${year - 1}`, "FINANCIAL_STATEMENT"], [`Schedule K-1 sample ${year - 1}`, "TAX_FORM"]);
    if (s.seedStatus !== "COMING_SOON") {
      await prisma.document.createMany({
        data: docs.map(([title, category], i) => ({ propertyId: p.id, title, category, url: `/documents/placeholder?title=${encodeURIComponent(title)}`, publishedAt: new Date(createdAt.getTime() + i * DAY) })),
      });
    }
    if (!fundedAt) await addAppraisal(p.id, s.purchasePrice, createdAt, "Pre-purchase appraisal", "Independent appraisal ordered before the purchase contract was signed.");
  }
  await prisma.document.createMany({
    data: [
      { title: "Form CRS — customer relationship summary (placeholder)", category: "OFFERING_CIRCULAR", url: "/documents/placeholder?title=Form%20CRS", publishedAt: joined },
      { title: "How fees work (none in this demo)", category: "FINANCIAL_STATEMENT", url: "/documents/placeholder?title=Fees", publishedAt: joined },
    ],
  });

  // ---------- plan the offerings ----------
  type Alloc = { user: U; units: bigint };
  const plan = new Map<string, Alloc[]>();
  const demoDollars: Record<string, number> = { "kenwood-bungalow-columbus": 1500, "holmes-street-duplex-kansas-city": 1000, "seminole-heights-cottage-tampa": 750, "oakwood-brick-ranch-raleigh": 520 };
  for (const [slug, p] of props) {
    const s = p.seed;
    if (s.seedStatus === "COMING_SOON") continue;
    const target = s.fundedPct ? (((p.totalUnits * BigInt(s.fundedPct)) / 100n) / LOT) * LOT : p.totalUnits;
    const allocs: Alloc[] = [];
    let left = target;
    if (demoDollars[slug]) {
      const u = (BigInt(demoDollars[slug]!) * UNITS_PER_SHARE) / BigInt(s.sharePrice) / LOT * LOT;
      allocs.push({ user: demo, units: u });
      left -= u;
    }
    let pool = shuffle(others).slice(0, s.fundedPct ? int(7, 11) : int(13, 16));
    if (slug.startsWith("kenwood")) {
      pool = pool.filter((u) => u.id !== whale.id);
      const u = ((p.totalUnits * 26n) / 100n / LOT) * LOT;
      allocs.push({ user: whale, units: u });
      left -= u;
    }
    const weights = pool.map(() => between(0.4, 1.6));
    const wsum = weights.reduce((a, b) => a + b, 0);
    let assigned = 0n;
    pool.forEach((user, i) => {
      const units = i === pool.length - 1 ? left - assigned : (BigInt(Math.floor((Number(left / LOT) * weights[i]!) / wsum)) * LOT);
      assigned += units;
      allocs.push({ user, units });
    });
    plan.set(slug, shuffle(allocs));
  }

  // ---------- fund wallets ----------
  const need = new Map<string, bigint>();
  for (const [slug, allocs] of plan) {
    const price = cents(props.get(slug)!.seed.sharePrice);
    for (const a of allocs) need.set(a.user.id, (need.get(a.user.id) ?? 0n) + valueOfUnits(a.units, price) + 100n);
  }
  for (const u of others) await depositAt(u.id, (need.get(u.id) ?? 0n) + cents(int(3, 16) * 1000), new Date(joined.getTime() + int(1, 20) * DAY));
  await depositAt(demo.id, cents(5000), new Date(joined.getTime() + 2 * DAY));

  // ---------- run the funded offerings ----------
  for (const [slug, p] of props) {
    if (!p.fundedAt) continue;
    const allocs = plan.get(slug)!;
    const start = p.fundedAt.getTime() - 26 * DAY;
    for (const [i, a] of allocs.entries()) {
      const when = i === allocs.length - 1 ? p.fundedAt : new Date(start + Math.floor((i / allocs.length) * 25 * DAY) + int(0, 20) * 3600 * 1000);
      await buyPrimary({ userId: a.user.id, propertyId: p.id, units: a.units, idempotencyKey: key(), now: when });
    }
    const after = await prisma.property.findUniqueOrThrow({ where: { id: p.id } });
    if (after.status !== "FUNDED") throw new Error(`${slug} should be funded`);
    await prisma.property.update({ where: { id: p.id }, data: { status: "TRADING" } });
    console.log(`  funded ${p.seed.name} (${allocs.length} investors)`);
  }

  // Appraisal schedule for funded properties: evenly spaced from funding to about now.
  const appraisalQueue: { propertyId: string; value: number; date: Date; first: boolean }[] = [];
  for (const p of props.values()) {
    if (!p.fundedAt || !p.seed.appraisalPath) continue;
    const path = p.seed.appraisalPath;
    const span = NOW.getTime() - 20 * DAY - p.fundedAt.getTime();
    path.forEach((m, i) => appraisalQueue.push({ propertyId: p.id, value: Math.round((p.seed.purchasePrice * m) / 500) * 500, date: new Date(p.fundedAt!.getTime() + (span * i) / (path.length - 1)), first: i === 0 }));
  }
  appraisalQueue.sort((a, b) => a.date.getTime() - b.date.getTime());
  const firms = ["Hallmark Valuation Group", "Meridian Appraisal Associates", "Northfield Residential Appraisers"];
  const flushAppraisals = async (until: Date) => {
    while (appraisalQueue.length && appraisalQueue[0]!.date.getTime() <= until.getTime()) {
      const a = appraisalQueue.shift()!;
      await addAppraisal(a.propertyId, a.value, a.date, a.first ? "Purchase price at closing" : `Independent appraisal — ${pick(firms)}`, a.first ? "Shares start slightly below the offering price because closing costs are spent, not kept." : "Sales-comparison approach using recent nearby sales.");
    }
  };
  const nav = async (propertyId: string) => (await prisma.appraisal.findFirstOrThrow({ where: { propertyId }, orderBy: [{ effectiveDate: "desc" }, { createdAt: "desc" }] })).navPerShareCents;
  const scale = (c: bigint, f: number) => (c * BigInt(Math.round(f * 1000))) / 1000n;
  const sharesToUnits = (n: number) => BigInt(Math.round(n * 100)) * LOT;

  const funded = [...props.values()].filter((p) => p.fundedAt);
  const columbus = props.get("kenwood-bungalow-columbus")!;
  const kc = props.get("holmes-street-duplex-kansas-city")!;
  const tampa = props.get("seminole-heights-cottage-tampa")!;

  async function findSeller(propertyId: string, units: bigint, when: Date, exclude: string[] = []) {
    const cutoff = addMonths(when, -settings.holdingPeriodMonths);
    const lots = await prisma.holdingLot.findMany({ where: { propertyId, source: "PRIMARY", remainingUnits: { gte: units * 2n }, acquiredAt: { lte: cutoff }, userId: { notIn: [demo.id, ...exclude] } } });
    const free = [];
    for (const l of lots) {
      const h = await prisma.holding.findUnique({ where: { userId_propertyId: { userId: l.userId, propertyId } } });
      if (h && h.reservedUnits === 0n) free.push(l.userId);
    }
    return free.length ? pick(free) : null;
  }
  async function findBuyer(costCents: bigint, exclude: string[]) {
    const ws = await prisma.wallet.findMany({ where: { availableCents: { gte: costCents + 5000n }, userId: { in: others.map((o) => o.id), notIn: exclude } } });
    return ws.length ? pick(ws).userId : null;
  }
  async function trade(propertyId: string, shares: number, factor: number, when: Date, opts: { seller?: string; buyer?: string; buyShares?: number } = {}) {
    const units = sharesToUnits(shares);
    const price = scale(await nav(propertyId), factor);
    const seller = opts.seller ?? (await findSeller(propertyId, units, when, opts.buyer ? [opts.buyer] : []));
    if (!seller) return;
    const buyUnits = sharesToUnits(opts.buyShares ?? shares);
    const buyer = opts.buyer ?? (await findBuyer(valueOfUnits(buyUnits, price), [seller]));
    if (!buyer) return;
    const buyFirst = rnd() < 0.35;
    const sell = () => placeOrder({ userId: seller, propertyId, side: "SELL", limitPriceCents: price, units, idempotencyKey: key(), now: when });
    const buy = () => placeOrder({ userId: buyer, propertyId, side: "BUY", limitPriceCents: price, units: buyUnits, idempotencyKey: key(), now: new Date(when.getTime() + 40 * 60 * 1000) });
    if (buyFirst && !opts.buyShares) {
      await placeOrder({ userId: buyer, propertyId, side: "BUY", limitPriceCents: price, units: buyUnits, idempotencyKey: key(), now: when });
      await placeOrder({ userId: seller, propertyId, side: "SELL", limitPriceCents: price, units, idempotencyKey: key(), now: new Date(when.getTime() + 40 * 60 * 1000) });
    } else {
      await sell();
      await buy();
    }
  }

  const tradable = (p: { fundedAt?: Date }, when: Date) => !!p.fundedAt && addMonths(p.fundedAt, settings.holdingPeriodMonths).getTime() < when.getTime() - 2 * DAY;

  function financialsFor(s: SeedProperty, offset: number) {
    const rent = s.monthlyRent;
    let vacancy = 0, maintenance = Math.round(s.avgMaintenance * between(0.3, 1.7)), occupancy = 10_000, notes = "", insurance = s.annualInsurance / 12, other = rnd() < 0.2 ? int(25, 90) : 0;
    if (s.slug.startsWith("kenwood") && offset === 7) { vacancy = Math.round(rent * 0.8); occupancy = 2000; notes = "Previous tenants moved out on the 6th. New tenants signed a two-year lease starting the 1st of next month. No dividend this month."; }
    if (s.slug.startsWith("kenwood") && offset === 3) { maintenance = 690; notes = "Replaced the dishwasher and repaired the porch railing."; }
    if (s.slug.startsWith("holmes") && offset === 9) { vacancy = 1550; occupancy = 5000; notes = "North unit vacant for the month between tenants; south unit paid in full."; }
    if (s.slug.startsWith("holmes") && offset === 5) { maintenance = 1850; notes = "Replaced the south unit's water heater and a section of drain line."; }
    if (s.slug.startsWith("seminole") && offset === 10) { maintenance = 1240; notes = "Air-conditioning compressor repair."; }
    if (s.slug.startsWith("seminole") && offset <= 6) { insurance = (s.annualInsurance * 1.23) / 12; if (offset === 6) notes = "Insurance renewed at a 23% higher premium."; }
    const collected = rent - vacancy;
    return {
      grossRentCents: cents(rent), vacancyLossCents: cents(vacancy), managementFeeCents: cents(Math.round(collected * 0.08)), maintenanceCents: cents(maintenance),
      taxesCents: cents(Math.round(s.annualTaxes / 12)), insuranceCents: cents(Math.round(insurance)), hoaCents: cents(s.monthlyHoa), otherExpensesCents: cents(other), occupancyRateBps: occupancy, notes,
    };
  }

  // ---------- the simulation: 12 months of windows, trades, dividends, votes ----------
  let renovationProposal: string | undefined;
  for (let k = 12; k >= 0; k--) {
    const start = monthStart(k);
    await flushAppraisals(start);
    const windowCloses = new Date(start.getTime() + settings.tradingWindowDays * DAY);
    const windowIsPast = windowCloses.getTime() < NOW.getTime();

    if (windowIsPast) {
      const w = await prisma.tradingWindow.create({ data: { opensAt: start, closesAt: windowCloses, status: "OPEN" } });
      for (const p of funded) {
        if (!tradable(p, start)) continue;
        for (let n = int(2, 4); n > 0; n--) await trade(p.id, int(4, 60), between(0.955, 1.05), at(k, int(1, 6), int(13, 20)));
        if (rnd() < 0.5) await trade(p.id, int(30, 70), between(0.98, 1.04), at(k, int(2, 5)), { buyShares: int(8, 25) }); // partial fill, rest expires
      }
      // Scripted events for the demo investor and the reserve.
      if (k === 3) await trade(columbus.id, 20, 1.012, at(k, 3), { buyer: demo.id });
      if (k === 2) await placeOrder({ userId: demo.id, propertyId: columbus.id, side: "SELL", limitPriceCents: scale(await nav(columbus.id), 1.12), units: sharesToUnits(10), idempotencyKey: key(), now: at(k, 2) });
      if (k === 1) await trade(kc.id, 12, 1.008, at(k, 4), { seller: demo.id });
      for (const [p, kk, shares] of [[columbus, 4, 30], [kc, 2, 18], [tampa, 6, 10]] as const) {
        if (k !== kk) continue;
        const seller = await findSeller(p.id, sharesToUnits(shares), at(k, 5));
        if (seller) await sellToReserve({ userId: seller, propertyId: p.id, units: sharesToUnits(shares), idempotencyKey: key(), now: at(k, 5) });
      }
      await closeWindow(w.id, null, windowCloses);
    }

    // Dividend for the previous month: financials on the 5th, paid on the 10th.
    const finMonthOffset = k + 1;
    if (finMonthOffset <= 12) {
      const month = monthKey(monthStart(finMonthOffset));
      for (const p of funded) {
        await saveFinancials({ actorId: admin.id, propertyId: p.id, month, data: financialsFor(p.seed, finMonthOffset) });
        const dist = await previewDistribution({ actorId: admin.id, propertyId: p.id, month });
        if (k >= 1) {
          await approveDistribution({ actorId: admin.id, distributionId: dist.id });
          await payDistribution({ actorId: admin.id, distributionId: dist.id, idempotencyKey: key(), now: at(k, 10, 16) });
        } // k === 0: last month's dividend is left as a DRAFT for the admin to review.
      }
    }

    // Governance history.
    if (k === 5) {
      const p = await createProposal({ actorId: admin.id, data: {
        propertyId: columbus.id, type: "MAJOR_RENOVATION", title: "Replace the original galvanized water pipes",
        summary: "Replace the remaining 1924 galvanized supply pipes with PEX for $11,400, paid from the property's repair reserve and four months of reduced dividends.",
        details: "The inspection before purchase noted that about 60% of the supply plumbing is original galvanized steel. Two pinhole leaks were repaired this year. The manager obtained three bids; the lowest qualified bid is **$11,400**, including drywall repair.\n\nIf approved, $6,800 comes from the repair reserve and the remaining $4,600 is withheld from net income over four months before dividends are calculated.\n\nIf rejected, leaks will be repaired as they occur. The manager estimates $1,500–$3,000 a year, with a risk of water damage that insurance may not fully cover.",
        pros: "- Removes the most likely cause of a large, sudden repair\n- A re-piped house appraises and sells more easily\n- The lowest bid is from the plumber who already knows the house",
        cons: "- Uses the entire repair reserve, which will take about a year to rebuild\n- Dividends are roughly 80% lower for four months\n- The tenants will be without water for parts of three days",
        financialImpact: [
          { label: "Repair reserve", current: "$6,800", proposed: "$0, rebuilt over ~12 months" },
          { label: "Dividends, next four months", current: "About $0.05 per share monthly", proposed: "About $0.01 per share monthly" },
          { label: "Expected plumbing repairs per year", current: "$1,500–$3,000", proposed: "Under $200" },
        ],
        opensAt: at(k, 12), closesAt: at(k, 26), recordDate: at(k, 11),
      } });
      await publishProposal({ actorId: admin.id, proposalId: p.id, now: at(k, 12) });
      renovationProposal = p.id;
      const holders = await prisma.holding.findMany({ where: { propertyId: columbus.id, shareUnits: { gt: 0n } } });
      for (const h of shuffle(holders).slice(0, Math.ceil(holders.length * 0.75))) {
        const choice = h.userId === demo.id ? "FOR" : rnd() < 0.72 ? "FOR" : rnd() < 0.8 ? "AGAINST" : "ABSTAIN";
        await castVote({ userId: h.userId, proposalId: p.id, choice, now: at(k, int(13, 25)) }).catch(() => {});
      }
      await castVote({ userId: whale.id, proposalId: p.id, choice: "FOR", now: at(k, 14) }).catch(() => {});
      await finalizeProposal({ actorId: null, proposalId: p.id, now: at(k, 26, 23) });
    }
    if (k === 7) {
      const p = await createProposal({ actorId: admin.id, data: {
        propertyId: kc.id, type: "CHANGE_MANAGER", title: "Move management to Brookside Residential",
        summary: "Replace Plaza Midtown Property Co. with Brookside Residential, which charges 7% of collected rent instead of 8%.",
        details: "Brookside Residential approached the platform offering a lower fee. They manage about 140 units nearby. The current manager has handled the property without complaint since purchase.\n\nA change would take effect at the start of the next quarter.",
        pros: "- Saves roughly $370 a year in fees\n- Brookside has its own maintenance staff",
        cons: "- The current manager knows the building and both tenants\n- A handover risks missed rent collection or delayed repairs\n- The saving is small relative to the disruption",
        financialImpact: [{ label: "Management fee", current: "8% of collected rent", proposed: "7% of collected rent" }, { label: "Annual saving", current: "—", proposed: "About $370" }],
        opensAt: at(k, 14), closesAt: at(k, 24), recordDate: at(k, 13),
      } });
      await publishProposal({ actorId: admin.id, proposalId: p.id, now: at(k, 14) });
      const holders = await prisma.holding.findMany({ where: { propertyId: kc.id, shareUnits: { gt: 0n } }, orderBy: { shareUnits: "asc" } });
      for (const h of holders.slice(0, 4)) await castVote({ userId: h.userId, proposalId: p.id, choice: rnd() < 0.5 ? "FOR" : "AGAINST", now: at(k, int(15, 23)) }).catch(() => {});
      await finalizeProposal({ actorId: null, proposalId: p.id, now: at(k, 24, 23) });
    }
  }
  await flushAppraisals(NOW);
  void renovationProposal;

  // ---------- current state ----------
  // A window that is open right now, so trading can be tried immediately after seeding.
  const todayStart = new Date(Date.UTC(NOW.getUTCFullYear(), NOW.getUTCMonth(), NOW.getUTCDate()));
  await prisma.tradingWindow.create({ data: { opensAt: new Date(todayStart.getTime() - 2 * DAY), closesAt: new Date(todayStart.getTime() + 12 * DAY), status: "OPEN" } });
  const next = monthStart(-1);
  await prisma.tradingWindow.create({ data: { opensAt: next, closesAt: new Date(next.getTime() + settings.tradingWindowDays * DAY), status: "SCHEDULED" } });

  // Resting orders: a visible book on both trading properties.
  const soon = (m: number) => new Date(NOW.getTime() - m * 60 * 1000);
  for (const p of [columbus, kc]) {
    const n = await nav(p.id);
    let minute = 600;
    for (const f of [1.018, 1.018, 1.03, 1.045, 1.07]) {
      const units = sharesToUnits(int(8, 45));
      const seller = await findSeller(p.id, units, NOW);
      if (seller) await placeOrder({ userId: seller, propertyId: p.id, side: "SELL", limitPriceCents: scale(n, f), units, idempotencyKey: key(), now: soon((minute -= 37)) });
    }
    for (const f of [0.995, 0.985, 0.985, 0.965, 0.94]) {
      const units = sharesToUnits(int(6, 40));
      const buyer = await findBuyer(valueOfUnits(units, n), []);
      if (buyer) await placeOrder({ userId: buyer, propertyId: p.id, side: "BUY", limitPriceCents: scale(n, f), units, idempotencyKey: key(), now: soon((minute -= 41)) });
    }
  }
  await placeOrder({ userId: demo.id, propertyId: columbus.id, side: "SELL", limitPriceCents: scale(await nav(columbus.id), 1.04), units: sharesToUnits(15), idempotencyKey: key(), now: soon(95) });

  // Offerings in progress.
  for (const [slug, p] of props) {
    if (p.seed.seedStatus !== "FUNDING") continue;
    const allocs = plan.get(slug)!;
    const span = slug.includes("raleigh") ? 19 : 9;
    for (const [i, a] of allocs.entries()) {
      await buyPrimary({ userId: a.user.id, propertyId: p.id, units: a.units, idempotencyKey: key(), now: new Date(NOW.getTime() - (span - (i / allocs.length) * (span - 1)) * DAY) });
    }
  }

  // An open proposal on the duplex.
  {
    const p = await createProposal({ actorId: admin.id, data: {
      propertyId: kc.id, type: "REFINANCE", title: "Take a $90,000 mortgage and pay it out to holders",
      summary: "Borrow $90,000 against the duplex at a fixed 6.6% for 30 years and distribute the cash to holders now, about $5.42 per share. Monthly dividends would fall by about 30%.",
      details: "The duplex is owned outright. A local credit union has offered a **$90,000** loan (about 28% of the appraised value) at 6.6% fixed, with a monthly payment of $575.\n\nAfter loan costs of about $2,300, roughly **$87,700** would be paid to holders in proportion to their shares.\n\nDebt makes results more extreme in both directions. If the property's value rises, holders keep the whole gain on a smaller amount of their own money. If rents fall or a unit sits empty, the loan payment is still due, and dividends could stop for a time.",
      pros: "- Returns about 27% of the original investment in cash now\n- The rate is fixed; the payment cannot rise\n- At 28% of value the loan is conservative",
      cons: "- Dividends fall by about $575 a month in total, roughly 30%\n- A vacancy month could mean no dividend at all\n- The loan must be repaid from sale proceeds before holders are paid",
      financialImpact: [
        { label: "Cash paid to holders now", current: "$0", proposed: "About $5.42 per share" },
        { label: "Typical monthly dividend", current: "About $0.11 per share", proposed: "About $0.08 per share" },
        { label: "Debt on the property", current: "None", proposed: "$90,000 at 6.6% fixed" },
      ],
      opensAt: daysAgo(5), closesAt: new Date(NOW.getTime() + 9 * DAY), recordDate: daysAgo(6),
    } });
    await publishProposal({ actorId: admin.id, proposalId: p.id, now: daysAgo(5) });
    const holders = await prisma.holding.findMany({ where: { propertyId: kc.id, shareUnits: { gt: 0n }, userId: { not: demo.id } } });
    for (const h of shuffle(holders).slice(0, 6)) await castVote({ userId: h.userId, proposalId: p.id, choice: rnd() < 0.45 ? "FOR" : rnd() < 0.85 ? "AGAINST" : "ABSTAIN", now: daysAgo(int(1, 4)) }).catch(() => {});
  }

  // The planned exit vote on the Tampa cottage, created by the same job the cron runs.
  await createExitVotes(daysAgo(4));
  const exitVote = await prisma.proposal.findFirstOrThrow({ where: { propertyId: tampa.id, isPlannedExit: true } });
  {
    const holders = await prisma.holding.findMany({ where: { propertyId: tampa.id, shareUnits: { gt: 0n }, userId: { not: demo.id } } });
    for (const h of shuffle(holders).slice(0, 5)) await castVote({ userId: h.userId, proposalId: exitVote.id, choice: rnd() < 0.6 ? "FOR" : "AGAINST", now: daysAgo(int(1, 3)) }).catch(() => {});
  }

  // ---------- daily portfolio snapshots, rebuilt from the ledger ----------
  const allProps = await prisma.property.findMany({ select: { id: true, offeringPricePerShareCents: true } });
  const appraisals = await prisma.appraisal.findMany({ orderBy: { effectiveDate: "asc" } });
  const navAt = (propertyId: string, d: Date) => {
    let v = allProps.find((p) => p.id === propertyId)!.offeringPricePerShareCents;
    for (const a of appraisals) if (a.propertyId === propertyId && a.effectiveDate.getTime() <= d.getTime()) v = a.navPerShareCents;
    return v;
  };
  const SNAP_DAYS = 365;
  for (const u of [demo, ...others]) {
    const entries = await prisma.ledgerEntry.findMany({ where: { userId: u.id, account: "USER_WALLET" }, orderBy: { createdAt: "asc" } });
    let i = 0, cash = 0n;
    const units = new Map<string, bigint>();
    const rows = [];
    for (let d = SNAP_DAYS; d >= 0; d--) {
      const day = new Date(todayStart.getTime() - d * DAY);
      const end = new Date(day.getTime() + DAY - 1);
      while (i < entries.length && entries[i]!.createdAt.getTime() <= end.getTime()) {
        const e = entries[i++]!;
        cash += e.amountCents;
        if (e.propertyId && e.shareUnits) units.set(e.propertyId, (units.get(e.propertyId) ?? 0n) + e.shareUnits);
      }
      let holdingsCents = 0n;
      for (const [pid, n] of units) holdingsCents += valueOfUnits(n, navAt(pid, end));
      rows.push({ userId: u.id, date: day, cashCents: cash, holdingsCents, totalCents: cash + holdingsCents });
    }
    await prisma.portfolioSnapshot.createMany({ data: rows });
  }

  // Old notifications are read; the recent ones stay unread.
  await prisma.notification.updateMany({ where: { userId: { not: demo.id } }, data: { readAt: NOW } });
  const recent = await prisma.notification.findMany({ where: { userId: demo.id }, orderBy: { createdAt: "desc" }, take: 5, select: { id: true } });
  await prisma.notification.updateMany({ where: { userId: demo.id, id: { notIn: recent.map((r) => r.id) } }, data: { readAt: NOW } });
  await prisma.idempotencyKey.deleteMany({ where: { key: { startsWith: "seed-" } } });

  // ---------- prove the books balance ----------
  const report = await reconcile();
  if (!report.ok) {
    console.error(report.issues.join("\n"));
    throw new Error("Seed finished but the books do not reconcile");
  }
  const counts = { users: await prisma.user.count(), ledger: await prisma.ledgerEntry.count(), trades: await prisma.trade.count(), dividends: await prisma.dividendPayment.count(), votes: await prisma.vote.count() };
  console.log(`Done. ${BRAND.name} demo seeded and reconciled:`, counts);
  console.log(`  Admin:    ${DEMO.admin.email} / ${DEMO.admin.password}`);
  console.log(`  Investor: ${DEMO.investor.email} / ${DEMO.investor.password}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
