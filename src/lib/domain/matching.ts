import { tradeNotional } from "./money";

export type BookOrder = {
  id: string;
  userId: string;
  side: "BUY" | "SELL";
  limitPriceCents: bigint;
  remainingUnits: bigint;
  /** Lower = earlier. Breaks ties between orders at the same price. */
  seq: number;
};

export type Fill = {
  restingOrderId: string;
  restingUserId: string;
  /** Always the resting order's price: whoever was in the book first sets the price. */
  priceCents: bigint;
  units: bigint;
  notionalCents: bigint;
};

/** Best price first, then earliest. For a buyer the best ask is the lowest; for a seller the best bid is the highest. */
export function sortBook(orders: readonly BookOrder[], side: "BUY" | "SELL"): BookOrder[] {
  return orders
    .filter((o) => o.side === side && o.remainingUnits > 0n)
    .sort((a, b) => {
      if (a.limitPriceCents !== b.limitPriceCents) {
        const asc = a.limitPriceCents < b.limitPriceCents ? -1 : 1;
        return side === "SELL" ? asc : -asc;
      }
      return a.seq - b.seq;
    });
}

/**
 * Match an incoming limit order against the resting book using price-time priority.
 * Pure: returns the fills and what is left; the caller persists them.
 *  - A buy matches asks priced at or below its limit, cheapest first.
 *  - A sell matches bids priced at or above its limit, highest first.
 *  - Orders from the same user never match each other (no wash trades); they are skipped.
 */
export function matchOrder(
  incoming: BookOrder,
  book: readonly BookOrder[],
): { fills: Fill[]; remainingUnits: bigint } {
  const opposite = sortBook(book, incoming.side === "BUY" ? "SELL" : "BUY");
  const fills: Fill[] = [];
  let remaining = incoming.remainingUnits;
  for (const resting of opposite) {
    if (remaining === 0n) break;
    const crosses =
      incoming.side === "BUY"
        ? resting.limitPriceCents <= incoming.limitPriceCents
        : resting.limitPriceCents >= incoming.limitPriceCents;
    if (!crosses) break; // book is sorted: nothing further can cross
    if (resting.userId === incoming.userId) continue;
    const units = remaining < resting.remainingUnits ? remaining : resting.remainingUnits;
    fills.push({
      restingOrderId: resting.id,
      restingUserId: resting.userId,
      priceCents: resting.limitPriceCents,
      units,
      notionalCents: tradeNotional(units, resting.limitPriceCents),
    });
    remaining -= units;
  }
  return { fills, remainingUnits: remaining };
}

export type DepthLevel = { priceCents: bigint; units: bigint; orders: number };

/** Aggregate one side of the book into price levels, best price first. */
export function depth(orders: readonly BookOrder[], side: "BUY" | "SELL"): DepthLevel[] {
  const levels: DepthLevel[] = [];
  for (const o of sortBook(orders, side)) {
    const last = levels[levels.length - 1];
    if (last && last.priceCents === o.limitPriceCents) {
      last.units += o.remainingUnits;
      last.orders += 1;
    } else levels.push({ priceCents: o.limitPriceCents, units: o.remainingUnits, orders: 1 });
  }
  return levels;
}
