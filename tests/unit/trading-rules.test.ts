import { describe, expect, it } from "vitest";
import {
  buybackPrice,
  circuitBreakerBand,
  endOfMonth,
  isPriceWithinBand,
  isWithinWindow,
  monthKey,
  monthLabel,
  quoteBuyback,
  windowForMonth,
} from "@/lib/domain/trading-rules";
import { tradeNotional } from "@/lib/domain/money";
import { prng } from "./_prng";

const SHARE = 1_000_000n;

describe("circuitBreakerBand", () => {
  it("is nav +/- 25% when that is a whole number of cents", () => {
    expect(circuitBreakerBand(1000n, 2500)).toEqual({ minCents: 750n, maxCents: 1250n });
    expect(circuitBreakerBand(2600n, 2500)).toEqual({ minCents: 1950n, maxCents: 3250n });
  });

  it("rounds inward, so the band is never wider than +/- 25%", () => {
    // 1001 x 0.75 = 750.75 -> 751; 1001 x 1.25 = 1251.25 -> 1251
    expect(circuitBreakerBand(1001n, 2500)).toEqual({ minCents: 751n, maxCents: 1251n });
    // 3 x 0.75 = 2.25 -> 3; 3 x 1.25 = 3.75 -> 3
    expect(circuitBreakerBand(3n, 2500)).toEqual({ minCents: 3n, maxCents: 3n });
  });

  it("a zero band allows only the nav itself", () => {
    expect(circuitBreakerBand(1234n, 0)).toEqual({ minCents: 1234n, maxCents: 1234n });
  });

  it("a band of 100% or more has a floor of zero", () => {
    expect(circuitBreakerBand(1000n, 10_000)).toEqual({ minCents: 0n, maxCents: 2000n });
    expect(circuitBreakerBand(1000n, 15_000)).toEqual({ minCents: 0n, maxCents: 2500n });
  });

  it("a zero nav gives an empty price range", () => {
    expect(circuitBreakerBand(0n, 2500)).toEqual({ minCents: 0n, maxCents: 0n });
  });

  it("always contains the nav and min <= max (randomized)", () => {
    const r = prng(25);
    for (let i = 0; i < 2000; i++) {
      const nav = r.big(0, 5_000_000);
      const band = r.int(0, 12_000);
      const { minCents, maxCents } = circuitBreakerBand(nav, band);
      expect(minCents <= nav && nav <= maxCents).toBe(true);
      // never wider than the exact band
      expect(minCents * 10_000n >= nav * BigInt(Math.max(0, 10_000 - band))).toBe(true);
      expect(maxCents * 10_000n <= nav * BigInt(10_000 + band)).toBe(true);
    }
  });
});

describe("isPriceWithinBand (inclusive edges at +/- 25%)", () => {
  it("accepts both edges and rejects one cent beyond", () => {
    expect(isPriceWithinBand(750n, 1000n, 2500)).toBe(true);
    expect(isPriceWithinBand(749n, 1000n, 2500)).toBe(false);
    expect(isPriceWithinBand(1250n, 1000n, 2500)).toBe(true);
    expect(isPriceWithinBand(1251n, 1000n, 2500)).toBe(false);
  });

  it("accepts the nav and anything in between", () => {
    expect(isPriceWithinBand(1000n, 1000n, 2500)).toBe(true);
    expect(isPriceWithinBand(900n, 1000n, 2500)).toBe(true);
    expect(isPriceWithinBand(1100n, 1000n, 2500)).toBe(true);
  });

  it("applies the inward rounding at fractional edges", () => {
    // nav 1001: exact band is [750.75, 1251.25]
    expect(isPriceWithinBand(750n, 1001n, 2500)).toBe(false);
    expect(isPriceWithinBand(751n, 1001n, 2500)).toBe(true);
    expect(isPriceWithinBand(1251n, 1001n, 2500)).toBe(true);
    expect(isPriceWithinBand(1252n, 1001n, 2500)).toBe(false);
  });

  it("rejects far-off prices", () => {
    expect(isPriceWithinBand(0n, 1000n, 2500)).toBe(false);
    expect(isPriceWithinBand(1n, 1000n, 2500)).toBe(false);
    expect(isPriceWithinBand(100_000n, 1000n, 2500)).toBe(false);
  });
});

describe("buybackPrice", () => {
  it("is nav less the discount", () => {
    expect(buybackPrice(1000n, 500)).toBe(950n);
    expect(buybackPrice(2600n, 500)).toBe(2470n);
    expect(buybackPrice(1000n, 0)).toBe(1000n);
    expect(buybackPrice(1000n, 10_000)).toBe(0n);
  });

  it("rounds the price down (the discount up), in the reserve's favour", () => {
    // 1001 x 0.95 = 950.95 -> 950
    expect(buybackPrice(1001n, 500)).toBe(950n);
    // 999 x 0.95 = 949.05 -> 949
    expect(buybackPrice(999n, 500)).toBe(949n);
    expect(buybackPrice(1n, 500)).toBe(0n);
  });

  it("equals floor(nav x (1 - d)) and never exceeds nav (randomized)", () => {
    const r = prng(95);
    for (let i = 0; i < 2000; i++) {
      const nav = r.big(0, 10_000_000);
      const d = r.int(0, 10_000);
      const price = buybackPrice(nav, d);
      expect(price).toBe((nav * BigInt(10_000 - d)) / 10_000n);
      expect(price >= 0n && price <= nav).toBe(true);
    }
  });
});

describe("quoteBuyback", () => {
  const base = {
    units: 2n * SHARE,
    navPerShareCents: 1000n,
    discountBps: 500,
    monthlyCapCents: 100_000n,
    usedThisMonthCents: 0n,
    reserveBalanceCents: 50_000n,
  };

  it("quotes an acceptable request", () => {
    expect(quoteBuyback(base)).toEqual({
      priceCents: 950n,
      budgetCents: 50_000n,
      maxUnits: 52_631_578n, // floor(50,000 / 9.50 shares)
      proceedsCents: 1900n,
      ok: true,
    });
    expect(quoteBuyback(base).reason).toBeUndefined();
  });

  it("proceeds round down to the cent", () => {
    const q = quoteBuyback({ ...base, units: 333_333n });
    expect(q.proceedsCents).toBe(316n); // 0.333333 x 950 = 316.66635
    expect(q.proceedsCents).toBe(tradeNotional(333_333n, 950n));
    expect(q.ok).toBe(true);
  });

  describe("budget = min(cap remaining, reserve balance)", () => {
    it("is limited by the reserve balance when that is smaller", () => {
      const q = quoteBuyback({ ...base, monthlyCapCents: 100_000n, usedThisMonthCents: 10_000n, reserveBalanceCents: 5_000n });
      expect(q.budgetCents).toBe(5_000n);
    });

    it("is limited by the cap remaining when that is smaller", () => {
      const q = quoteBuyback({ ...base, monthlyCapCents: 100_000n, usedThisMonthCents: 97_000n, reserveBalanceCents: 50_000n });
      expect(q.budgetCents).toBe(3_000n);
      expect(q.maxUnits).toBe(3_157_894n);
    });

    it("is either when they are equal", () => {
      const q = quoteBuyback({ ...base, monthlyCapCents: 60_000n, usedThisMonthCents: 10_000n, reserveBalanceCents: 50_000n });
      expect(q.budgetCents).toBe(50_000n);
    });
  });

  describe("NO_BUDGET", () => {
    it("when the monthly cap is used up", () => {
      const q = quoteBuyback({ ...base, usedThisMonthCents: 100_000n });
      expect(q).toMatchObject({ ok: false, reason: "NO_BUDGET", budgetCents: 0n, maxUnits: 0n });
    });

    it("when usage somehow exceeds the cap (clamped at zero, not negative)", () => {
      const q = quoteBuyback({ ...base, usedThisMonthCents: 100_001n });
      expect(q).toMatchObject({ ok: false, reason: "NO_BUDGET", budgetCents: 0n });
    });

    it("when the reserve is empty", () => {
      const q = quoteBuyback({ ...base, reserveBalanceCents: 0n });
      expect(q).toMatchObject({ ok: false, reason: "NO_BUDGET", budgetCents: 0n, maxUnits: 0n });
    });

    it("when the cap is zero", () => {
      expect(quoteBuyback({ ...base, monthlyCapCents: 0n })).toMatchObject({ ok: false, reason: "NO_BUDGET" });
    });

    it("when the buyback price is zero", () => {
      const q = quoteBuyback({ ...base, discountBps: 10_000 });
      expect(q).toMatchObject({ ok: false, reason: "NO_BUDGET", priceCents: 0n, maxUnits: 0n, proceedsCents: 0n });
    });

    it("takes precedence over TOO_SMALL", () => {
      expect(quoteBuyback({ ...base, units: 1n, reserveBalanceCents: 0n }).reason).toBe("NO_BUDGET");
    });
  });

  describe("TOO_SMALL", () => {
    it("when the units are worth less than a cent", () => {
      const q = quoteBuyback({ ...base, units: 1_000n }); // 0.001 share x $9.50 = 0.95 cents
      expect(q).toMatchObject({ ok: false, reason: "TOO_SMALL", proceedsCents: 0n });
    });

    it("zero units", () => {
      expect(quoteBuyback({ ...base, units: 0n })).toMatchObject({ ok: false, reason: "TOO_SMALL" });
    });

    it("the first size worth a whole cent is accepted", () => {
      // 950 cents/share -> 1 cent needs ceil(1e6 / 950) = 1053 units
      expect(quoteBuyback({ ...base, units: 1_052n }).reason).toBe("TOO_SMALL");
      expect(quoteBuyback({ ...base, units: 1_053n })).toMatchObject({ ok: true, proceedsCents: 1n });
    });
  });

  describe("EXCEEDS_BUDGET", () => {
    it("when proceeds exceed the reserve balance", () => {
      const q = quoteBuyback({ ...base, units: 60n * SHARE }); // 57,000 > 50,000
      expect(q).toMatchObject({ ok: false, reason: "EXCEEDS_BUDGET", proceedsCents: 57_000n, budgetCents: 50_000n });
    });

    it("when proceeds exceed what is left under the cap", () => {
      const q = quoteBuyback({ ...base, usedThisMonthCents: 99_000n, units: 2n * SHARE }); // 1,900 > 1,000
      expect(q).toMatchObject({ ok: false, reason: "EXCEEDS_BUDGET", budgetCents: 1_000n });
    });

    it("proceeds exactly equal to the budget are accepted; one cent more is not", () => {
      // 950 cents/share, budget 1,900: exactly 2 shares.
      const exact = quoteBuyback({ ...base, reserveBalanceCents: 1_900n, units: 2n * SHARE });
      expect(exact).toMatchObject({ ok: true, proceedsCents: 1_900n, budgetCents: 1_900n, maxUnits: 2n * SHARE });
      const over = quoteBuyback({ ...base, reserveBalanceCents: 1_899n, units: 2n * SHARE });
      expect(over).toMatchObject({ ok: false, reason: "EXCEEDS_BUDGET" });
    });
  });

  it("selling maxUnits is always accepted and never overspends (randomized)", () => {
    const r = prng(4096);
    for (let i = 0; i < 2000; i++) {
      const input = {
        units: 0n,
        navPerShareCents: r.big(100, 500_000),
        discountBps: r.int(0, 3000),
        monthlyCapCents: r.big(0, 5_000_000),
        usedThisMonthCents: r.big(0, 5_000_000),
        reserveBalanceCents: r.big(0, 5_000_000),
      };
      const probe = quoteBuyback(input);
      const capLeft = input.monthlyCapCents > input.usedThisMonthCents ? input.monthlyCapCents - input.usedThisMonthCents : 0n;
      expect(probe.budgetCents).toBe(capLeft < input.reserveBalanceCents ? capLeft : input.reserveBalanceCents);
      expect(tradeNotional(probe.maxUnits, probe.priceCents) <= probe.budgetCents).toBe(true);

      const q = quoteBuyback({ ...input, units: probe.maxUnits });
      if (q.ok) {
        expect(q.proceedsCents > 0n && q.proceedsCents <= q.budgetCents).toBe(true);
        expect(q.proceedsCents <= input.reserveBalanceCents).toBe(true); // reserve can never go negative
        expect(q.proceedsCents + input.usedThisMonthCents <= input.monthlyCapCents).toBe(true); // cap never breached
      } else {
        expect(q.reason === "NO_BUDGET" || q.reason === "TOO_SMALL").toBe(true);
      }
    }
  });

  it("an accepted quote never pays more than the budget, whatever the size (randomized)", () => {
    const r = prng(8192);
    for (let i = 0; i < 3000; i++) {
      const q = quoteBuyback({
        units: r.big(0, 30_000_000),
        navPerShareCents: r.big(100, 100_000),
        discountBps: r.int(0, 2000),
        monthlyCapCents: r.big(0, 2_000_000),
        usedThisMonthCents: r.big(0, 1_000_000),
        reserveBalanceCents: r.big(0, 2_000_000),
      });
      expect(q.ok).toBe(q.reason === undefined);
      if (q.ok) expect(q.proceedsCents >= 1n && q.proceedsCents <= q.budgetCents).toBe(true);
    }
  });

  // QUESTIONABLE (trading-rules.ts quoteBuyback, `maxUnits` vs the `proceedsCents > budgetCents`
  // check): maxUnits is floor(budget / price) but acceptance is decided on FLOORED proceeds, so
  // requests slightly above the advertised maximum are still accepted. Here budget is $10.00 at
  // $7.50/share: maxUnits = 1.333333 shares, yet 1.334 shares (floor(1000.5) = 1000 cents) is ok.
  // No cash is lost (proceeds <= budget) but the seller hands over units for nothing and the UI's
  // "max" disagrees with the server. Suggested fix: also reject `units > maxUnits`.
  it("never accepts more units than the maxUnits it quotes", () => {
    const q = quoteBuyback({
      units: 1_334_000n,
      navPerShareCents: 750n,
      discountBps: 0,
      monthlyCapCents: 1_000n,
      usedThisMonthCents: 0n,
      reserveBalanceCents: 1_000_000n,
    });
    expect(q.maxUnits).toBe(1_333_333n);
    expect(q.ok).toBe(false);
  });

  // SUSPECTED BUG (trading-rules.ts quoteBuyback): `tradeNotional(input.units, priceCents)` and
  // the maxUnits mulDivFloor run BEFORE the `budgetCents <= 0n || priceCents <= 0n` guard. With a
  // discount above 100% (price < 0) or an overdrawn reserve (balance < 0) the function throws
  // RangeError("Expected a non-negative amount") instead of returning NO_BUDGET.
  // Suggested fix: move the NO_BUDGET guard above both computations (and/or validate discountBps).
  it("returns NO_BUDGET (not a throw) when the discount exceeds 100%", () => {
    expect(quoteBuyback({ units: SHARE, navPerShareCents: 1000n, discountBps: 10_001, monthlyCapCents: 1000n, usedThisMonthCents: 0n, reserveBalanceCents: 1000n }).reason).toBe("NO_BUDGET");
  });

  it("returns NO_BUDGET (not a throw) when the reserve balance is negative", () => {
    expect(quoteBuyback({ units: SHARE, navPerShareCents: 1000n, discountBps: 500, monthlyCapCents: 1000n, usedThisMonthCents: 0n, reserveBalanceCents: -1n }).reason).toBe("NO_BUDGET");
  });
});

describe("windowForMonth / isWithinWindow", () => {
  it("opens at 00:00 UTC on the 1st and closes `days` days later", () => {
    const w = windowForMonth(2024, 2, 5); // March
    expect(w.opensAt.toISOString()).toBe("2024-03-01T00:00:00.000Z");
    expect(w.closesAt.toISOString()).toBe("2024-03-06T00:00:00.000Z");
  });

  it("is open at the opening instant and closed one ms before", () => {
    const w = windowForMonth(2024, 2, 5);
    expect(isWithinWindow(w, new Date("2024-02-29T23:59:59.999Z"))).toBe(false);
    expect(isWithinWindow(w, new Date("2024-03-01T00:00:00.000Z"))).toBe(true);
  });

  it("is open until one ms before closing and closed at the closing instant (half-open)", () => {
    const w = windowForMonth(2024, 2, 5);
    expect(isWithinWindow(w, new Date("2024-03-05T23:59:59.999Z"))).toBe(true);
    expect(isWithinWindow(w, new Date("2024-03-06T00:00:00.000Z"))).toBe(false);
    expect(isWithinWindow(w, new Date("2024-03-06T00:00:00.001Z"))).toBe(false);
  });

  it("is open mid-window and closed for the rest of the month", () => {
    const w = windowForMonth(2024, 2, 5);
    expect(isWithinWindow(w, new Date("2024-03-03T12:00:00Z"))).toBe(true);
    expect(isWithinWindow(w, new Date("2024-03-20T12:00:00Z"))).toBe(false);
  });

  it("handles January, December and a window that runs past a short month", () => {
    expect(windowForMonth(2025, 0, 3).opensAt.toISOString()).toBe("2025-01-01T00:00:00.000Z");
    expect(windowForMonth(2024, 11, 7).closesAt.toISOString()).toBe("2024-12-08T00:00:00.000Z");
    expect(windowForMonth(2024, 11, 31).closesAt.toISOString()).toBe("2025-01-01T00:00:00.000Z");
    expect(windowForMonth(2023, 1, 30).closesAt.toISOString()).toBe("2023-03-03T00:00:00.000Z");
  });

  it("a zero-day window is never open", () => {
    const w = windowForMonth(2024, 2, 0);
    expect(isWithinWindow(w, w.opensAt)).toBe(false);
  });

  it("consecutive windows never overlap", () => {
    const a = windowForMonth(2024, 0, 31);
    const b = windowForMonth(2024, 1, 5);
    expect(a.closesAt.getTime()).toBe(b.opensAt.getTime());
    expect(isWithinWindow(a, b.opensAt)).toBe(false);
    expect(isWithinWindow(b, b.opensAt)).toBe(true);
  });
});

describe("monthKey", () => {
  it("is YYYY-MM in UTC, zero padded", () => {
    expect(monthKey(new Date("2024-03-15T12:00:00Z"))).toBe("2024-03");
    expect(monthKey(new Date("2024-12-01T00:00:00Z"))).toBe("2024-12");
    expect(monthKey(new Date("2024-01-01T00:00:00.000Z"))).toBe("2024-01");
  });

  it("uses the UTC month at month boundaries", () => {
    expect(monthKey(new Date("2024-01-31T23:59:59.999Z"))).toBe("2024-01");
    expect(monthKey(new Date("2024-02-01T00:00:00.000Z"))).toBe("2024-02");
    // 20:00 on Jan 31 in New York is already February in UTC.
    expect(monthKey(new Date("2024-01-31T20:00:00-05:00"))).toBe("2024-02");
    expect(monthKey(new Date("2023-12-31T23:59:59.999Z"))).toBe("2023-12");
  });
});

describe("endOfMonth", () => {
  it("is the last millisecond of the month in UTC", () => {
    expect(endOfMonth("2024-01").toISOString()).toBe("2024-01-31T23:59:59.999Z");
    expect(endOfMonth("2024-04").toISOString()).toBe("2024-04-30T23:59:59.999Z");
    expect(endOfMonth("2024-12").toISOString()).toBe("2024-12-31T23:59:59.999Z");
  });

  it("handles February in leap and non-leap years", () => {
    expect(endOfMonth("2024-02").toISOString()).toBe("2024-02-29T23:59:59.999Z");
    expect(endOfMonth("2023-02").toISOString()).toBe("2023-02-28T23:59:59.999Z");
    expect(endOfMonth("2100-02").toISOString()).toBe("2100-02-28T23:59:59.999Z");
  });

  it("round-trips with monthKey, and the next ms is the next month", () => {
    for (const m of ["2023-12", "2024-01", "2024-02", "2024-11"]) {
      const end = endOfMonth(m);
      expect(monthKey(end)).toBe(m);
      expect(monthKey(new Date(end.getTime() + 1))).not.toBe(m);
    }
  });
});

describe("monthLabel", () => {
  it("formats a month key for display", () => {
    expect(monthLabel("2024-03")).toBe("March 2024");
    expect(monthLabel("2024-03", "short")).toBe("Mar 2024");
    expect(monthLabel("2024-12")).toBe("December 2024");
  });
});
