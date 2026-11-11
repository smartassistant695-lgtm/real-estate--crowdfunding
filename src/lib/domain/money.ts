/**
 * Money and share arithmetic. THE ONLY PLACE ROUNDING HAPPENS.
 *
 *  - Money is an integer number of cents (bigint).
 *  - Share quantities are integers in micro-shares: 1 share = 1,000,000 units (bigint).
 *  - Prices are cents per ONE WHOLE share.
 *  - Rates are basis points (bps): 10,000 bps = 100%.
 *
 * Rounding rules (each chosen so that no cent is ever created or lost):
 *  - Buying in an offering: units round DOWN, cost rounds UP. The buyer never pays more than
 *    the amount they typed, and the offering never receives less than the shares are worth.
 *  - Secondary trades and buybacks: the cash total rounds DOWN and that one figure is used for
 *    both sides, so the buyer pays exactly what the seller receives. Rounding down (rather than
 *    half-up) guarantees the cash held for a buy order always covers its fills.
 *  - Valuations for display round DOWN.
 *  - Splitting a pot among holders uses the largest-remainder method (see allocate*).
 */

export const UNITS_PER_SHARE = 1_000_000n;
export const BPS = 10_000n;
/** Secondary-market orders are placed in steps of 0.01 share so a fill is never worth < 1 cent. */
export const ORDER_LOT_UNITS = 10_000n;
/** Lowest allowed limit price on the secondary market: $1.00 per share. */
export const MIN_ORDER_PRICE_CENTS = 100n;

function assertNonNegative(...values: bigint[]): void {
  for (const v of values) if (v < 0n) throw new RangeError("Expected a non-negative amount");
}

/** floor(a * b / d) for non-negative inputs. */
export function mulDivFloor(a: bigint, b: bigint, d: bigint): bigint {
  assertNonNegative(a, b);
  if (d <= 0n) throw new RangeError("Division by zero or negative divisor");
  return (a * b) / d;
}

/** ceil(a * b / d) for non-negative inputs. */
export function mulDivCeil(a: bigint, b: bigint, d: bigint): bigint {
  assertNonNegative(a, b);
  if (d <= 0n) throw new RangeError("Division by zero or negative divisor");
  const n = a * b;
  return n % d === 0n ? n / d : n / d + 1n;
}

/** Micro-shares a dollar amount buys at a per-share price. Rounds down. */
export function unitsForAmount(amountCents: bigint, pricePerShareCents: bigint): bigint {
  return mulDivFloor(amountCents, UNITS_PER_SHARE, pricePerShareCents);
}

/** Cost of units in an initial offering. Rounds up to the cent. */
export function primaryCost(units: bigint, pricePerShareCents: bigint): bigint {
  return mulDivCeil(units, pricePerShareCents, UNITS_PER_SHARE);
}

/** Cash that changes hands in a trade or buyback. Rounds down; used for both sides. */
export function tradeNotional(units: bigint, pricePerShareCents: bigint): bigint {
  return mulDivFloor(units, pricePerShareCents, UNITS_PER_SHARE);
}

/** Cash to hold for a buy order so that any sequence of fills is covered. Rounds up. */
export function buyOrderHold(units: bigint, limitPriceCents: bigint): bigint {
  return mulDivCeil(units, limitPriceCents, UNITS_PER_SHARE);
}

/** Value of a position at a per-share price, for display and snapshots. Rounds down. */
export function valueOfUnits(units: bigint, pricePerShareCents: bigint): bigint {
  return mulDivFloor(units, pricePerShareCents, UNITS_PER_SHARE);
}

/** amount × bps / 10,000, rounded down. */
export function applyBps(amountCents: bigint, bps: number | bigint): bigint {
  return mulDivFloor(amountCents, BigInt(bps), BPS);
}

/** Per-share net asset value from a total value and the shares outstanding. Rounds down. */
export function perShare(totalCents: bigint, outstandingUnits: bigint): bigint {
  if (outstandingUnits <= 0n) return 0n;
  return mulDivFloor(totalCents, UNITS_PER_SHARE, outstandingUnits);
}

/**
 * Split `total` across `weights` in proportion, with every cent accounted for.
 * Largest-remainder (Hamilton) method: everyone gets their share rounded down, then the
 * leftover cents go one each to the largest fractional remainders. Ties break on larger
 * weight, then on earlier position, so the result is deterministic.
 * Returns all zeros when the weights sum to zero (the caller decides what to do with `total`).
 */
export function allocateLargestRemainder(total: bigint, weights: readonly bigint[]): bigint[] {
  assertNonNegative(total, ...weights);
  const sum = weights.reduce((a, b) => a + b, 0n);
  if (sum === 0n) return weights.map(() => 0n);
  const base = weights.map((w) => (total * w) / sum);
  const rem = weights.map((w, i) => ({ i, r: (total * w) % sum, w }));
  let leftover = total - base.reduce((a, b) => a + b, 0n);
  rem.sort((a, b) => (a.r !== b.r ? (a.r > b.r ? -1 : 1) : a.w !== b.w ? (a.w > b.w ? -1 : 1) : a.i - b.i));
  for (const { i } of rem) {
    if (leftover === 0n) break;
    base[i] = (base[i] ?? 0n) + 1n;
    leftover -= 1n;
  }
  return base;
}

// ---------- parsing (strings from forms → integers; never via floats) ----------

/** "1,234.56" or "$26" → 123456n / 2600n. Returns null for anything malformed or negative. */
export function parseDollarsToCents(input: string): bigint | null {
  const raw = input.trim().replace(/^\$/, "");
  // Commas are accepted only as thousands separators ("1,234.56"), never as a decimal mark ("1,50").
  if (!/^(\d{1,3}(,\d{3}){1,3}|\d{1,12})(\.\d{1,2})?$/.test(raw)) return null;
  const s = raw.replace(/,/g, "");
  const [whole = "0", frac = ""] = s.split(".");
  return BigInt(whole) * 100n + BigInt(frac.padEnd(2, "0"));
}

/** "2.5" shares → 2_500_000n units. Up to six decimals. */
export function parseSharesToUnits(input: string): bigint | null {
  const raw = input.trim();
  if (!/^(\d{1,3}(,\d{3}){1,2}|\d{1,9})(\.\d{1,6})?$/.test(raw)) return null;
  const s = raw.replace(/,/g, "");
  const [whole = "0", frac = ""] = s.split(".");
  return BigInt(whole) * UNITS_PER_SHARE + BigInt(frac.padEnd(6, "0"));
}

/** "5" or "5.25" percent → 500 / 525 bps. */
export function parsePercentToBps(input: string): number | null {
  const s = input.trim().replace(/%$/, "");
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(s)) return null;
  const [whole = "0", frac = ""] = s.split(".");
  const bps = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  return bps > 10_000 ? null : bps; // nothing above 100% is a valid rate here
}

// ---------- formatting ----------

function group(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** 123456n → "$1,234.56". `sign: true` prefixes "+" on gains. `whole: true` drops ".00". */
export function formatCents(cents: bigint, opts: { sign?: boolean; whole?: boolean } = {}): string {
  const neg = cents < 0n;
  const abs = neg ? -cents : cents;
  const dollars = group((abs / 100n).toString());
  const c = (abs % 100n).toString().padStart(2, "0");
  const body = opts.whole && c === "00" ? `$${dollars}` : `$${dollars}.${c}`;
  return `${neg ? "−" : opts.sign && cents > 0n ? "+" : ""}${body}`;
}

/** Compact dollars for large headline figures: 41250000n → "$412,500". */
export function formatCentsWhole(cents: bigint): string {
  const neg = cents < 0n;
  const abs = neg ? -cents : cents;
  const rounded = (abs + 50n) / 100n;
  return `${neg && rounded > 0n ? "−" : ""}$${group(rounded.toString())}`;
}

/** 2_500_000n → "2.5"; trims trailing zeros, keeps up to `maxDecimals` (truncating). */
export function formatUnits(units: bigint, maxDecimals = 4): string {
  const neg = units < 0n;
  const abs = neg ? -units : units;
  const whole = group((abs / UNITS_PER_SHARE).toString());
  let frac = (abs % UNITS_PER_SHARE).toString().padStart(6, "0").slice(0, maxDecimals);
  frac = frac.replace(/0+$/, "");
  return `${neg ? "−" : ""}${whole}${frac ? `.${frac}` : ""}`;
}

/** 525 → "5.25%". */
export function formatBps(bps: number | bigint, opts: { sign?: boolean; decimals?: number } = {}): string {
  const n = Number(bps);
  const d = opts.decimals ?? 2;
  const abs = Math.abs(n) / 100;
  const body = `${abs.toFixed(d).replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "")}%`;
  return `${n < 0 ? "−" : opts.sign && n > 0 ? "+" : ""}${body}`;
}

/** Ratio a/b in bps, rounded down toward zero. Safe for display percentages. */
export function ratioBps(a: bigint, b: bigint): number {
  if (b === 0n) return 0;
  return Number((a * BPS) / b);
}

/** Cents → plain decimal string for form inputs: 2600n → "26.00". */
export function centsToInput(cents: bigint): string {
  const abs = cents < 0n ? -cents : cents;
  return `${cents < 0n ? "-" : ""}${abs / 100n}.${(abs % 100n).toString().padStart(2, "0")}`;
}

/** For charts only. Never feed the result back into money math. */
export function centsToNumber(cents: bigint): number {
  return Number(cents) / 100;
}
