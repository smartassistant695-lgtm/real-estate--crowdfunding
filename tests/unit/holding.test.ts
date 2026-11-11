import { describe, expect, it } from "vitest";
import { addMonths, consumeLotsFifo, isLotSellable, sellableAt, sellableUnits, type Lot } from "@/lib/domain/holding";
import { prng, sum } from "./_prng";

const utc = (iso: string) => new Date(iso);
const SHARE = 1_000_000n;
const lot = (id: string, acquiredAt: string, units: bigint, basis: bigint): Lot => ({
  id,
  acquiredAt: utc(acquiredAt),
  remainingUnits: units,
  costBasisCents: basis,
});

describe("addMonths", () => {
  it("adds calendar months, keeping the day and the time of day", () => {
    expect(addMonths(utc("2024-01-15T10:30:45.123Z"), 1).toISOString()).toBe("2024-02-15T10:30:45.123Z");
    expect(addMonths(utc("2024-03-10T00:00:00.000Z"), 12).toISOString()).toBe("2025-03-10T00:00:00.000Z");
  });

  it("clamps to the end of a shorter month instead of spilling over", () => {
    expect(addMonths(utc("2023-01-31T12:00:00Z"), 1).toISOString()).toBe("2023-02-28T12:00:00.000Z");
    expect(addMonths(utc("2024-01-31T12:00:00Z"), 1).toISOString()).toBe("2024-02-29T12:00:00.000Z"); // leap year
    expect(addMonths(utc("2024-01-30T12:00:00Z"), 1).toISOString()).toBe("2024-02-29T12:00:00.000Z");
    expect(addMonths(utc("2024-03-31T00:00:00Z"), 1).toISOString()).toBe("2024-04-30T00:00:00.000Z");
    expect(addMonths(utc("2024-05-31T23:59:59.999Z"), 1).toISOString()).toBe("2024-06-30T23:59:59.999Z");
    expect(addMonths(utc("2024-08-31T00:00:00Z"), 6).toISOString()).toBe("2025-02-28T00:00:00.000Z");
    expect(addMonths(utc("2023-08-31T00:00:00Z"), 6).toISOString()).toBe("2024-02-29T00:00:00.000Z");
  });

  it("Feb 29 plus a year lands on Feb 28", () => {
    expect(addMonths(utc("2024-02-29T08:00:00Z"), 12).toISOString()).toBe("2025-02-28T08:00:00.000Z");
    expect(addMonths(utc("2024-02-29T08:00:00Z"), 48).toISOString()).toBe("2028-02-29T08:00:00.000Z");
  });

  it("does not clamp when the target month is long enough", () => {
    expect(addMonths(utc("2024-01-31T00:00:00Z"), 2).toISOString()).toBe("2024-03-31T00:00:00.000Z");
    expect(addMonths(utc("2024-02-29T00:00:00Z"), 1).toISOString()).toBe("2024-03-29T00:00:00.000Z");
  });

  it("rolls over year boundaries", () => {
    expect(addMonths(utc("2024-12-15T00:00:00Z"), 1).toISOString()).toBe("2025-01-15T00:00:00.000Z");
    expect(addMonths(utc("2024-11-30T00:00:00Z"), 3).toISOString()).toBe("2025-02-28T00:00:00.000Z");
    expect(addMonths(utc("2024-06-15T00:00:00Z"), 30).toISOString()).toBe("2026-12-15T00:00:00.000Z");
  });

  it("zero months is the identity; negative months go back, clamped", () => {
    expect(addMonths(utc("2024-01-31T01:02:03Z"), 0).toISOString()).toBe("2024-01-31T01:02:03.000Z");
    expect(addMonths(utc("2024-03-31T00:00:00Z"), -1).toISOString()).toBe("2024-02-29T00:00:00.000Z");
    expect(addMonths(utc("2024-01-15T00:00:00Z"), -1).toISOString()).toBe("2023-12-15T00:00:00.000Z");
  });

  it("works in UTC at day boundaries (no local-timezone drift)", () => {
    expect(addMonths(utc("2024-01-31T23:59:59.999Z"), 1).toISOString()).toBe("2024-02-29T23:59:59.999Z");
    expect(addMonths(utc("2024-02-01T00:00:00.000Z"), 1).toISOString()).toBe("2024-03-01T00:00:00.000Z");
  });

  it("does not mutate its argument", () => {
    const d = utc("2024-01-31T00:00:00Z");
    addMonths(d, 1);
    expect(d.toISOString()).toBe("2024-01-31T00:00:00.000Z");
  });

  it("is monotonic by day: a purchase on a later day never becomes sellable on an earlier day", () => {
    const r = prng(606);
    for (let i = 0; i < 2000; i++) {
      const a = Date.UTC(2023, 0, 1) + r.int(0, 3 * 365) * 86_400_000;
      const b = a + r.int(0, 40) * 86_400_000;
      const months = r.int(0, 36);
      expect(addMonths(new Date(a), months).getTime() <= addMonths(new Date(b), months).getTime()).toBe(true);
    }
  });

  // NOTE (holding.ts addMonths): because of month-end clamping with the time of day preserved,
  // a lot bought Jan 30 23:00 unlocks Feb 29 23:00 while a lot bought two hours LATER
  // (Jan 31 01:00) unlocks Feb 29 01:00, i.e. 22 hours EARLIER. Harmless for FIFO (ordering is by
  // acquiredAt) but worth knowing. Suggested fix if it matters: clamp to the start of the next
  // month (Mar 1 00:00) rather than to the same time on the last day.
  it.fails("is monotonic to the millisecond across a month-end clamp", () => {
    const earlier = addMonths(utc("2024-01-30T23:00:00Z"), 1);
    const later = addMonths(utc("2024-01-31T01:00:00Z"), 1);
    expect(earlier.getTime() <= later.getTime()).toBe(true);
  });
});

describe("sellableAt / isLotSellable", () => {
  const acquiredAt = utc("2024-01-31T15:30:00.000Z");

  it("is the acquisition instant plus the holding period", () => {
    expect(sellableAt(acquiredAt, 12).toISOString()).toBe("2025-01-31T15:30:00.000Z");
    expect(sellableAt(acquiredAt, 1).toISOString()).toBe("2024-02-29T15:30:00.000Z");
  });

  it("flips exactly at the instant: one ms before is locked, the instant itself is sellable", () => {
    const at = sellableAt(acquiredAt, 12);
    expect(isLotSellable({ acquiredAt }, new Date(at.getTime() - 1), 12)).toBe(false);
    expect(isLotSellable({ acquiredAt }, new Date(at.getTime()), 12)).toBe(true);
    expect(isLotSellable({ acquiredAt }, new Date(at.getTime() + 1), 12)).toBe(true);
  });

  it("a zero-month holding period is sellable immediately", () => {
    expect(isLotSellable({ acquiredAt }, acquiredAt, 0)).toBe(true);
    expect(isLotSellable({ acquiredAt }, new Date(acquiredAt.getTime() - 1), 0)).toBe(false);
  });

  it("is locked on the day of purchase and the day before the anniversary", () => {
    expect(isLotSellable({ acquiredAt }, acquiredAt, 12)).toBe(false);
    expect(isLotSellable({ acquiredAt }, utc("2025-01-30T23:59:59.999Z"), 12)).toBe(false);
    expect(isLotSellable({ acquiredAt }, utc("2025-01-31T15:29:59.999Z"), 12)).toBe(false);
  });
});

describe("sellableUnits", () => {
  const lots = [
    lot("old", "2023-01-10T00:00:00Z", 2n * SHARE, 5000n),
    lot("edge", "2023-06-15T12:00:00Z", 1_500_000n, 4000n),
    lot("new", "2024-03-01T00:00:00Z", 4n * SHARE, 9000n),
  ];

  it("sums only lots past the holding period", () => {
    expect(sellableUnits(lots, utc("2024-02-01T00:00:00Z"), 12)).toBe(2n * SHARE);
    expect(sellableUnits(lots, utc("2024-12-31T00:00:00Z"), 12)).toBe(3_500_000n);
    expect(sellableUnits(lots, utc("2025-03-01T00:00:00Z"), 12)).toBe(7_500_000n);
  });

  it("includes a lot exactly at its unlock instant and not a millisecond before", () => {
    expect(sellableUnits(lots, utc("2024-06-15T11:59:59.999Z"), 12)).toBe(2n * SHARE);
    expect(sellableUnits(lots, utc("2024-06-15T12:00:00.000Z"), 12)).toBe(3_500_000n);
  });

  it("is zero when nothing has unlocked, or there are no lots", () => {
    expect(sellableUnits(lots, utc("2023-12-31T00:00:00Z"), 12)).toBe(0n);
    expect(sellableUnits([], utc("2030-01-01T00:00:00Z"), 12)).toBe(0n);
  });

  it("everything is sellable with no holding period", () => {
    expect(sellableUnits(lots, utc("2024-03-01T00:00:00Z"), 0)).toBe(7_500_000n);
  });
});

describe("consumeLotsFifo", () => {
  const lots = [
    lot("c-newest", "2024-03-01T00:00:00Z", 4n * SHARE, 9000n),
    lot("a-oldest", "2023-01-10T00:00:00Z", 2n * SHARE, 5000n),
    lot("b-middle", "2023-06-15T00:00:00Z", 3n * SHARE, 1000n),
  ];

  it("takes from the oldest lot first, whatever the array order", () => {
    expect(consumeLotsFifo(lots, 1n * SHARE)).toEqual([{ lotId: "a-oldest", units: SHARE, costBasisCents: 2500n }]);
  });

  it("spans lots in acquisition order", () => {
    expect(consumeLotsFifo(lots, 6n * SHARE)).toEqual([
      { lotId: "a-oldest", units: 2n * SHARE, costBasisCents: 5000n },
      { lotId: "b-middle", units: 3n * SHARE, costBasisCents: 1000n },
      { lotId: "c-newest", units: 1n * SHARE, costBasisCents: 2250n },
    ]);
  });

  it("emptying a lot exactly takes all of its basis and touches nothing newer", () => {
    expect(consumeLotsFifo(lots, 2n * SHARE)).toEqual([{ lotId: "a-oldest", units: 2n * SHARE, costBasisCents: 5000n }]);
  });

  it("consuming everything takes every unit and every basis cent", () => {
    const out = consumeLotsFifo(lots, 9n * SHARE);
    expect(sum(out.map((c) => c.units))).toBe(9n * SHARE);
    expect(sum(out.map((c) => c.costBasisCents))).toBe(15_000n);
  });

  it("rounds partial basis down, leaving the odd cent in the lot", () => {
    const one = [lot("x", "2024-01-01T00:00:00Z", 3n * SHARE, 1000n)];
    const [c] = consumeLotsFifo(one, 1n * SHARE);
    expect(c!.costBasisCents).toBe(333n); // 333.33
    // The 667 left behind leaves with the final sale of the remaining 2 shares.
    const rest = [lot("x", "2024-01-01T00:00:00Z", 2n * SHARE, 1000n - c!.costBasisCents)];
    expect(consumeLotsFifo(rest, 2n * SHARE)[0]!.costBasisCents).toBe(667n);
  });

  it("breaks same-instant ties by lot id", () => {
    const tied = [lot("b", "2024-01-01T00:00:00Z", SHARE, 200n), lot("a", "2024-01-01T00:00:00Z", SHARE, 100n)];
    expect(consumeLotsFifo(tied, 1_500_000n).map((c) => c.lotId)).toEqual(["a", "b"]);
  });

  it("skips empty lots", () => {
    const withEmpty = [lot("empty", "2020-01-01T00:00:00Z", 0n, 0n), ...lots];
    expect(consumeLotsFifo(withEmpty, SHARE).map((c) => c.lotId)).toEqual(["a-oldest"]);
  });

  it("throws when the lots do not hold enough", () => {
    expect(() => consumeLotsFifo(lots, 9n * SHARE + 1n)).toThrow(RangeError);
    expect(() => consumeLotsFifo(lots, 9n * SHARE + 1n)).toThrow(/Not enough units/);
    expect(() => consumeLotsFifo([], 1n)).toThrow(RangeError);
  });

  it("throws for zero or negative units", () => {
    expect(() => consumeLotsFifo(lots, 0n)).toThrow(RangeError);
    expect(() => consumeLotsFifo(lots, -1n)).toThrow(RangeError);
  });

  it("does not mutate the lots or reorder the caller's array", () => {
    const copy = lots.map((l) => ({ ...l }));
    consumeLotsFifo(lots, 6n * SHARE);
    expect(lots).toEqual(copy);
    expect(lots.map((l) => l.id)).toEqual(["c-newest", "a-oldest", "b-middle"]);
  });

  it("conserves units and basis over a random sequence of sales (randomized)", () => {
    const r = prng(1999);
    for (let iter = 0; iter < 300; iter++) {
      let book: Lot[] = Array.from({ length: r.int(1, 8) }, (_, i) => ({
        id: `lot-${i}`,
        acquiredAt: new Date(Date.UTC(2023, 0, 1) + r.int(0, 20) * 86_400_000),
        remainingUnits: r.big(1, 5_000_000),
        costBasisCents: r.big(0, 2_000_000),
      }));
      const totalUnits = sum(book.map((l) => l.remainingUnits));
      const totalBasis = sum(book.map((l) => l.costBasisCents));
      let soldUnits = 0n;
      let soldBasis = 0n;

      while (soldUnits < totalUnits) {
        const left = totalUnits - soldUnits;
        const want = r.next() < 0.2 ? left : BigInt(r.int(1, Math.min(Number(left), 3_000_000)));
        const ordered = [...book]
          .filter((l) => l.remainingUnits > 0n)
          .sort((a, b) => a.acquiredAt.getTime() - b.acquiredAt.getTime() || (a.id < b.id ? -1 : 1));
        const out = consumeLotsFifo(book, want);

        expect(sum(out.map((c) => c.units))).toBe(want);
        // FIFO: the consumed lots are a prefix of the age-ordered lots, and all but the last are emptied.
        expect(out.map((c) => c.lotId)).toEqual(ordered.slice(0, out.length).map((l) => l.id));
        out.forEach((c, i) => {
          const l = ordered[i]!;
          expect(c.units > 0n && c.units <= l.remainingUnits).toBe(true);
          expect(c.costBasisCents >= 0n && c.costBasisCents <= l.costBasisCents).toBe(true);
          if (i < out.length - 1) expect(c.units).toBe(l.remainingUnits);
          if (c.units === l.remainingUnits) expect(c.costBasisCents).toBe(l.costBasisCents);
        });

        // Apply, as the caller would.
        book = book.map((l) => {
          const c = out.find((x) => x.lotId === l.id);
          return c ? { ...l, remainingUnits: l.remainingUnits - c.units, costBasisCents: l.costBasisCents - c.costBasisCents } : l;
        });
        soldUnits += want;
        soldBasis += sum(out.map((c) => c.costBasisCents));
        expect(soldBasis + sum(book.map((l) => l.costBasisCents))).toBe(totalBasis);
      }

      expect(soldBasis).toBe(totalBasis);
      expect(book.every((l) => l.remainingUnits === 0n && l.costBasisCents === 0n)).toBe(true);
    }
  });
});
