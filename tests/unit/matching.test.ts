import { describe, expect, it } from "vitest";
import { depth, matchOrder, sortBook, type BookOrder } from "@/lib/domain/matching";
import { buyOrderHold, MIN_ORDER_PRICE_CENTS, ORDER_LOT_UNITS, tradeNotional } from "@/lib/domain/money";
import { prng, sum } from "./_prng";

const SHARE = 1_000_000n;
let autoSeq = 1000;
function order(
  id: string,
  side: "BUY" | "SELL",
  price: bigint,
  units: bigint,
  opts: { userId?: string; seq?: number } = {},
): BookOrder {
  return { id, side, limitPriceCents: price, remainingUnits: units, userId: opts.userId ?? `user-${id}`, seq: opts.seq ?? autoSeq++ };
}
const incoming = (side: "BUY" | "SELL", price: bigint, units: bigint, userId = "taker"): BookOrder =>
  order("incoming", side, price, units, { userId, seq: 1_000_000 });

describe("sortBook", () => {
  const book = [
    order("s1", "SELL", 1050n, SHARE, { seq: 3 }),
    order("s2", "SELL", 1000n, SHARE, { seq: 5 }),
    order("s3", "SELL", 1000n, SHARE, { seq: 4 }),
    order("b1", "BUY", 900n, SHARE, { seq: 1 }),
    order("b2", "BUY", 950n, SHARE, { seq: 7 }),
    order("b3", "BUY", 950n, SHARE, { seq: 2 }),
    order("dead", "SELL", 1n, 0n, { seq: 0 }),
  ];

  it("sorts asks cheapest first, then earliest", () => {
    expect(sortBook(book, "SELL").map((o) => o.id)).toEqual(["s3", "s2", "s1"]);
  });

  it("sorts bids highest first, then earliest", () => {
    expect(sortBook(book, "BUY").map((o) => o.id)).toEqual(["b3", "b2", "b1"]);
  });

  it("drops fully filled orders and does not mutate the input", () => {
    const before = book.map((o) => o.id);
    expect(sortBook(book, "SELL").some((o) => o.id === "dead")).toBe(false);
    expect(book.map((o) => o.id)).toEqual(before);
  });
});

describe("matchOrder: fills", () => {
  it("fully fills against a single resting order of the same size", () => {
    const book = [order("s1", "SELL", 1000n, 2n * SHARE)];
    const { fills, remainingUnits } = matchOrder(incoming("BUY", 1000n, 2n * SHARE), book);
    expect(remainingUnits).toBe(0n);
    expect(fills).toEqual([
      { restingOrderId: "s1", restingUserId: "user-s1", priceCents: 1000n, units: 2n * SHARE, notionalCents: 2000n },
    ]);
  });

  it("fully fills the incoming order and leaves the rest of a larger resting order", () => {
    const book = [order("s1", "SELL", 1000n, 5n * SHARE)];
    const { fills, remainingUnits } = matchOrder(incoming("BUY", 1000n, 2n * SHARE), book);
    expect(remainingUnits).toBe(0n);
    expect(fills).toHaveLength(1);
    expect(fills[0]!.units).toBe(2n * SHARE);
    expect(book[0]!.remainingUnits).toBe(5n * SHARE); // pure: the caller persists
  });

  it("partially fills when the book is too thin", () => {
    const book = [order("s1", "SELL", 1000n, 1_500_000n)];
    const { fills, remainingUnits } = matchOrder(incoming("BUY", 1000n, 4n * SHARE), book);
    expect(fills.map((f) => f.units)).toEqual([1_500_000n]);
    expect(remainingUnits).toBe(2_500_000n);
  });

  it("returns no fills against an empty book", () => {
    expect(matchOrder(incoming("BUY", 1000n, SHARE), [])).toEqual({ fills: [], remainingUnits: SHARE });
  });

  it("ignores resting orders on the same side", () => {
    const book = [order("b1", "BUY", 2000n, SHARE)];
    expect(matchOrder(incoming("BUY", 1000n, SHARE), book).fills).toEqual([]);
    const asks = [order("s1", "SELL", 1n, SHARE)];
    expect(matchOrder(incoming("SELL", 1000n, SHARE), asks).fills).toEqual([]);
  });

  it("ignores resting orders with nothing remaining", () => {
    const book = [order("s0", "SELL", 900n, 0n), order("s1", "SELL", 1000n, SHARE)];
    const { fills } = matchOrder(incoming("BUY", 1000n, SHARE), book);
    expect(fills.map((f) => f.restingOrderId)).toEqual(["s1"]);
  });

  it("an incoming order with nothing remaining matches nothing", () => {
    const book = [order("s1", "SELL", 1000n, SHARE)];
    expect(matchOrder(incoming("BUY", 1000n, 0n), book)).toEqual({ fills: [], remainingUnits: 0n });
  });
});

describe("matchOrder: price-time priority", () => {
  it("a buy takes the cheapest ask first", () => {
    const book = [
      order("dear", "SELL", 1020n, SHARE, { seq: 1 }),
      order("cheap", "SELL", 1000n, SHARE, { seq: 2 }),
      order("mid", "SELL", 1010n, SHARE, { seq: 3 }),
    ];
    const { fills } = matchOrder(incoming("BUY", 1050n, 2n * SHARE), book);
    expect(fills.map((f) => f.restingOrderId)).toEqual(["cheap", "mid"]);
  });

  it("a sell takes the highest bid first", () => {
    const book = [
      order("low", "BUY", 980n, SHARE, { seq: 1 }),
      order("high", "BUY", 1000n, SHARE, { seq: 2 }),
      order("mid", "BUY", 990n, SHARE, { seq: 3 }),
    ];
    const { fills } = matchOrder(incoming("SELL", 900n, 2n * SHARE), book);
    expect(fills.map((f) => f.restingOrderId)).toEqual(["high", "mid"]);
  });

  it("at the same price the earlier order (lower seq) fills first, regardless of array order", () => {
    const book = [
      order("late", "SELL", 1000n, SHARE, { seq: 9 }),
      order("early", "SELL", 1000n, SHARE, { seq: 2 }),
      order("middle", "SELL", 1000n, SHARE, { seq: 5 }),
    ];
    const { fills, remainingUnits } = matchOrder(incoming("BUY", 1000n, 2_500_000n), book);
    expect(fills.map((f) => [f.restingOrderId, f.units])).toEqual([
      ["early", SHARE],
      ["middle", SHARE],
      ["late", 500_000n],
    ]);
    expect(remainingUnits).toBe(0n);
  });

  it("price beats time: a later but better-priced order fills before an earlier worse one", () => {
    const book = [order("early-worse", "SELL", 1010n, SHARE, { seq: 1 }), order("late-better", "SELL", 1000n, SHARE, { seq: 99 })];
    const { fills } = matchOrder(incoming("BUY", 1010n, SHARE), book);
    expect(fills.map((f) => f.restingOrderId)).toEqual(["late-better"]);
  });
});

describe("matchOrder: trade price", () => {
  it("a buy trades at the resting ask, not at its own higher limit", () => {
    const book = [order("s1", "SELL", 1000n, SHARE)];
    const { fills } = matchOrder(incoming("BUY", 1200n, SHARE), book);
    expect(fills[0]!.priceCents).toBe(1000n);
    expect(fills[0]!.notionalCents).toBe(1000n);
  });

  it("a sell trades at the resting bid, not at its own lower limit", () => {
    const book = [order("b1", "BUY", 1000n, SHARE)];
    const { fills } = matchOrder(incoming("SELL", 800n, SHARE), book);
    expect(fills[0]!.priceCents).toBe(1000n);
    expect(fills[0]!.notionalCents).toBe(1000n);
  });

  it("notional is tradeNotional(units, resting price), rounded down", () => {
    const book = [order("s1", "SELL", 1999n, 30_000n)];
    const { fills } = matchOrder(incoming("BUY", 2000n, 10_000n), book);
    expect(fills[0]!.notionalCents).toBe(19n); // 0.01 share x $19.99 = 19.99 cents
    expect(fills[0]!.notionalCents).toBe(tradeNotional(10_000n, 1999n));
  });
});

describe("matchOrder: no cross", () => {
  it("a buy below the best ask does not trade", () => {
    const book = [order("s1", "SELL", 1001n, SHARE)];
    expect(matchOrder(incoming("BUY", 1000n, SHARE), book)).toEqual({ fills: [], remainingUnits: SHARE });
  });

  it("a sell above the best bid does not trade", () => {
    const book = [order("b1", "BUY", 999n, SHARE)];
    expect(matchOrder(incoming("SELL", 1000n, SHARE), book)).toEqual({ fills: [], remainingUnits: SHARE });
  });

  it("equal prices do cross (both directions)", () => {
    expect(matchOrder(incoming("BUY", 1000n, SHARE), [order("s", "SELL", 1000n, SHARE)]).fills).toHaveLength(1);
    expect(matchOrder(incoming("SELL", 1000n, SHARE), [order("b", "BUY", 1000n, SHARE)]).fills).toHaveLength(1);
  });

  it("stops at the first level that does not cross", () => {
    const book = [order("s1", "SELL", 1000n, SHARE), order("s2", "SELL", 1010n, SHARE), order("s3", "SELL", 1020n, SHARE)];
    const { fills, remainingUnits } = matchOrder(incoming("BUY", 1010n, 5n * SHARE), book);
    expect(fills.map((f) => f.restingOrderId)).toEqual(["s1", "s2"]);
    expect(remainingUnits).toBe(3n * SHARE);
  });
});

describe("matchOrder: self-trade prevention", () => {
  it("skips the taker's own resting order and trades with the next one", () => {
    const book = [
      order("mine", "SELL", 1000n, SHARE, { userId: "taker", seq: 1 }),
      order("theirs", "SELL", 1005n, SHARE, { userId: "other", seq: 2 }),
    ];
    const { fills, remainingUnits } = matchOrder(incoming("BUY", 1010n, SHARE), book);
    expect(fills).toHaveLength(1);
    expect(fills[0]!.restingOrderId).toBe("theirs");
    expect(fills[0]!.priceCents).toBe(1005n);
    expect(remainingUnits).toBe(0n);
  });

  it("does not trade at all when only the taker's own orders cross", () => {
    const book = [order("mine", "SELL", 1000n, SHARE, { userId: "taker" })];
    expect(matchOrder(incoming("BUY", 1010n, SHARE), book)).toEqual({ fills: [], remainingUnits: SHARE });
  });

  it("skips own bids when selling, too", () => {
    const book = [
      order("mine", "BUY", 1010n, SHARE, { userId: "taker", seq: 1 }),
      order("theirs", "BUY", 1000n, SHARE, { userId: "other", seq: 2 }),
    ];
    const { fills } = matchOrder(incoming("SELL", 990n, 2n * SHARE), book);
    expect(fills.map((f) => f.restingOrderId)).toEqual(["theirs"]);
  });

  it("no fill ever has the taker as counterparty (randomized)", () => {
    const r = prng(4242);
    for (let iter = 0; iter < 300; iter++) {
      const book = Array.from({ length: r.int(0, 12) }, (_, i) =>
        order(`o${i}`, r.next() < 0.5 ? "BUY" : "SELL", r.big(900, 1100), r.big(1, 300) * ORDER_LOT_UNITS, {
          userId: `u${r.int(0, 3)}`,
          seq: i,
        }),
      );
      const taker = incoming(r.next() < 0.5 ? "BUY" : "SELL", r.big(900, 1100), r.big(1, 800) * ORDER_LOT_UNITS, "u0");
      for (const f of matchOrder(taker, book).fills) expect(f.restingUserId).not.toBe("u0");
    }
  });
});

describe("matchOrder: multi-level sweep", () => {
  const book = [
    order("a1", "SELL", 1000n, 1n * SHARE, { seq: 1 }),
    order("a2", "SELL", 1000n, 500_000n, { seq: 2 }),
    order("a3", "SELL", 1010n, 2n * SHARE, { seq: 3 }),
    order("a4", "SELL", 1025n, 3n * SHARE, { seq: 4 }),
    order("a5", "SELL", 1100n, 9n * SHARE, { seq: 5 }),
    order("bid", "BUY", 990n, 9n * SHARE, { seq: 6 }),
  ];

  it("walks the book level by level, each fill at that level's price", () => {
    const { fills, remainingUnits } = matchOrder(incoming("BUY", 1025n, 5n * SHARE), book);
    expect(fills).toEqual([
      { restingOrderId: "a1", restingUserId: "user-a1", priceCents: 1000n, units: 1_000_000n, notionalCents: 1000n },
      { restingOrderId: "a2", restingUserId: "user-a2", priceCents: 1000n, units: 500_000n, notionalCents: 500n },
      { restingOrderId: "a3", restingUserId: "user-a3", priceCents: 1010n, units: 2_000_000n, notionalCents: 2020n },
      { restingOrderId: "a4", restingUserId: "user-a4", priceCents: 1025n, units: 1_500_000n, notionalCents: 1537n },
    ]);
    expect(remainingUnits).toBe(0n);
  });

  it("sweeps everything that crosses and rests the remainder", () => {
    const { fills, remainingUnits } = matchOrder(incoming("BUY", 1025n, 20n * SHARE), book);
    expect(fills.map((f) => f.restingOrderId)).toEqual(["a1", "a2", "a3", "a4"]);
    expect(sum(fills.map((f) => f.units))).toBe(6_500_000n);
    expect(remainingUnits).toBe(13_500_000n);
  });

  it("a sell sweeps bids from the top down", () => {
    const bids = [
      order("b1", "BUY", 1000n, SHARE, { seq: 1 }),
      order("b2", "BUY", 990n, SHARE, { seq: 2 }),
      order("b3", "BUY", 980n, SHARE, { seq: 3 }),
    ];
    const { fills, remainingUnits } = matchOrder(incoming("SELL", 985n, 3n * SHARE), bids);
    expect(fills.map((f) => [f.restingOrderId, f.priceCents])).toEqual([
      ["b1", 1000n],
      ["b2", 990n],
    ]);
    expect(remainingUnits).toBe(SHARE);
  });
});

describe("matchOrder: invariants (randomized)", () => {
  it("conserves units, respects limits, and a buyer's hold always covers the fills", () => {
    const r = prng(90210);
    for (let iter = 0; iter < 1500; iter++) {
      const book = Array.from({ length: r.int(0, 15) }, (_, i) =>
        order(`o${i}`, r.next() < 0.5 ? "BUY" : "SELL", r.big(100, 3000), r.big(1, 500) * ORDER_LOT_UNITS, {
          userId: `u${r.int(1, 6)}`,
          seq: i,
        }),
      );
      const taker = incoming(r.next() < 0.5 ? "BUY" : "SELL", r.big(100, 3000), r.big(1, 2000) * ORDER_LOT_UNITS, "u1");
      const { fills, remainingUnits } = matchOrder(taker, book);
      const filled = sum(fills.map((f) => f.units));

      expect(filled + remainingUnits).toBe(taker.remainingUnits);
      expect(remainingUnits >= 0n).toBe(true);
      expect(new Set(fills.map((f) => f.restingOrderId)).size).toBe(fills.length);

      let prevPrice: bigint | null = null;
      for (const f of fills) {
        const resting = book.find((o) => o.id === f.restingOrderId)!;
        expect(resting.side).not.toBe(taker.side);
        expect(f.units > 0n && f.units <= resting.remainingUnits).toBe(true);
        expect(f.priceCents).toBe(resting.limitPriceCents);
        expect(f.notionalCents).toBe(tradeNotional(f.units, f.priceCents));
        expect(f.notionalCents >= 1n).toBe(true); // lot-sized fills at >= $1 are never free
        if (taker.side === "BUY") {
          expect(f.priceCents <= taker.limitPriceCents).toBe(true);
          if (prevPrice !== null) expect(f.priceCents >= prevPrice).toBe(true);
        } else {
          expect(f.priceCents >= taker.limitPriceCents).toBe(true);
          if (prevPrice !== null) expect(f.priceCents <= prevPrice).toBe(true);
        }
        prevPrice = f.priceCents;
      }

      // If something is left over, nothing else in the book could have been matched.
      if (remainingUnits > 0n) {
        const used = new Set(fills.map((f) => f.restingOrderId));
        const missed = book.filter(
          (o) =>
            o.side !== taker.side &&
            o.userId !== taker.userId &&
            !used.has(o.id) &&
            (taker.side === "BUY" ? o.limitPriceCents <= taker.limitPriceCents : o.limitPriceCents >= taker.limitPriceCents),
        );
        expect(missed).toEqual([]);
      }

      // Cash held when the buy order was placed covers everything it just bought...
      if (taker.side === "BUY") {
        const hold = buyOrderHold(taker.remainingUnits, taker.limitPriceCents);
        const spent = sum(fills.map((f) => f.notionalCents));
        expect(spent <= hold).toBe(true);
        // ...and what is left of the hold still covers the unfilled remainder at the limit.
        expect(hold - spent >= tradeNotional(remainingUnits, taker.limitPriceCents)).toBe(true);
      } else {
        // A resting buyer's hold covers a fill taken out of it by a seller.
        for (const f of fills) {
          const resting = book.find((o) => o.id === f.restingOrderId)!;
          expect(f.notionalCents <= buyOrderHold(resting.remainingUnits, resting.limitPriceCents)).toBe(true);
        }
      }
    }
  });

  it("the smallest order at the lowest allowed price is worth exactly one cent", () => {
    const book = [order("s", "SELL", MIN_ORDER_PRICE_CENTS, ORDER_LOT_UNITS)];
    expect(matchOrder(incoming("BUY", MIN_ORDER_PRICE_CENTS, ORDER_LOT_UNITS), book).fills[0]!.notionalCents).toBe(1n);
  });
});

describe("depth", () => {
  const book = [
    order("s1", "SELL", 1010n, SHARE, { seq: 1 }),
    order("s2", "SELL", 1000n, 500_000n, { seq: 2 }),
    order("s3", "SELL", 1010n, 250_000n, { seq: 3 }),
    order("s4", "SELL", 1000n, 2n * SHARE, { seq: 4 }),
    order("s5", "SELL", 1030n, SHARE, { seq: 5 }),
    order("gone", "SELL", 1000n, 0n, { seq: 6 }),
    order("b1", "BUY", 990n, SHARE, { seq: 7 }),
    order("b2", "BUY", 995n, 3n * SHARE, { seq: 8 }),
    order("b3", "BUY", 990n, 10_000n, { seq: 9 }),
  ];

  it("aggregates asks into price levels, cheapest first", () => {
    expect(depth(book, "SELL")).toEqual([
      { priceCents: 1000n, units: 2_500_000n, orders: 2 },
      { priceCents: 1010n, units: 1_250_000n, orders: 2 },
      { priceCents: 1030n, units: 1_000_000n, orders: 1 },
    ]);
  });

  it("aggregates bids into price levels, highest first", () => {
    expect(depth(book, "BUY")).toEqual([
      { priceCents: 995n, units: 3_000_000n, orders: 1 },
      { priceCents: 990n, units: 1_010_000n, orders: 2 },
    ]);
  });

  it("is empty for an empty side", () => {
    expect(depth([], "BUY")).toEqual([]);
    expect(depth(book.filter((o) => o.side === "SELL"), "BUY")).toEqual([]);
  });

  it("does not mutate the orders it aggregates", () => {
    const before = book.map((o) => o.remainingUnits);
    depth(book, "SELL");
    depth(book, "SELL");
    expect(book.map((o) => o.remainingUnits)).toEqual(before);
  });

  it("level totals equal the live units on that side", () => {
    const live = sum(book.filter((o) => o.side === "SELL").map((o) => o.remainingUnits));
    expect(sum(depth(book, "SELL").map((l) => l.units))).toBe(live);
  });
});
