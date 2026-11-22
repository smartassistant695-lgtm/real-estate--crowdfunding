import "server-only";
import { prisma } from "@/lib/db";
import { UNITS_PER_SHARE, mulDivFloor, unitsForAmount, primaryCost, valueOfUnits } from "@/lib/domain/money";
import { getSettings } from "@/lib/settings";
import { listPropertyCards } from "@/lib/queries";

const MICRO = 1_000_000n;

/** Cents paid on `units` at a per-share rate held in millionths of a cent. Rounds down. */
export function dividendOn(units: bigint, perShareMicroCents: bigint): bigint {
  return mulDivFloor(units, perShareMicroCents, UNITS_PER_SHARE * MICRO);
}

/**
 * Everything the home page prints, read from the database. Nothing here is a written-in figure:
 * if the seed changes, the page changes with it.
 */
export async function loadHome() {
  const settings = await getSettings();

  // The property with the longest paid record is the one we can show a real year for.
  const trading = await prisma.property.findMany({
    where: { status: "TRADING" },
    include: {
      photos: { orderBy: { position: "asc" } },
      appraisals: { orderBy: [{ effectiveDate: "asc" }, { createdAt: "asc" }] },
      reserve: true,
      _count: { select: { distributions: { where: { status: "PAID" } } } },
    },
  });
  trading.sort((a, b) => b._count.distributions - a._count.distributions || (a.fundedAt?.getTime() ?? 0) - (b.fundedAt?.getTime() ?? 0));
  const featured = trading[0] ?? null;

  // Cheapest open offering: the headline is literally true today.
  const offering = await prisma.property.findFirst({
    where: { status: "FUNDING" },
    orderBy: { offeringPricePerShareCents: "asc" },
    include: { photos: { orderBy: { position: "asc" } } },
  });

  let year: null | {
    rows: {
      month: string;
      rentCollectedCents: bigint;
      expensesCents: bigint;
      netIncomeCents: bigint;
      reserveCents: bigint | null;
      paidCents: bigint | null;
      perShareMicroCents: bigint | null;
      status: "PAID" | "APPROVED" | "DRAFT" | "NONE";
      notes: string;
    }[];
    totals: { rent: bigint; expenses: bigint; net: bigint; reserve: bigint; paid: bigint; perShareMicro: bigint; paidMonths: number };
  } = null;

  let example: null | {
    amountCents: bigint;
    priceCents: bigint;
    units: bigint;
    costCents: bigint;
    lastMonth: string;
    lastPerShareMicroCents: bigint;
    lastDividendCents: bigint;
    yearDividendCents: bigint;
    yearMonths: number;
    navPerShareCents: bigint | null;
    valueAtNavCents: bigint | null;
  } = null;

  if (featured) {
    const [fins, dists] = await Promise.all([
      prisma.monthlyFinancials.findMany({ where: { propertyId: featured.id }, orderBy: { month: "desc" }, take: 12 }),
      prisma.dividendDistribution.findMany({ where: { propertyId: featured.id }, orderBy: { month: "desc" }, take: 13 }),
    ]);
    const byMonth = new Map(dists.map((d) => [d.month, d]));
    const rows = fins.reverse().map((f) => {
      const d = byMonth.get(f.month);
      const rentCollected = f.grossRentCents - f.vacancyLossCents;
      return {
        month: f.month,
        rentCollectedCents: rentCollected,
        expensesCents: rentCollected - f.netIncomeCents,
        netIncomeCents: f.netIncomeCents,
        reserveCents: d ? d.reserveAllocationCents : null,
        paidCents: d && d.status === "PAID" ? d.distributedCents : null,
        perShareMicroCents: d && d.status === "PAID" ? d.perShareMicroCents : null,
        status: (d?.status ?? "NONE") as "PAID" | "APPROVED" | "DRAFT" | "NONE",
        notes: f.notes,
      };
    });
    const paid = rows.filter((r) => r.status === "PAID");
    year = {
      rows,
      totals: {
        rent: rows.reduce((a, r) => a + r.rentCollectedCents, 0n),
        expenses: rows.reduce((a, r) => a + r.expensesCents, 0n),
        net: rows.reduce((a, r) => a + r.netIncomeCents, 0n),
        reserve: rows.reduce((a, r) => a + (r.reserveCents ?? 0n), 0n),
        paid: paid.reduce((a, r) => a + (r.paidCents ?? 0n), 0n),
        perShareMicro: paid.reduce((a, r) => a + (r.perShareMicroCents ?? 0n), 0n),
        paidMonths: paid.length,
      },
    };

    const lastPaid = [...paid].reverse()[0];
    const price = featured.offeringPricePerShareCents;
    const amount = settings.minInvestmentCents;
    const units = unitsForAmount(amount, price);
    const nav = featured.appraisals.at(-1)?.navPerShareCents ?? null;
    if (lastPaid && lastPaid.perShareMicroCents !== null) {
      example = {
        amountCents: amount,
        priceCents: price,
        units,
        costCents: primaryCost(units, price),
        lastMonth: lastPaid.month,
        lastPerShareMicroCents: lastPaid.perShareMicroCents,
        lastDividendCents: dividendOn(units, lastPaid.perShareMicroCents),
        // Each month is rounded down on its own, as a payment would be.
        yearDividendCents: paid.reduce((a, r) => a + dividendOn(units, r.perShareMicroCents ?? 0n), 0n),
        yearMonths: paid.length,
        navPerShareCents: nav,
        valueAtNavCents: nav ? valueOfUnits(units, nav) : null,
      };
    }
  }

  // Closed votes with their real tallies. Quorum is measured on uncapped shares.
  const closed = await prisma.proposal.findMany({
    where: { status: { in: ["PASSED", "FAILED", "NO_QUORUM"] } },
    orderBy: { closesAt: "desc" },
    take: 2,
    include: { property: { select: { name: true, city: true, slug: true } }, votes: { select: { rawShareUnits: true } } },
  });
  const votes = closed.map((p) => ({
    id: p.id,
    title: p.title,
    status: p.status,
    property: p.property,
    closesAt: p.closesAt,
    outstandingUnits: p.outstandingUnits,
    forUnits: p.forUnits,
    againstUnits: p.againstUnits,
    abstainUnits: p.abstainUnits,
    participatingUnits: p.votes.reduce((a, v) => a + v.rawShareUnits, 0n),
    voters: p.votes.length,
    quorumBps: p.quorumBps,
    passThresholdBps: p.passThresholdBps,
  }));

  // A real case of shares trading below what holders paid, for the risk section.
  const below = await prisma.property.findMany({
    where: { status: "TRADING", lastTradePriceCents: { not: null } },
    select: { name: true, city: true, offeringPricePerShareCents: true, lastTradePriceCents: true, lastTradeAt: true, appraisals: { orderBy: { effectiveDate: "desc" }, take: 1, select: { navPerShareCents: true } } },
  });
  const tradedBelow = below.find((p) => p.lastTradePriceCents !== null && p.lastTradePriceCents < p.offeringPricePerShareCents) ?? null;

  const now = new Date();
  const [openWindow, nextWindow, propertyCount, openCards] = await Promise.all([
    prisma.tradingWindow.findFirst({ where: { status: "OPEN", propertyId: null, opensAt: { lte: now }, closesAt: { gt: now } }, orderBy: { closesAt: "asc" } }),
    prisma.tradingWindow.findFirst({ where: { status: "SCHEDULED", propertyId: null, opensAt: { gt: now } }, orderBy: { opensAt: "asc" } }),
    prisma.property.count({ where: { status: { not: "CANCELLED" } } }),
    listPropertyCards({ status: { in: ["FUNDING", "COMING_SOON"] } }, [{ fundingDeadline: "asc" }]),
  ]);

  return { settings, featured, offering, year, example, votes, tradedBelow, openWindow, nextWindow, propertyCount, openCards };
}
