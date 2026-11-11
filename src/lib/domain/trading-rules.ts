import { applyBps, BPS, mulDivCeil, mulDivFloor, tradeNotional, UNITS_PER_SHARE } from "./money";

/** Allowed limit-price band around the latest appraised value per share. Inclusive. */
export function circuitBreakerBand(navPerShareCents: bigint, bandBps: number): { minCents: bigint; maxCents: bigint } {
  const b = BigInt(bandBps);
  return {
    minCents: mulDivCeil(navPerShareCents, b >= BPS ? 0n : BPS - b, BPS),
    maxCents: mulDivFloor(navPerShareCents, BPS + b, BPS),
  };
}

export function isPriceWithinBand(priceCents: bigint, navPerShareCents: bigint, bandBps: number): boolean {
  const { minCents, maxCents } = circuitBreakerBand(navPerShareCents, bandBps);
  return priceCents >= minCents && priceCents <= maxCents;
}

/** Price the reserve pays per share: appraised value less the discount, rounded down. */
export function buybackPrice(navPerShareCents: bigint, discountBps: number): bigint {
  return navPerShareCents - mulDivCeil(navPerShareCents, BigInt(discountBps), BPS);
}

export type BuybackQuote = {
  priceCents: bigint;
  /** Cash still available this month: the lesser of what is left under the cap and the reserve's balance. */
  budgetCents: bigint;
  /** Most units the reserve can buy right now. */
  maxUnits: bigint;
  proceedsCents: bigint;
  ok: boolean;
  reason?: "NO_BUDGET" | "EXCEEDS_BUDGET" | "TOO_SMALL";
};

/** Quote a "sell to reserve" request against the monthly cap and the reserve's cash. */
export function quoteBuyback(input: {
  units: bigint;
  navPerShareCents: bigint;
  discountBps: number;
  monthlyCapCents: bigint;
  usedThisMonthCents: bigint;
  reserveBalanceCents: bigint;
}): BuybackQuote {
  const priceCents = buybackPrice(input.navPerShareCents, input.discountBps);
  const capLeft = input.monthlyCapCents > input.usedThisMonthCents ? input.monthlyCapCents - input.usedThisMonthCents : 0n;
  const budgetCents = capLeft < input.reserveBalanceCents ? capLeft : input.reserveBalanceCents;
  const maxUnits = priceCents > 0n ? mulDivFloor(budgetCents, UNITS_PER_SHARE, priceCents) : 0n;
  const proceedsCents = tradeNotional(input.units, priceCents);
  if (budgetCents <= 0n || priceCents <= 0n) return { priceCents, budgetCents, maxUnits, proceedsCents, ok: false, reason: "NO_BUDGET" };
  if (proceedsCents <= 0n) return { priceCents, budgetCents, maxUnits, proceedsCents, ok: false, reason: "TOO_SMALL" };
  if (proceedsCents > budgetCents) return { priceCents, budgetCents, maxUnits, proceedsCents, ok: false, reason: "EXCEEDS_BUDGET" };
  return { priceCents, budgetCents, maxUnits, proceedsCents, ok: true };
}

/** The scheduled window for a month: opens 00:00 UTC on the 1st, closes `days` days later. */
export function windowForMonth(year: number, monthIndex0: number, days: number): { opensAt: Date; closesAt: Date } {
  const opensAt = new Date(Date.UTC(year, monthIndex0, 1));
  const closesAt = new Date(Date.UTC(year, monthIndex0, 1 + days));
  return { opensAt, closesAt };
}

export function isWithinWindow(w: { opensAt: Date; closesAt: Date }, now: Date): boolean {
  return w.opensAt.getTime() <= now.getTime() && now.getTime() < w.closesAt.getTime();
}

/** "YYYY-MM" for a date, in UTC. */
export function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Last instant of a "YYYY-MM" month (UTC): the dividend record date. */
export function endOfMonth(month: string): Date {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 1) - 1);
}

export function monthLabel(month: string, style: "long" | "short" = "long"): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString("en-US", { month: style, year: "numeric", timeZone: "UTC" });
}

export { applyBps };
