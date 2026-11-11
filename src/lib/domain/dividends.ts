import { applyBps, UNITS_PER_SHARE } from "./money";

export const MICRO = 1_000_000n; // micro-cents per cent

export type HolderUnits = { userId: string; units: bigint };

export type DistributionPlan = {
  netIncomeCents: bigint;
  carryInCents: bigint;
  /** Portion of net income sent to the liquidity reserve. */
  reserveAllocationCents: bigint;
  /** What was available to distribute: net income − reserve + carry-in. */
  poolCents: bigint;
  /** The published rate, in millionths of a cent per whole share. Same for every holder. */
  perShareMicroCents: bigint;
  /** Sum of payments. */
  distributedCents: bigint;
  /** poolCents − distributedCents; carried into next month's pool. */
  roundingRemainderCents: bigint;
  outstandingUnits: bigint;
  payments: { userId: string; units: bigint; amountCents: bigint }[];
};

/**
 * Work out one month's dividend for one property.
 *
 * 1. A share of net income (reserveBps) goes to the liquidity reserve, rounded down.
 * 2. The rest, plus any cents carried from last month, is the pool.
 * 3. One per-share rate is fixed for everybody: pool ÷ shares outstanding, truncated to a
 *    millionth of a cent.
 * 4. Each holder is owed units × rate. Those amounts are rounded to whole cents with the
 *    largest-remainder method, so the cents handed out equal the whole cents owed in total.
 * 5. Whatever is left of the pool (a fraction of a cent of entitlement, i.e. 0 or a few cents)
 *    is carried to next month. Nothing is lost and nobody is paid from thin air.
 *
 * A month with zero or negative net income pays nothing; the carry rolls forward untouched.
 */
export function planDistribution(input: {
  netIncomeCents: bigint;
  carryInCents: bigint;
  reserveBps: number;
  holders: readonly HolderUnits[];
}): DistributionPlan {
  const holders = input.holders.filter((h) => h.units > 0n);
  const outstandingUnits = holders.reduce((a, h) => a + h.units, 0n);
  const carryInCents = input.carryInCents;
  if (carryInCents < 0n) throw new RangeError("Carry-in cannot be negative");

  const empty = (pool: bigint, reserve: bigint): DistributionPlan => ({
    netIncomeCents: input.netIncomeCents,
    carryInCents,
    reserveAllocationCents: reserve,
    poolCents: pool,
    perShareMicroCents: 0n,
    distributedCents: 0n,
    roundingRemainderCents: pool,
    outstandingUnits,
    payments: holders.map((h) => ({ userId: h.userId, units: h.units, amountCents: 0n })),
  });

  if (input.netIncomeCents <= 0n) return empty(carryInCents, 0n);

  const reserveAllocationCents = applyBps(input.netIncomeCents, input.reserveBps);
  const poolCents = input.netIncomeCents - reserveAllocationCents + carryInCents;
  if (outstandingUnits === 0n) return empty(poolCents, reserveAllocationCents);

  // Rate in micro-cents per whole share, truncated.
  const perShareMicroCents = (poolCents * MICRO * UNITS_PER_SHARE) / outstandingUnits;
  // Each holder's entitlement in (micro-cents × micro-shares): exact integers.
  const SCALE = MICRO * UNITS_PER_SHARE;
  const owed = holders.map((h) => h.units * perShareMicroCents);
  const totalOwed = owed.reduce((a, b) => a + b, 0n);
  const distributedCents = totalOwed / SCALE; // whole cents owed in total; ≤ poolCents

  const base = owed.map((o) => o / SCALE);
  let leftover = distributedCents - base.reduce((a, b) => a + b, 0n);
  const order = holders
    .map((h, i) => ({ i, r: (owed[i] ?? 0n) % SCALE, units: h.units, userId: h.userId }))
    .sort((a, b) =>
      a.r !== b.r ? (a.r > b.r ? -1 : 1) : a.units !== b.units ? (a.units > b.units ? -1 : 1) : a.userId < b.userId ? -1 : 1,
    );
  for (const { i } of order) {
    if (leftover === 0n) break;
    base[i] = (base[i] ?? 0n) + 1n;
    leftover -= 1n;
  }

  return {
    netIncomeCents: input.netIncomeCents,
    carryInCents,
    reserveAllocationCents,
    poolCents,
    perShareMicroCents,
    distributedCents,
    roundingRemainderCents: poolCents - distributedCents,
    outstandingUnits,
    payments: holders.map((h, i) => ({ userId: h.userId, units: h.units, amountCents: base[i] ?? 0n })),
  };
}

/** Net income from a month's line items. Vacancy loss and every expense are entered as positives. */
export function netIncome(f: {
  grossRentCents: bigint;
  vacancyLossCents: bigint;
  managementFeeCents: bigint;
  maintenanceCents: bigint;
  taxesCents: bigint;
  insuranceCents: bigint;
  hoaCents: bigint;
  otherExpensesCents: bigint;
}): bigint {
  return (
    f.grossRentCents -
    f.vacancyLossCents -
    f.managementFeeCents -
    f.maintenanceCents -
    f.taxesCents -
    f.insuranceCents -
    f.hoaCents -
    f.otherExpensesCents
  );
}

/** "$0.0731" style per-share figure from micro-cents per share. Four decimals of a dollar. */
export function formatPerShare(perShareMicroCents: bigint): string {
  // micro-cents → ten-thousandths of a dollar (1 = $0.0001 = 0.01 cent = 10,000 micro-cents)
  const tenThousandths = perShareMicroCents / 10_000n;
  const dollars = tenThousandths / 10_000n;
  const frac = (tenThousandths % 10_000n).toString().padStart(4, "0");
  return `$${dollars}.${frac}`;
}
