import { describe, expect, it } from "vitest";
import {
  allocateLargestRemainder,
  applyBps,
  BPS,
  buyOrderHold,
  centsToInput,
  centsToNumber,
  formatBps,
  formatCents,
  formatCentsWhole,
  formatUnits,
  MIN_ORDER_PRICE_CENTS,
  mulDivCeil,
  mulDivFloor,
  ORDER_LOT_UNITS,
  parseDollarsToCents,
  parsePercentToBps,
  parseSharesToUnits,
  perShare,
  primaryCost,
  ratioBps,
  tradeNotional,
  unitsForAmount,
  UNITS_PER_SHARE,
  valueOfUnits,
} from "@/lib/domain/money";
import { prng, sum } from "./_prng";

const MINUS = "−"; // the typographic minus the formatters use

describe("constants", () => {
  it("has the documented scales", () => {
    expect(UNITS_PER_SHARE).toBe(1_000_000n);
    expect(BPS).toBe(10_000n);
    expect(ORDER_LOT_UNITS).toBe(10_000n);
    expect(MIN_ORDER_PRICE_CENTS).toBe(100n);
  });

  it("the smallest order at the lowest price is worth exactly one cent", () => {
    expect(tradeNotional(ORDER_LOT_UNITS, MIN_ORDER_PRICE_CENTS)).toBe(1n);
  });
});

describe("mulDivFloor / mulDivCeil", () => {
  it("floors and ceils inexact divisions", () => {
    expect(mulDivFloor(7n, 3n, 2n)).toBe(10n);
    expect(mulDivCeil(7n, 3n, 2n)).toBe(11n);
  });

  it("agree when the division is exact", () => {
    expect(mulDivFloor(6n, 4n, 8n)).toBe(3n);
    expect(mulDivCeil(6n, 4n, 8n)).toBe(3n);
  });

  it("return 0 for zero numerators", () => {
    expect(mulDivFloor(0n, 5n, 3n)).toBe(0n);
    expect(mulDivCeil(0n, 5n, 3n)).toBe(0n);
    expect(mulDivCeil(5n, 0n, 3n)).toBe(0n);
  });

  it("ceil of a tiny positive fraction is 1", () => {
    expect(mulDivCeil(1n, 1n, 1_000_000n)).toBe(1n);
    expect(mulDivFloor(1n, 1n, 1_000_000n)).toBe(0n);
  });

  it("reject negative operands", () => {
    expect(() => mulDivFloor(-1n, 1n, 1n)).toThrow(RangeError);
    expect(() => mulDivFloor(1n, -1n, 1n)).toThrow(RangeError);
    expect(() => mulDivCeil(-1n, 1n, 1n)).toThrow(RangeError);
    expect(() => mulDivCeil(1n, -1n, 1n)).toThrow(RangeError);
  });

  it("reject zero and negative divisors", () => {
    expect(() => mulDivFloor(1n, 1n, 0n)).toThrow(RangeError);
    expect(() => mulDivFloor(1n, 1n, -2n)).toThrow(RangeError);
    expect(() => mulDivCeil(1n, 1n, 0n)).toThrow(RangeError);
    expect(() => mulDivCeil(1n, 1n, -2n)).toThrow(RangeError);
  });

  it("do not overflow far beyond 2^53", () => {
    const big = 9_007_199_254_740_993n * 1_000_000_000n;
    expect(mulDivFloor(big, big, big)).toBe(big);
    expect(mulDivCeil(big, big + 1n, big)).toBe(big + 1n);
  });
});

describe("unitsForAmount (rounds down)", () => {
  it("converts exact amounts", () => {
    expect(unitsForAmount(2600n, 2600n)).toBe(1_000_000n);
    expect(unitsForAmount(1300n, 2600n)).toBe(500_000n);
  });

  it("floors: $100 at $26/share is 3.846153 shares, not 3.846154", () => {
    // 10000 * 1e6 / 2600 = 3_846_153.846...
    expect(unitsForAmount(10_000n, 2600n)).toBe(3_846_153n);
  });

  it("floors: $1 at $3/share", () => {
    expect(unitsForAmount(100n, 300n)).toBe(333_333n);
  });

  it("is zero for a zero amount and throws for a zero price", () => {
    expect(unitsForAmount(0n, 2600n)).toBe(0n);
    expect(() => unitsForAmount(100n, 0n)).toThrow(RangeError);
  });

  it("rejects negative amounts", () => {
    expect(() => unitsForAmount(-1n, 2600n)).toThrow(RangeError);
  });
});

describe("primaryCost (rounds up)", () => {
  it("is exact for whole shares", () => {
    expect(primaryCost(1_000_000n, 2600n)).toBe(2600n);
    expect(primaryCost(2_500_000n, 2600n)).toBe(6500n);
  });

  it("ceils a fraction of a cent", () => {
    // 3_846_153 * 2600 / 1e6 = 9999.9978
    expect(primaryCost(3_846_153n, 2600n)).toBe(10_000n);
    expect(primaryCost(1n, 2600n)).toBe(1n);
    expect(primaryCost(333_333n, 300n)).toBe(100n);
  });

  it("is zero for zero units", () => {
    expect(primaryCost(0n, 2600n)).toBe(0n);
  });

  it("never undercharges: cost >= the exact value of the units", () => {
    const r = prng(11);
    for (let i = 0; i < 2000; i++) {
      const units = r.big(1, 50_000_000);
      const price = r.big(1, 500_000);
      expect(primaryCost(units, price) * UNITS_PER_SHARE >= units * price).toBe(true);
    }
  });

  it("never exceeds the amount typed (randomized)", () => {
    const r = prng(42);
    for (let i = 0; i < 5000; i++) {
      const amount = r.big(0, 100_000_000);
      const price = r.big(1, 1_000_000);
      const units = unitsForAmount(amount, price);
      const cost = primaryCost(units, price);
      expect(cost <= amount).toBe(true);
      // and one more micro-share would not have been affordable at the exact price
      expect((units + 1n) * price > amount * UNITS_PER_SHARE).toBe(true);
    }
  });

  it("never exceeds the amount typed (exhaustive small grid)", () => {
    for (let amount = 0n; amount <= 300n; amount++) {
      for (const price of [1n, 2n, 3n, 7n, 99n, 100n, 101n, 2600n, 999_999n, 1_000_000n, 1_000_001n]) {
        expect(primaryCost(unitsForAmount(amount, price), price) <= amount).toBe(true);
      }
    }
  });
});

describe("tradeNotional / valueOfUnits (round down)", () => {
  it("is exact for whole shares", () => {
    expect(tradeNotional(3_000_000n, 2550n)).toBe(7650n);
  });

  it("floors a fraction of a cent", () => {
    // 0.01 share at $1.99 = 1.99 cents
    expect(tradeNotional(10_000n, 199n)).toBe(1n);
    // 0.333333 share at $10.00 = 333.333 cents
    expect(tradeNotional(333_333n, 1000n)).toBe(333n);
    expect(tradeNotional(999_999n, 1n)).toBe(0n);
  });

  it("valueOfUnits uses the same floor", () => {
    expect(valueOfUnits(333_333n, 1000n)).toBe(333n);
    expect(valueOfUnits(0n, 1000n)).toBe(0n);
  });

  it("is never above primaryCost and differs by at most one cent", () => {
    const r = prng(5);
    for (let i = 0; i < 2000; i++) {
      const units = r.big(0, 20_000_000);
      const price = r.big(0, 300_000);
      const diff = primaryCost(units, price) - tradeNotional(units, price);
      expect(diff === 0n || diff === 1n).toBe(true);
    }
  });

  it("rejects negatives", () => {
    expect(() => tradeNotional(-1n, 100n)).toThrow(RangeError);
    expect(() => tradeNotional(1n, -100n)).toThrow(RangeError);
  });
});

describe("buyOrderHold (rounds up, covers every possible fill sequence)", () => {
  it("is exact for whole shares and ceils fractions", () => {
    expect(buyOrderHold(2_000_000n, 2550n)).toBe(5100n);
    expect(buyOrderHold(10_000n, 199n)).toBe(2n);
    expect(buyOrderHold(0n, 199n)).toBe(0n);
  });

  it("covers a single full fill at the limit", () => {
    const r = prng(3);
    for (let i = 0; i < 1000; i++) {
      const units = r.big(1, 500) * ORDER_LOT_UNITS;
      const limit = r.big(100, 100_000);
      expect(buyOrderHold(units, limit) >= tradeNotional(units, limit)).toBe(true);
    }
  });

  it("covers ANY split of fills at prices <= limit (seeded property test)", () => {
    const r = prng(20240229);
    for (let iter = 0; iter < 3000; iter++) {
      // Half the cases use lot-aligned sizes like the real market, half use arbitrary micro-units.
      const aligned = r.next() < 0.5;
      const units = aligned ? r.big(1, 2000) * ORDER_LOT_UNITS : r.big(1, 20_000_000);
      const limit = r.big(1, 250_000);
      const hold = buyOrderHold(units, limit);

      let remaining = units;
      let spent = 0n;
      let fills = 0;
      while (remaining > 0n && fills < 60) {
        // Sometimes stop early: a partially filled order must be covered too.
        if (r.next() < 0.03) break;
        let take: bigint;
        if (aligned) {
          const lotsLeft = Number(remaining / ORDER_LOT_UNITS);
          take = BigInt(r.int(1, Math.max(1, Math.min(lotsLeft, 40)))) * ORDER_LOT_UNITS;
        } else {
          take = r.big(1, Math.max(1, Math.min(Number(remaining), 1_500_000)));
        }
        if (take > remaining) take = remaining;
        // Bias towards the limit itself, where the hold is tightest.
        const price = r.next() < 0.4 ? limit : r.big(1, Number(limit));
        spent += tradeNotional(take, price);
        remaining -= take;
        fills++;
        expect(spent <= hold).toBe(true);
      }
      expect(spent <= hold).toBe(true);
      expect(hold - spent >= 0n).toBe(true);
    }
  });

  it("covers the adversarial case: every fill is one micro-unit at the limit", () => {
    // Each 1-unit fill floors to 0 cents unless price >= $1,000,000/share; the hold must still cover.
    for (const limit of [1n, 99n, 100n, 999_999n, 1_000_000n, 1_500_001n]) {
      const units = 37n;
      const hold = buyOrderHold(units, limit);
      const spent = tradeNotional(1n, limit) * units;
      expect(spent <= hold).toBe(true);
    }
  });

  it("is the tightest whole-cent hold: one cent less would not cover a full fill at the limit when the product is exact", () => {
    expect(buyOrderHold(1_000_000n, 2550n) - 1n < tradeNotional(1_000_000n, 2550n)).toBe(true);
  });
});

describe("applyBps", () => {
  it("applies a rate and floors", () => {
    expect(applyBps(10_000n, 500)).toBe(500n);
    expect(applyBps(999n, 500)).toBe(49n); // 49.95
    expect(applyBps(1n, 9999)).toBe(0n);
    expect(applyBps(12_345n, 10_000)).toBe(12_345n);
    expect(applyBps(12_345n, 0)).toBe(0n);
  });

  it("accepts bigint bps", () => {
    expect(applyBps(10_000n, 250n)).toBe(250n);
  });

  it("rejects negative amounts and rates", () => {
    expect(() => applyBps(-1n, 500)).toThrow(RangeError);
    expect(() => applyBps(100n, -500)).toThrow(RangeError);
  });

  it("rejects fractional bps rather than silently truncating", () => {
    expect(() => applyBps(100n, 2.5)).toThrow();
  });
});

describe("perShare", () => {
  it("divides a total across shares outstanding, flooring", () => {
    expect(perShare(2_600_000n, 1_000_000_000n)).toBe(2600n); // $26,000 over 1,000 shares
    expect(perShare(100n, 3_000_000n)).toBe(33n);
  });

  it("is 0 when nothing is outstanding", () => {
    expect(perShare(1_000n, 0n)).toBe(0n);
    expect(perShare(1_000n, -5n)).toBe(0n);
  });

  it("never overstates: perShare x outstanding <= total", () => {
    const r = prng(8);
    for (let i = 0; i < 1000; i++) {
      const total = r.big(0, 2_000_000_000);
      const out = r.big(1, 2_000_000_000);
      expect(valueOfUnits(out, perShare(total, out)) <= total).toBe(true);
    }
  });
});

describe("allocateLargestRemainder", () => {
  it("splits exactly when divisible", () => {
    expect(allocateLargestRemainder(100n, [1n, 1n])).toEqual([50n, 50n]);
    expect(allocateLargestRemainder(100n, [1n, 3n])).toEqual([25n, 75n]);
  });

  it("gives leftover cents to the largest fractional remainders", () => {
    // shares: 1/6 -> 1.667, 2/6 -> 3.333, 3/6 -> 5.0 of 10
    expect(allocateLargestRemainder(10n, [1n, 2n, 3n])).toEqual([2n, 3n, 5n]);
    // 100 * 2/7 = 28.57, 100 * 5/7 = 71.43 -> the extra cent goes to the .57
    expect(allocateLargestRemainder(100n, [2n, 5n])).toEqual([29n, 71n]);
  });

  it("breaks remainder ties by earlier position when weights are equal", () => {
    expect(allocateLargestRemainder(100n, [1n, 1n, 1n])).toEqual([34n, 33n, 33n]);
    expect(allocateLargestRemainder(2n, [1n, 1n, 1n])).toEqual([1n, 1n, 0n]);
    expect(allocateLargestRemainder(1n, [5n, 5n])).toEqual([1n, 0n]);
  });

  it("breaks remainder ties by larger weight before position", () => {
    // total 1, weights [1,3]: 1*1 % 4 = 1 and 1*3 % 4 = 3 (no tie) -> second
    expect(allocateLargestRemainder(1n, [1n, 3n])).toEqual([0n, 1n]);
    // total 2, weights [1,3]: remainders 2 and 2 tie -> larger weight (index 1) wins the cent
    expect(allocateLargestRemainder(2n, [1n, 3n])).toEqual([0n, 2n]);
    expect(allocateLargestRemainder(2n, [3n, 1n])).toEqual([2n, 0n]);
  });

  it("gives zero-weight entries nothing", () => {
    expect(allocateLargestRemainder(101n, [0n, 1n, 0n, 1n])).toEqual([0n, 51n, 0n, 50n]);
  });

  it("returns all zeros when the weights sum to zero, or there are none", () => {
    expect(allocateLargestRemainder(100n, [0n, 0n])).toEqual([0n, 0n]);
    expect(allocateLargestRemainder(100n, [])).toEqual([]);
  });

  it("returns zeros for a zero total", () => {
    expect(allocateLargestRemainder(0n, [3n, 4n])).toEqual([0n, 0n]);
  });

  it("gives everything to a single holder", () => {
    expect(allocateLargestRemainder(12_345n, [7n])).toEqual([12_345n]);
  });

  it("rejects negative totals and weights", () => {
    expect(() => allocateLargestRemainder(-1n, [1n])).toThrow(RangeError);
    expect(() => allocateLargestRemainder(1n, [1n, -1n])).toThrow(RangeError);
  });

  it("does not mutate its input and is deterministic", () => {
    const weights = Object.freeze([5n, 1n, 3n, 3n, 0n, 9n]);
    const a = allocateLargestRemainder(1_000_003n, weights);
    const b = allocateLargestRemainder(1_000_003n, weights);
    expect(a).toEqual(b);
    expect(weights).toEqual([5n, 1n, 3n, 3n, 0n, 9n]);
  });

  it("sums exactly and stays within one cent of the exact share (randomized)", () => {
    const r = prng(777);
    for (let iter = 0; iter < 1500; iter++) {
      const n = r.int(1, 12);
      const weights = Array.from({ length: n }, () => (r.next() < 0.15 ? 0n : r.big(1, 5_000_000)));
      const total = r.big(0, 50_000_000);
      const out = allocateLargestRemainder(total, weights);
      const wsum = sum(weights);
      expect(out).toHaveLength(n);
      if (wsum === 0n) {
        expect(sum(out)).toBe(0n);
        continue;
      }
      expect(sum(out)).toBe(total);
      out.forEach((amount, i) => {
        const w = weights[i]!;
        const floor = (total * w) / wsum;
        expect(amount === floor || amount === floor + 1n).toBe(true);
        if (w === 0n) expect(amount).toBe(0n);
      });
    }
  });

  it("equal weights never differ by more than one cent, and a larger weight never gets less", () => {
    const r = prng(99);
    for (let iter = 0; iter < 500; iter++) {
      const n = r.int(2, 9);
      const weights = Array.from({ length: n }, () => r.big(1, 6));
      const out = allocateLargestRemainder(r.big(0, 10_000), weights);
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
          if (weights[i] === weights[j]) {
            const d = out[i]! - out[j]!;
            expect(d >= -1n && d <= 1n).toBe(true);
          }
          if (weights[i]! > weights[j]!) expect(out[i]! >= out[j]!).toBe(true);
        }
      }
    }
  });

  it("handles totals and weights far beyond 2^53", () => {
    const total = 10n ** 30n + 1n;
    const out = allocateLargestRemainder(total, [10n ** 25n, 10n ** 25n, 10n ** 25n]);
    expect(sum(out)).toBe(total);
  });
});

describe("parseDollarsToCents", () => {
  it.each([
    ["26", 2600n],
    ["$26", 2600n],
    ["26.5", 2650n],
    ["26.05", 2605n],
    ["1,234.56", 123_456n],
    ["$1,234,567.89", 123_456_789n],
    ["  42.10  ", 4210n],
    ["0", 0n],
    ["0.01", 1n],
    ["0.1", 10n],
    ["007", 700n],
    ["999999999999.99", 99_999_999_999_999n],
  ])("parses %j", (input, expected) => {
    expect(parseDollarsToCents(input)).toBe(expected);
  });

  it.each([
    "",
    "   ",
    "$",
    "abc",
    "12abc",
    "1.234", // three decimals: never silently round money
    "1.",
    ".5",
    "1..2",
    "1.2.3",
    "-5",
    "-$5",
    "$-5",
    "(5)",
    "+5",
    "1e3",
    "0x10",
    "$$5",
    "5$",
    "$ 5",
    "1 000",
    "NaN",
    "Infinity",
    "1234567890123", // 13 digits
    "٣٤", // non-ASCII digits
  ])("rejects %j", (input) => {
    expect(parseDollarsToCents(input)).toBeNull();
  });

  it("never goes through floats: 0.29, 1.15 and 8.20 are exact", () => {
    expect(parseDollarsToCents("0.29")).toBe(29n);
    expect(parseDollarsToCents("1.15")).toBe(115n);
    expect(parseDollarsToCents("8.20")).toBe(820n);
    expect(parseDollarsToCents("4.35")).toBe(435n);
  });

  it("round-trips through centsToInput", () => {
    for (const c of [0n, 1n, 9n, 10n, 99n, 100n, 2600n, 123_456n]) {
      expect(parseDollarsToCents(centsToInput(c))).toBe(c);
    }
  });

  // SUSPECTED BUG (money.ts parseDollarsToCents): commas are stripped wherever they appear, so
  // a decimal comma is read as a thousands separator. "1,50" (one and a half, in most of Europe)
  // becomes $150.00 - a 100x over-purchase with no error. Suggested fix: only accept commas in
  // proper thousands positions, e.g. /^(\d{1,3}(,\d{3})+|\d{1,12})(\.\d{1,2})?$/.
  it.each(["1,50", "12,5", "1,2,3", "1,,000", ",5", "5,", "1,0000", "1.5,0"])(
    "rejects misplaced comma %j instead of silently dropping it",
    (input) => {
      expect(parseDollarsToCents(input)).toBeNull();
    },
  );
});

describe("parseSharesToUnits", () => {
  it.each([
    ["1", 1_000_000n],
    ["2.5", 2_500_000n],
    ["0.000001", 1n],
    ["0.01", 10_000n],
    ["1,000", 1_000_000_000n],
    [" 3.141592 ", 3_141_592n],
    ["0", 0n],
    ["999999999.999999", 999_999_999_999_999n],
  ])("parses %j", (input, expected) => {
    expect(parseSharesToUnits(input)).toBe(expected);
  });

  it.each(["", "abc", "-1", "+1", "1.", ".5", "1.0000001", "1e2", "$5", "1 2", "1234567890", "2.5 shares"])(
    "rejects %j",
    (input) => {
      expect(parseSharesToUnits(input)).toBeNull();
    },
  );

  // SUSPECTED BUG (money.ts parseSharesToUnits): same comma handling as parseDollarsToCents -
  // "1,5" shares is read as 15 shares. Suggested fix: validate comma positions.
  it.each(["1,5", "2,50", "1,,0"])("rejects misplaced comma %j", (input) => {
    expect(parseSharesToUnits(input)).toBeNull();
  });
});

describe("parsePercentToBps", () => {
  it.each([
    ["5", 500],
    ["5%", 500],
    ["5.25", 525],
    ["5.2", 520],
    ["0.01", 1],
    ["0", 0],
    ["100", 10_000],
    [" 12.5% ", 1250],
  ])("parses %j", (input, expected) => {
    expect(parsePercentToBps(input)).toBe(expected);
  });

  it.each(["", "%", "abc", "-5", "+5", "5.255", "5.", ".5", "5%%", "% 5", "1000", "5 %", "1e1", "1,5"])(
    "rejects %j",
    (input) => {
      expect(parsePercentToBps(input)).toBeNull();
    },
  );

  it("is exact where floats are not (0.07, 0.29, 1.13)", () => {
    expect(parsePercentToBps("0.07")).toBe(7);
    expect(parsePercentToBps("0.29")).toBe(29);
    expect(parsePercentToBps("1.13")).toBe(113);
  });

  // QUESTIONABLE (money.ts parsePercentToBps): there is no upper bound, so "999.99" parses to
  // 99,999 bps. Fed into reserveBps or discountBps that makes pools/prices negative (see the
  // dividends and trading-rules tests). Suggested fix: reject > 100% here, or validate at each caller.
  it("rejects percentages above 100%", () => {
    expect(parsePercentToBps("100.01")).toBeNull();
    expect(parsePercentToBps("999.99")).toBeNull();
  });
});

describe("formatCents", () => {
  it("formats with grouping and two decimals", () => {
    expect(formatCents(123_456n)).toBe("$1,234.56");
    expect(formatCents(0n)).toBe("$0.00");
    expect(formatCents(5n)).toBe("$0.05");
    expect(formatCents(100n)).toBe("$1.00");
    expect(formatCents(99_999n)).toBe("$999.99");
    expect(formatCents(100_000n)).toBe("$1,000.00");
    expect(formatCents(123_456_789_012n)).toBe("$1,234,567,890.12");
  });

  it("uses a typographic minus for negatives", () => {
    expect(formatCents(-123_456n)).toBe(`${MINUS}$1,234.56`);
    expect(formatCents(-1n)).toBe(`${MINUS}$0.01`);
  });

  it("sign: true prefixes + on gains only", () => {
    expect(formatCents(150n, { sign: true })).toBe("+$1.50");
    expect(formatCents(0n, { sign: true })).toBe("$0.00");
    expect(formatCents(-150n, { sign: true })).toBe(`${MINUS}$1.50`);
  });

  it("whole: true drops .00 but keeps real cents", () => {
    expect(formatCents(260_000n, { whole: true })).toBe("$2,600");
    expect(formatCents(260_050n, { whole: true })).toBe("$2,600.50");
    expect(formatCents(0n, { whole: true })).toBe("$0");
  });

  it("is exact beyond Number.MAX_SAFE_INTEGER", () => {
    expect(formatCents(9_007_199_254_740_993n)).toBe("$90,071,992,547,409.93");
  });
});

describe("formatCentsWhole", () => {
  it("rounds half up to the dollar", () => {
    expect(formatCentsWhole(41_250_000n)).toBe("$412,500");
    expect(formatCentsWhole(149n)).toBe("$1");
    expect(formatCentsWhole(150n)).toBe("$2");
    expect(formatCentsWhole(49n)).toBe("$0");
    expect(formatCentsWhole(50n)).toBe("$1");
    expect(formatCentsWhole(0n)).toBe("$0");
  });

  it("rounds negatives symmetrically", () => {
    expect(formatCentsWhole(-150n)).toBe(`${MINUS}$2`);
    expect(formatCentsWhole(-41_250_000n)).toBe(`${MINUS}$412,500`);
  });

  // COSMETIC (money.ts formatCentsWhole): amounts in (-$0.50, 0) render as "−$0".
  // Suggested fix: decide the sign after rounding (neg && rounded > 0n).
  it("does not print a negative zero", () => {
    expect(formatCentsWhole(-49n)).toBe("$0");
  });
});

describe("formatUnits", () => {
  it("trims trailing zeros", () => {
    expect(formatUnits(2_500_000n)).toBe("2.5");
    expect(formatUnits(1_000_000n)).toBe("1");
    expect(formatUnits(0n)).toBe("0");
    expect(formatUnits(10_000n)).toBe("0.01");
  });

  it("truncates (never rounds up) to maxDecimals", () => {
    expect(formatUnits(1_999_999n)).toBe("1.9999");
    expect(formatUnits(1_234_567n)).toBe("1.2345");
    expect(formatUnits(1_234_567n, 6)).toBe("1.234567");
    expect(formatUnits(1_234_567n, 2)).toBe("1.23");
    expect(formatUnits(1_999_999n, 0)).toBe("1");
    expect(formatUnits(1n)).toBe("0"); // below display precision
    expect(formatUnits(1n, 6)).toBe("0.000001");
  });

  it("groups thousands and handles negatives", () => {
    expect(formatUnits(1_234_567_500_000n)).toBe("1,234,567.5");
    expect(formatUnits(-2_500_000n)).toBe(`${MINUS}2.5`);
  });
});

describe("formatBps", () => {
  it("formats percentages, trimming trailing zeros", () => {
    expect(formatBps(525)).toBe("5.25%");
    expect(formatBps(500)).toBe("5%");
    expect(formatBps(550)).toBe("5.5%");
    expect(formatBps(0)).toBe("0%");
    expect(formatBps(1)).toBe("0.01%");
    expect(formatBps(10_000)).toBe("100%");
    expect(formatBps(1000)).toBe("10%");
    expect(formatBps(2500n)).toBe("25%");
  });

  it("handles sign and negatives", () => {
    expect(formatBps(525, { sign: true })).toBe("+5.25%");
    expect(formatBps(0, { sign: true })).toBe("0%");
    expect(formatBps(-525, { sign: true })).toBe(`${MINUS}5.25%`);
    expect(formatBps(-1000)).toBe(`${MINUS}10%`);
  });

  it("respects decimals without eating integer zeros", () => {
    expect(formatBps(1000, { decimals: 0 })).toBe("10%");
    expect(formatBps(10_000, { decimals: 0 })).toBe("100%");
    expect(formatBps(1230, { decimals: 1 })).toBe("12.3%");
  });
});

describe("ratioBps", () => {
  it("computes a ratio in bps, truncating toward zero", () => {
    expect(ratioBps(1n, 4n)).toBe(2500);
    expect(ratioBps(1n, 3n)).toBe(3333);
    expect(ratioBps(2n, 3n)).toBe(6666);
    expect(ratioBps(-1n, 3n)).toBe(-3333);
    expect(ratioBps(5n, 5n)).toBe(10_000);
  });

  it("is 0 for a zero denominator", () => {
    expect(ratioBps(5n, 0n)).toBe(0);
  });
});

describe("centsToInput / centsToNumber", () => {
  it("renders plain decimals for form inputs", () => {
    expect(centsToInput(2600n)).toBe("26.00");
    expect(centsToInput(5n)).toBe("0.05");
    expect(centsToInput(0n)).toBe("0.00");
    expect(centsToInput(123_456n)).toBe("1234.56");
  });

  // SUSPECTED BUG (money.ts centsToInput): bigint % keeps the sign, so -150n renders as
  // "-1.-50" and -50n as "0.-50" (which also loses the sign of the whole part).
  // Suggested fix: format the absolute value and prefix "-" when cents < 0n.
  it("renders negative amounts", () => {
    expect(centsToInput(-150n)).toBe("-1.50");
    expect(centsToInput(-50n)).toBe("-0.50");
  });

  it("centsToNumber converts for charts", () => {
    expect(centsToNumber(2650n)).toBe(26.5);
    expect(centsToNumber(-1n)).toBe(-0.01);
  });
});
