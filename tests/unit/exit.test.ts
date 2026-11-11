import { describe, expect, it } from "vitest";
import { distributeExitProceeds, netSaleProceeds, type ExitHolder } from "@/lib/domain/exit";
import { prng, sum } from "./_prng";

const SHARE = 1_000_000n;
const holder = (userId: string, units: bigint, costBasisCents = 0n, dividendsCents = 0n): ExitHolder => ({
  userId,
  units,
  costBasisCents,
  dividendsCents,
});
const amounts = (plans: { userId: string; amountCents: bigint }[]) => Object.fromEntries(plans.map((p) => [p.userId, p.amountCents]));

describe("netSaleProceeds", () => {
  it("is sale price less costs plus other cash", () => {
    expect(netSaleProceeds({ salePriceCents: 50_000_000n, saleCostsCents: 3_000_000n, otherCashCents: 125_003n })).toBe(47_125_003n);
  });

  it("is the sale price when there are no costs or other cash", () => {
    expect(netSaleProceeds({ salePriceCents: 1_000n, saleCostsCents: 0n, otherCashCents: 0n })).toBe(1_000n);
  });

  it("floors at zero when costs exceed everything", () => {
    expect(netSaleProceeds({ salePriceCents: 1_000n, saleCostsCents: 5_000n, otherCashCents: 0n })).toBe(0n);
    expect(netSaleProceeds({ salePriceCents: 1_000n, saleCostsCents: 5_000n, otherCashCents: 3_999n })).toBe(0n);
    expect(netSaleProceeds({ salePriceCents: 0n, saleCostsCents: 1n, otherCashCents: 0n })).toBe(0n);
  });

  it("is exactly zero at break-even and one cent just above", () => {
    expect(netSaleProceeds({ salePriceCents: 1_000n, saleCostsCents: 5_000n, otherCashCents: 4_000n })).toBe(0n);
    expect(netSaleProceeds({ salePriceCents: 1_000n, saleCostsCents: 5_000n, otherCashCents: 4_001n })).toBe(1n);
  });

  it("other cash alone is returned even with a zero sale price", () => {
    expect(netSaleProceeds({ salePriceCents: 0n, saleCostsCents: 0n, otherCashCents: 77n })).toBe(77n);
  });
});

describe("distributeExitProceeds", () => {
  it("splits pro rata by shares", () => {
    const plans = distributeExitProceeds(1_000_000n, [holder("a", 10n * SHARE), holder("b", 30n * SHARE), holder("c", 60n * SHARE)]);
    expect(amounts(plans)).toEqual({ a: 100_000n, b: 300_000n, c: 600_000n });
  });

  it("gives a sole holder everything", () => {
    const plans = distributeExitProceeds(12_345_679n, [holder("only", 7n)]);
    expect(plans).toHaveLength(1);
    expect(plans[0]!.amountCents).toBe(12_345_679n);
  });

  it("hands leftover cents to the largest remainders", () => {
    // 100 cents by 1:2:4 -> 14.29 / 28.57 / 57.14 -> floors 14/28/57 (99); the spare cent goes to b (.57)
    const plans = distributeExitProceeds(100n, [holder("a", 1n * SHARE), holder("b", 2n * SHARE), holder("c", 4n * SHARE)]);
    expect(amounts(plans)).toEqual({ a: 14n, b: 29n, c: 57n });
  });

  it("breaks exact ties by userId, independent of input order", () => {
    const hs = [holder("carol", SHARE), holder("alice", SHARE), holder("bob", SHARE)];
    const expected = { alice: 34n, bob: 33n, carol: 33n };
    expect(amounts(distributeExitProceeds(100n, hs))).toEqual(expected);
    expect(amounts(distributeExitProceeds(100n, [...hs].reverse()))).toEqual(expected);
    expect(amounts(distributeExitProceeds(100n, [hs[1]!, hs[2]!, hs[0]!]))).toEqual(expected);
  });

  it("returns plans sorted by userId and does not mutate the input", () => {
    const hs = [holder("c", SHARE), holder("a", SHARE), holder("b", SHARE)];
    const plans = distributeExitProceeds(300n, hs);
    expect(plans.map((p) => p.userId)).toEqual(["a", "b", "c"]);
    expect(hs.map((h) => h.userId)).toEqual(["c", "a", "b"]);
  });

  it("drops holders with no units and pays nothing to them", () => {
    const plans = distributeExitProceeds(1_000n, [holder("a", SHARE), holder("gone", 0n, 5_000n, 100n), holder("b", SHARE)]);
    expect(plans.map((p) => p.userId)).toEqual(["a", "b"]);
    expect(sum(plans.map((p) => p.amountCents))).toBe(1_000n);
  });

  it("pays zero to everyone when there are no proceeds", () => {
    const plans = distributeExitProceeds(0n, [holder("a", SHARE, 1_000n, 50n), holder("b", 2n * SHARE, 2_000n, 100n)]);
    expect(plans.map((p) => p.amountCents)).toEqual([0n, 0n]);
    expect(plans.map((p) => p.totalReturnCents)).toEqual([-950n, -1_900n]);
  });

  it("returns nothing when there are no holders", () => {
    expect(distributeExitProceeds(1_000n, [])).toEqual([]);
    expect(distributeExitProceeds(1_000n, [holder("z", 0n)])).toEqual([]);
  });

  it("rejects negative proceeds (callers must use netSaleProceeds, which floors at 0)", () => {
    expect(() => distributeExitProceeds(-1n, [holder("a", SHARE)])).toThrow(RangeError);
  });

  it("a tiny holder can receive zero cents but the total is still exact", () => {
    const plans = distributeExitProceeds(5n, [holder("dust", 1n), holder("whale", 1_000_000n * SHARE)]);
    expect(amounts(plans)).toEqual({ dust: 0n, whale: 5n });
  });

  it("sums exactly to net proceeds and is pro rata within one cent (randomized)", () => {
    const r = prng(360);
    for (let iter = 0; iter < 1500; iter++) {
      const hs = Array.from({ length: r.int(1, 30) }, (_, i) =>
        holder(`u${String(i).padStart(2, "0")}`, r.next() < 0.1 ? 0n : r.big(1, 200_000_000), r.big(0, 1_000_000), r.big(0, 100_000)),
      );
      // shuffle so input order differs from userId order
      const shuffled = [...hs].sort(() => r.next() - 0.5);
      const net = r.big(0, 2_000_000_000);
      const plans = distributeExitProceeds(net, shuffled);
      const live = hs.filter((h) => h.units > 0n);
      const totalUnits = sum(live.map((h) => h.units));

      expect(plans.map((p) => p.userId)).toEqual(live.map((h) => h.userId));
      if (live.length === 0) continue;
      expect(sum(plans.map((p) => p.amountCents))).toBe(net);

      plans.forEach((p, i) => {
        const h = live[i]!;
        const floor = (net * h.units) / totalUnits;
        expect(p.units).toBe(h.units);
        expect(p.amountCents === floor || p.amountCents === floor + 1n).toBe(true);
        expect(p.totalReturnCents).toBe(p.amountCents + h.dividendsCents - h.costBasisCents);
      });
      // More shares never means less money.
      for (const p of plans) for (const q of plans) if (p.units > q.units) expect(p.amountCents >= q.amountCents).toBe(true);
      // Same result whatever order the holders arrive in.
      expect(distributeExitProceeds(net, hs)).toEqual(plans);
    }
  });

  it("an end-to-end sale conserves cash: price - costs + other cash == sum of payouts", () => {
    const net = netSaleProceeds({ salePriceCents: 61_250_000n, saleCostsCents: 3_675_001n, otherCashCents: 48_217n });
    const hs = [holder("a", 1_234_567n), holder("b", 7_654_321n), holder("c", 333_333n), holder("d", 90_777_779n)];
    expect(sum(distributeExitProceeds(net, hs).map((p) => p.amountCents))).toBe(57_623_216n);
  });
});

describe("distributeExitProceeds: total return", () => {
  it("is proceeds + dividends - cost basis, with the bps of basis", () => {
    // Two equal holders split $3,000.00.
    const plans = distributeExitProceeds(300_000n, [
      holder("gain", 5n * SHARE, 100_000n, 20_000n), // 150,000 + 20,000 - 100,000 = +70,000 (70%)
      holder("loss", 5n * SHARE, 200_000n, 10_000n), // 150,000 + 10,000 - 200,000 = -40,000 (-20%)
    ]);
    expect(plans[0]).toEqual({
      userId: "gain",
      units: 5n * SHARE,
      amountCents: 150_000n,
      costBasisCents: 100_000n,
      dividendsCents: 20_000n,
      totalReturnCents: 70_000n,
      totalReturnBps: 7000,
    });
    expect(plans[1]).toMatchObject({ userId: "loss", totalReturnCents: -40_000n, totalReturnBps: -2000 });
  });

  it("is zero at exact break-even", () => {
    const [p] = distributeExitProceeds(900n, [holder("a", SHARE, 1_000n, 100n)]);
    expect(p!.totalReturnCents).toBe(0n);
    expect(p!.totalReturnBps).toBe(0);
  });

  it("reports 0 bps (not Infinity/NaN) when the cost basis is zero", () => {
    const [p] = distributeExitProceeds(500n, [holder("gifted", SHARE, 0n, 25n)]);
    expect(p!.totalReturnCents).toBe(525n);
    expect(p!.totalReturnBps).toBe(0);
  });

  it("truncates bps toward zero for gains and losses", () => {
    const [g] = distributeExitProceeds(4n, [holder("g", SHARE, 3n, 0n)]); // +1/3 = 33.33%
    expect(g!.totalReturnBps).toBe(3333);
    const [l] = distributeExitProceeds(2n, [holder("l", SHARE, 3n, 0n)]); // -1/3
    expect(l!.totalReturnBps).toBe(-3333);
  });

  it("a total loss is -100%", () => {
    const [p] = distributeExitProceeds(0n, [holder("a", SHARE, 5_000n, 0n)]);
    expect(p!.totalReturnCents).toBe(-5_000n);
    expect(p!.totalReturnBps).toBe(-10_000);
  });

  it("dividends alone can make a losing sale a winning investment", () => {
    const [p] = distributeExitProceeds(900n, [holder("a", SHARE, 1_000n, 250n)]);
    expect(p!.totalReturnCents).toBe(150n);
    expect(p!.totalReturnBps).toBe(1500);
  });
});
