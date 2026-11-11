import { describe, expect, it } from "vitest";
import { formatPerShare, MICRO, netIncome, planDistribution, type HolderUnits } from "@/lib/domain/dividends";
import { UNITS_PER_SHARE } from "@/lib/domain/money";
import { prng, sum } from "./_prng";

const SHARE = UNITS_PER_SHARE;
const SCALE = MICRO * UNITS_PER_SHARE;
const paid = (p: { payments: { amountCents: bigint }[] }) => sum(p.payments.map((x) => x.amountCents));
const byUser = (p: { payments: { userId: string; amountCents: bigint }[] }) =>
  Object.fromEntries(p.payments.map((x) => [x.userId, x.amountCents]));

describe("planDistribution: hand-computed example", () => {
  // Net income $1,000.00, 5% to reserve, 3 cents carried in.
  //   reserve = 5,000   pool = 100,000 - 5,000 + 3 = 95,003
  // Holders: A 10 shares, B 20 shares, C 30.5 shares -> 60.5 shares outstanding.
  //   rate = 95,003 / 60.5 = 1570.29752066... cents/share -> 1,570,297,520 micro-cents (truncated)
  //   A owed 15,702.9752   B owed 31,405.9504   C owed 47,894.07436   total 95,002.99996
  //   whole cents owed in total = 95,002; floors sum to 95,001; the spare cent goes to the
  //   largest fraction (A, .9752). One cent of the pool is carried forward.
  const plan = planDistribution({
    netIncomeCents: 100_000n,
    carryInCents: 3n,
    reserveBps: 500,
    holders: [
      { userId: "A", units: 10n * SHARE },
      { userId: "B", units: 20n * SHARE },
      { userId: "C", units: 30_500_000n },
    ],
  });

  it("allocates the reserve and builds the pool", () => {
    expect(plan.netIncomeCents).toBe(100_000n);
    expect(plan.carryInCents).toBe(3n);
    expect(plan.reserveAllocationCents).toBe(5_000n);
    expect(plan.poolCents).toBe(95_003n);
    expect(plan.outstandingUnits).toBe(60_500_000n);
  });

  it("publishes one truncated per-share rate", () => {
    expect(plan.perShareMicroCents).toBe(1_570_297_520n);
  });

  it("pays the expected cents to each holder", () => {
    expect(plan.payments).toEqual([
      { userId: "A", units: 10_000_000n, amountCents: 15_703n },
      { userId: "B", units: 20_000_000n, amountCents: 31_405n },
      { userId: "C", units: 30_500_000n, amountCents: 47_894n },
    ]);
  });

  it("accounts for every cent", () => {
    expect(plan.distributedCents).toBe(95_002n);
    expect(plan.roundingRemainderCents).toBe(1n);
    expect(paid(plan)).toBe(plan.distributedCents);
    expect(plan.distributedCents + plan.roundingRemainderCents).toBe(plan.poolCents);
    expect(plan.reserveAllocationCents + plan.distributedCents + plan.roundingRemainderCents).toBe(
      plan.netIncomeCents + plan.carryInCents,
    );
  });
});

describe("planDistribution: basics", () => {
  it("pays an evenly divisible pool in full with no remainder", () => {
    const plan = planDistribution({
      netIncomeCents: 10_000n,
      carryInCents: 0n,
      reserveBps: 1000,
      holders: [
        { userId: "a", units: 1n * SHARE },
        { userId: "b", units: 2n * SHARE },
      ],
    });
    expect(plan.reserveAllocationCents).toBe(1_000n);
    expect(plan.poolCents).toBe(9_000n);
    expect(byUser(plan)).toEqual({ a: 3_000n, b: 6_000n });
    expect(plan.distributedCents).toBe(9_000n);
    expect(plan.roundingRemainderCents).toBe(0n);
    expect(plan.perShareMicroCents).toBe(3_000n * MICRO);
  });

  it("gives a single holder the whole pool", () => {
    const plan = planDistribution({
      netIncomeCents: 12_345n,
      carryInCents: 0n,
      reserveBps: 0,
      holders: [{ userId: "solo", units: 7n * SHARE }],
    });
    // 12345 / 7 is not exact: the rate truncates and at most one cent is carried.
    expect(plan.poolCents).toBe(12_345n);
    expect(paid(plan)).toBe(plan.distributedCents);
    expect(plan.distributedCents + plan.roundingRemainderCents).toBe(12_345n);
    expect(plan.roundingRemainderCents).toBe(1n);
  });

  it("includes the carry-in in the pool and pays it out when it completes a cent", () => {
    // 100 cents among 3 equal holders: rate 33.333333, 99.999999 owed -> 33 each, 1 cent carried.
    const holders = ["a", "b", "c"].map((userId) => ({ userId, units: SHARE }));
    const m1 = planDistribution({ netIncomeCents: 100n, carryInCents: 0n, reserveBps: 0, holders });
    expect(m1.payments.map((p) => p.amountCents)).toEqual([33n, 33n, 33n]);
    expect(m1.roundingRemainderCents).toBe(1n);
    // Next month the carried cent joins the pool: 101 -> rate 33.666666, 100.999998 owed ->
    // 100 whole cents: 34 + 33 + 33, and again 1 cent carried.
    const m2 = planDistribution({ netIncomeCents: 100n, carryInCents: m1.roundingRemainderCents, reserveBps: 0, holders });
    expect(m2.poolCents).toBe(101n);
    expect(m2.payments.map((p) => p.amountCents)).toEqual([34n, 33n, 33n]);
    expect(m2.roundingRemainderCents).toBe(1n);
    // A month where pool divides exactly clears the carry: 98 + 1 = 99 -> 33 each, nothing left.
    const m3 = planDistribution({ netIncomeCents: 98n, carryInCents: m2.roundingRemainderCents, reserveBps: 0, holders });
    expect(m3.poolCents).toBe(99n);
    expect(m3.payments.map((p) => p.amountCents)).toEqual([33n, 33n, 33n]);
    expect(m3.roundingRemainderCents).toBe(0n);
    // Three months: 298 cents in, 298 cents out.
    expect(paid(m1) + paid(m2) + paid(m3)).toBe(298n);
  });

  it("carry-in is not subject to the reserve cut", () => {
    const plan = planDistribution({
      netIncomeCents: 1_000n,
      carryInCents: 500n,
      reserveBps: 1000,
      holders: [{ userId: "a", units: SHARE }],
    });
    expect(plan.reserveAllocationCents).toBe(100n);
    expect(plan.poolCents).toBe(1_400n);
    expect(paid(plan)).toBe(1_400n);
  });

  it("rejects a negative carry-in", () => {
    expect(() =>
      planDistribution({ netIncomeCents: 100n, carryInCents: -1n, reserveBps: 0, holders: [{ userId: "a", units: SHARE }] }),
    ).toThrow(RangeError);
  });
});

describe("planDistribution: zero or negative net income", () => {
  const holders = [
    { userId: "a", units: 3n * SHARE },
    { userId: "b", units: 1n * SHARE },
  ];

  it.each([0n, -1n, -250_000n])("net income %s pays nothing and preserves the carry", (netIncomeCents) => {
    const plan = planDistribution({ netIncomeCents, carryInCents: 7n, reserveBps: 500, holders });
    expect(plan.netIncomeCents).toBe(netIncomeCents);
    expect(plan.reserveAllocationCents).toBe(0n);
    expect(plan.poolCents).toBe(7n);
    expect(plan.perShareMicroCents).toBe(0n);
    expect(plan.distributedCents).toBe(0n);
    expect(plan.roundingRemainderCents).toBe(7n);
    expect(plan.outstandingUnits).toBe(4n * SHARE);
    expect(plan.payments).toEqual([
      { userId: "a", units: 3n * SHARE, amountCents: 0n },
      { userId: "b", units: 1n * SHARE, amountCents: 0n },
    ]);
  });

  it("does not pay out even a large carry in a loss month", () => {
    const plan = planDistribution({ netIncomeCents: -1n, carryInCents: 1_000_000n, reserveBps: 500, holders });
    expect(paid(plan)).toBe(0n);
    expect(plan.roundingRemainderCents).toBe(1_000_000n);
  });
});

describe("planDistribution: no holders", () => {
  it("still funds the reserve and carries the whole pool forward", () => {
    const plan = planDistribution({ netIncomeCents: 10_000n, carryInCents: 5n, reserveBps: 500, holders: [] });
    expect(plan.reserveAllocationCents).toBe(500n);
    expect(plan.poolCents).toBe(9_505n);
    expect(plan.distributedCents).toBe(0n);
    expect(plan.roundingRemainderCents).toBe(9_505n);
    expect(plan.perShareMicroCents).toBe(0n);
    expect(plan.outstandingUnits).toBe(0n);
    expect(plan.payments).toEqual([]);
  });

  it("ignores holders with zero (or negative) units", () => {
    const plan = planDistribution({
      netIncomeCents: 1_000n,
      carryInCents: 0n,
      reserveBps: 0,
      holders: [
        { userId: "ghost", units: 0n },
        { userId: "real", units: SHARE },
        { userId: "broken", units: -5n },
      ],
    });
    expect(plan.outstandingUnits).toBe(SHARE);
    expect(plan.payments).toEqual([{ userId: "real", units: SHARE, amountCents: 1_000n }]);
  });

  it("treats all-zero holders as no holders", () => {
    const plan = planDistribution({ netIncomeCents: 1_000n, carryInCents: 0n, reserveBps: 0, holders: [{ userId: "x", units: 0n }] });
    expect(plan.payments).toEqual([]);
    expect(plan.roundingRemainderCents).toBe(1_000n);
  });
});

describe("planDistribution: reserve allocation", () => {
  const holders = [{ userId: "a", units: SHARE }];

  it("rounds the reserve cut down (in the holders' favour)", () => {
    const plan = planDistribution({ netIncomeCents: 999n, carryInCents: 0n, reserveBps: 500, holders });
    expect(plan.reserveAllocationCents).toBe(49n); // 49.95
    expect(plan.poolCents).toBe(950n);
  });

  it("0 bps reserves nothing", () => {
    const plan = planDistribution({ netIncomeCents: 999n, carryInCents: 0n, reserveBps: 0, holders });
    expect(plan.reserveAllocationCents).toBe(0n);
    expect(plan.poolCents).toBe(999n);
  });

  it("10,000 bps sends all income to the reserve; only the carry is distributable", () => {
    const plan = planDistribution({ netIncomeCents: 999n, carryInCents: 4n, reserveBps: 10_000, holders });
    expect(plan.reserveAllocationCents).toBe(999n);
    expect(plan.poolCents).toBe(4n);
    expect(paid(plan)).toBe(4n);
  });

  it("a one-cent income is too small to reserve anything", () => {
    const plan = planDistribution({ netIncomeCents: 1n, carryInCents: 0n, reserveBps: 9_999, holders });
    expect(plan.reserveAllocationCents).toBe(0n);
    expect(paid(plan)).toBe(1n);
  });

  // SUSPECTED BUG (dividends.ts planDistribution, `applyBps(input.netIncomeCents, input.reserveBps)`
  // then `poolCents = net - reserve + carry`): reserveBps is not range-checked. Above 10,000 the
  // reserve takes more than the income, the pool goes negative, and every holder gets a NEGATIVE
  // "payment" (here -100 cents) while the reserve is credited money that does not exist.
  // Suggested fix: throw RangeError unless 0 <= reserveBps <= 10_000.
  it("rejects a reserve rate above 100% instead of producing negative payments", () => {
    expect(() => planDistribution({ netIncomeCents: 100n, carryInCents: 0n, reserveBps: 20_000, holders })).toThrow();
  });
});

describe("planDistribution: fairness", () => {
  it("equal holders get equal amounts, within one cent", () => {
    const r = prng(31337);
    for (let iter = 0; iter < 400; iter++) {
      const n = r.int(2, 15);
      const units = r.big(1, 5_000_000);
      const holders = Array.from({ length: n }, (_, i) => ({ userId: `u${String(i).padStart(2, "0")}`, units }));
      const plan = planDistribution({ netIncomeCents: r.big(1, 5_000_000), carryInCents: r.big(0, 5), reserveBps: 500, holders });
      const amounts = plan.payments.map((p) => p.amountCents);
      const min = amounts.reduce((a, b) => (b < a ? b : a));
      const max = amounts.reduce((a, b) => (b > a ? b : a));
      expect(max - min <= 1n).toBe(true);
      expect(sum(amounts)).toBe(plan.distributedCents);
    }
  });

  it("when equal holders differ by a cent, the extra goes to the lowest userId", () => {
    // pool 200 across 3 equal holders: rate 66.666666, 199.999998 owed -> 199 whole cents:
    // 66 each + 1 spare; remainders tie and units tie, so userId decides.
    const plan = planDistribution({
      netIncomeCents: 200n,
      carryInCents: 0n,
      reserveBps: 0,
      holders: [
        { userId: "c", units: SHARE },
        { userId: "a", units: SHARE },
        { userId: "b", units: SHARE },
      ],
    });
    expect(byUser(plan)).toEqual({ a: 67n, b: 66n, c: 66n });
    expect(plan.roundingRemainderCents).toBe(1n);
  });

  it("a holder with more units never receives less", () => {
    const r = prng(2718);
    for (let iter = 0; iter < 300; iter++) {
      const holders = Array.from({ length: r.int(2, 10) }, (_, i) => ({ userId: `u${i}`, units: r.big(1, 30) * 100_000n }));
      const plan = planDistribution({ netIncomeCents: r.big(1, 100_000), carryInCents: 0n, reserveBps: 0, holders });
      for (const p of plan.payments) {
        for (const q of plan.payments) {
          if (p.units > q.units) expect(p.amountCents >= q.amountCents).toBe(true);
        }
      }
    }
  });

  it("does not depend on the order holders are passed in", () => {
    const r = prng(1618);
    for (let iter = 0; iter < 200; iter++) {
      const holders: HolderUnits[] = Array.from({ length: r.int(2, 12) }, (_, i) => ({
        userId: `user-${i}`,
        units: r.big(1, 4) * 250_000n,
      }));
      const shuffled = [...holders].sort(() => r.next() - 0.5);
      const input = { netIncomeCents: r.big(1, 1_000_000), carryInCents: r.big(0, 3), reserveBps: 300 };
      const a = planDistribution({ ...input, holders });
      const b = planDistribution({ ...input, holders: shuffled });
      expect(byUser(b)).toEqual(byUser(a));
      expect(b.roundingRemainderCents).toBe(a.roundingRemainderCents);
    }
  });

  it("returns payments in input order and does not mutate the input", () => {
    const holders = Object.freeze([
      Object.freeze({ userId: "z", units: 1n * SHARE }),
      Object.freeze({ userId: "a", units: 5n * SHARE }),
    ]);
    const plan = planDistribution({ netIncomeCents: 600n, carryInCents: 0n, reserveBps: 0, holders });
    expect(plan.payments.map((p) => p.userId)).toEqual(["z", "a"]);
    expect(plan.payments.map((p) => p.amountCents)).toEqual([100n, 500n]);
  });
});

describe("planDistribution: randomized conservation", () => {
  it("never creates or loses a cent", () => {
    const r = prng(123456789);
    for (let iter = 0; iter < 2500; iter++) {
      const n = r.int(0, 25);
      const holders: HolderUnits[] = Array.from({ length: n }, (_, i) => ({
        userId: `h${String(i).padStart(3, "0")}`,
        units: r.next() < 0.1 ? 0n : r.next() < 0.5 ? r.big(1, 500) * 10_000n : r.big(1, 80_000_000),
      }));
      const netIncomeCents = r.next() < 0.1 ? -r.big(0, 100_000) : r.big(1, 30_000_000);
      const carryInCents = r.big(0, 4);
      const reserveBps = r.int(0, 10_000);
      const plan = planDistribution({ netIncomeCents, carryInCents, reserveBps, holders });

      const live = holders.filter((h) => h.units > 0n);
      const outstanding = sum(live.map((h) => h.units));

      // Structural invariants.
      expect(plan.payments).toHaveLength(live.length);
      expect(plan.outstandingUnits).toBe(outstanding);
      expect(paid(plan)).toBe(plan.distributedCents);
      expect(plan.distributedCents + plan.roundingRemainderCents).toBe(plan.poolCents);
      expect(plan.roundingRemainderCents >= 0n).toBe(true);
      for (const p of plan.payments) expect(p.amountCents >= 0n).toBe(true);

      if (netIncomeCents <= 0n) {
        expect(plan.distributedCents).toBe(0n);
        expect(plan.reserveAllocationCents).toBe(0n);
        expect(plan.roundingRemainderCents).toBe(carryInCents);
        continue;
      }

      // Every cent of income + carry lands in exactly one of: reserve, holders, next month's carry.
      expect(plan.reserveAllocationCents + plan.distributedCents + plan.roundingRemainderCents).toBe(
        netIncomeCents + carryInCents,
      );
      expect(plan.reserveAllocationCents >= 0n && plan.reserveAllocationCents <= netIncomeCents).toBe(true);

      if (outstanding === 0n) {
        expect(plan.distributedCents).toBe(0n);
        continue;
      }

      // The published rate never over-promises, and (below a million shares outstanding)
      // at most one cent is held back.
      expect(plan.perShareMicroCents * outstanding <= plan.poolCents * SCALE).toBe(true);
      expect(plan.roundingRemainderCents <= 1n).toBe(true);

      // Each holder is within one cent of units x rate.
      for (const p of plan.payments) {
        const floor = (p.units * plan.perShareMicroCents) / SCALE;
        expect(p.amountCents === floor || p.amountCents === floor + 1n).toBe(true);
      }
    }
  });

  it("a multi-month simulation conserves cash when the remainder is fed back as carry", () => {
    const r = prng(555);
    const holders: HolderUnits[] = Array.from({ length: 7 }, (_, i) => ({ userId: `h${i}`, units: r.big(1, 900) * 10_000n }));
    let carry = 0n;
    let incomeIn = 0n;
    let toReserve = 0n;
    let toHolders = 0n;
    for (let month = 0; month < 120; month++) {
      const net = r.next() < 0.15 ? -r.big(0, 50_000) : r.big(1, 400_000);
      const plan = planDistribution({ netIncomeCents: net, carryInCents: carry, reserveBps: 500, holders });
      if (net > 0n) incomeIn += net;
      toReserve += plan.reserveAllocationCents;
      toHolders += plan.distributedCents;
      carry = plan.roundingRemainderCents;
      expect(carry >= 0n && carry <= 1n).toBe(true);
    }
    expect(toReserve + toHolders + carry).toBe(incomeIn);
  });

  it("stays exact with more than a million shares outstanding (remainder may be a few cents)", () => {
    const holders: HolderUnits[] = Array.from({ length: 5 }, (_, i) => ({
      userId: `w${i}`,
      units: 700_000n * SHARE + BigInt(i) * 333_333n,
    }));
    const plan = planDistribution({ netIncomeCents: 987_654_321n, carryInCents: 2n, reserveBps: 750, holders });
    expect(paid(plan)).toBe(plan.distributedCents);
    expect(plan.distributedCents + plan.roundingRemainderCents).toBe(plan.poolCents);
    expect(plan.roundingRemainderCents >= 0n && plan.roundingRemainderCents <= 5n).toBe(true);
  });
});

describe("netIncome", () => {
  const base = {
    grossRentCents: 500_000n,
    vacancyLossCents: 25_000n,
    managementFeeCents: 40_000n,
    maintenanceCents: 30_000n,
    taxesCents: 60_000n,
    insuranceCents: 15_000n,
    hoaCents: 10_000n,
    otherExpensesCents: 5_000n,
  };

  it("subtracts every line item from gross rent", () => {
    expect(netIncome(base)).toBe(315_000n);
  });

  it("can be negative", () => {
    expect(netIncome({ ...base, maintenanceCents: 900_000n })).toBe(-555_000n);
  });

  it("is gross rent when there are no deductions", () => {
    expect(
      netIncome({
        grossRentCents: 1n,
        vacancyLossCents: 0n,
        managementFeeCents: 0n,
        maintenanceCents: 0n,
        taxesCents: 0n,
        insuranceCents: 0n,
        hoaCents: 0n,
        otherExpensesCents: 0n,
      }),
    ).toBe(1n);
  });
});

describe("formatPerShare", () => {
  it("shows four decimals of a dollar, truncated", () => {
    expect(formatPerShare(7_310_000n)).toBe("$0.0731"); // 7.31 cents
    expect(formatPerShare(7_319_999n)).toBe("$0.0731");
    expect(formatPerShare(0n)).toBe("$0.0000");
    expect(formatPerShare(100n * MICRO)).toBe("$1.0000");
    expect(formatPerShare(1_570_297_520n)).toBe("$15.7029");
    expect(formatPerShare(9_999n)).toBe("$0.0000");
    expect(formatPerShare(10_000n)).toBe("$0.0001");
  });
});
