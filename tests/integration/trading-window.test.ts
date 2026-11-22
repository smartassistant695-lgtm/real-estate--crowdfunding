import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { buyPrimary } from "@/lib/services/purchase";
import { cancelOrder, closeWindow, placeOrder, sellToReserve, syncTradingWindows } from "@/lib/services/trading";
import {
  addAppraisal,
  createProperty,
  createTradingProperty,
  createUser,
  createWindow,
  expectReconciled,
  fund,
  holdingOf,
  key,
  ledgerSum,
  lotsOf,
  resetDb,
  seedReserve,
  sh,
  usd,
  utc,
  walletOf,
  type TestUser,
} from "../helpers/factories";
import { holdLock, lockWaiters, track, waitFor } from "../helpers/locks";

const FUNDED_AT = utc(2025, 1, 10, 12); // lots become sellable 2025-07-10 12:00 (6-month holding period)
const W_OPEN = utc(2025, 8, 1);
const W_CLOSE = utc(2025, 8, 8);
const T = utc(2025, 8, 2, 12);
const at = (minutes: number) => new Date(T.getTime() + minutes * 60_000);

let s1: TestUser, s2: TestUser, s3: TestUser, b1: TestUser, b2: TestUser;
let propertyId: string;
let windowId: string;

beforeEach(async () => {
  await resetDb();
  s1 = await createUser({ name: "Seller 1" });
  s2 = await createUser({ name: "Seller 2" });
  s3 = await createUser({ name: "Seller 3" });
  b1 = await createUser({ name: "Buyer 1", fundCents: usd(10_000) });
  b2 = await createUser({ name: "Buyer 2", fundCents: usd(10_000) });
  const p = await createTradingProperty({ holders: [[s1, 50], [s2, 30], [s3, 20]], fundedAt: FUNDED_AT, navPerShareCents: usd(100) });
  propertyId = p.id;
  windowId = (await createWindow({ opensAt: W_OPEN, closesAt: W_CLOSE })).id;
});
afterAll(async () => {
  await prisma.$disconnect();
});

type Side = "BUY" | "SELL";
const order = (user: TestUser, side: Side, priceCents: bigint, shares: number, now: Date = T, pid?: string) =>
  placeOrder({ userId: user.id, propertyId: pid ?? propertyId, side, limitPriceCents: priceCents, units: sh(shares), idempotencyKey: key("ord"), now });

describe("trading windows", () => {
  it("rejects orders when no window is open", async () => {
    await prisma.tradingWindow.deleteMany();
    await expect(order(s1, "SELL", usd(100), 1)).rejects.toThrow(/trading window is closed/);

    // A scheduled (not yet opened) window covering now does not count.
    await createWindow({ opensAt: W_OPEN, closesAt: W_CLOSE, status: "SCHEDULED" });
    await expect(order(b1, "BUY", usd(100), 1)).rejects.toThrow(/trading window is closed/);
    // A window for a different property does not count.
    const other = await createProperty({ status: "TRADING" });
    await createWindow({ opensAt: W_OPEN, closesAt: W_CLOSE, propertyId: other.id });
    await expect(order(b1, "BUY", usd(100), 1)).rejects.toThrow(/trading window is closed/);
    // An open window, but outside its hours.
    await createWindow({ opensAt: W_OPEN, closesAt: W_CLOSE, propertyId });
    await expect(order(b1, "BUY", usd(100), 1, W_CLOSE)).rejects.toThrow(/trading window is closed/);
    await expect(order(b1, "BUY", usd(100), 1, new Date(W_OPEN.getTime() - 1))).rejects.toThrow(/trading window is closed/);
    // Inside the window for this property it works.
    await expect(order(b1, "BUY", usd(100), 1, W_OPEN)).resolves.toMatchObject({ status: "OPEN" });

    expect(await prisma.order.count()).toBe(1);
    expect(await walletOf(b1.id)).toEqual({ availableCents: usd(9900), heldCents: usd(100) });
    await expectReconciled();
  });

  it("rejects orders from users who cannot trade, and on properties that are not trading", async () => {
    const noDisclosure = await createUser({ tradingDisclosure: false, fundCents: usd(1000) });
    const noKyc = await createUser({ kycStatus: "PENDING", fundCents: usd(1000) });
    await expect(order(noDisclosure, "BUY", usd(100), 1)).rejects.toThrow(/trading disclosure/);
    await expect(order(noKyc, "BUY", usd(100), 1)).rejects.toThrow(/identity check/);
    const funded = await createTradingProperty({ holders: [[s1, 5]], fundedAt: FUNDED_AT, status: "FUNDED" });
    await expect(order(s1, "SELL", usd(100), 1, T, funded.id)).rejects.toThrow(/not trading right now/);
    await expect(order(b1, "BUY", usd(100), 0.005)).rejects.toThrow(/steps of 0\.01 share/);
    await expect(order(b1, "BUY", usd(100), 0)).rejects.toThrow(/steps of 0\.01 share/);
    await expect(order(b1, "BUY", usd(1000), 10_000)).rejects.toThrow();
    expect(await prisma.order.count()).toBe(0);
    await expectReconciled();
  });

  it("the holding period blocks selling lots younger than six months", async () => {
    await prisma.tradingWindow.deleteMany();
    await createWindow({ opensAt: utc(2025, 7, 1), closesAt: utc(2025, 8, 31) });
    const sellableAt = utc(2025, 7, 10, 12);

    await expect(order(s1, "SELL", usd(100), 1, new Date(sellableAt.getTime() - 60_000))).rejects.toThrow(/You can sell up to 0(\.0+)? shares/);
    await expect(order(s1, "SELL", usd(100), 1, sellableAt)).resolves.toMatchObject({ status: "OPEN" });

    // s1 buys 10 more on 2 August: those new units are not sellable until February.
    await fund(s1.id, usd(1000));
    await order(s2, "SELL", usd(100), 10, at(0));
    await order(s1, "BUY", usd(100), 10, at(1));
    expect((await holdingOf(s1.id, propertyId)).shareUnits).toBe(sh(60));
    // 50 old units, 1 already in an open sell order → 49 more sellable; the 10 new ones are not.
    await expect(order(s1, "SELL", usd(100), 50, at(2))).rejects.toThrow(/You can sell up to 49 shares/);
    await expect(order(s1, "SELL", usd(100), 49, at(2))).resolves.toMatchObject({ status: "OPEN" });
    expect(await holdingOf(s1.id, propertyId)).toMatchObject({ shareUnits: sh(60), reservedUnits: sh(50) });
    await expectReconciled();
  });

  it("the circuit breaker rejects prices outside ±25% of the appraised value", async () => {
    await expect(order(s1, "SELL", usd(74.99), 1)).rejects.toThrow(/between \$75\.00 and \$125\.00/);
    await expect(order(b1, "BUY", usd(125.01), 1)).rejects.toThrow(/between \$75\.00 and \$125\.00/);
    await expect(order(b1, "BUY", 99n, 1)).rejects.toThrow(/lowest price/);
    await expect(order(s1, "SELL", usd(75), 1)).resolves.toMatchObject({ status: "OPEN" });
    await expect(order(b1, "BUY", usd(125), 2)).resolves.toMatchObject({ status: "PARTIALLY_FILLED" });

    // The newest appraisal sets the band.
    await addAppraisal(propertyId, usd(200), utc(2025, 8, 1));
    await expect(order(b2, "BUY", usd(125), 1)).rejects.toThrow(/between \$150\.00 and \$250\.00/);

    // No appraisal at all: no trading.
    const unappraised = await createTradingProperty({ holders: [[s1, 5]], fundedAt: FUNDED_AT, navPerShareCents: null });
    await expect(order(s1, "SELL", usd(100), 1, T, unappraised.id)).rejects.toThrow(/no appraisal yet/);
    await expectReconciled();
  });

  it("matches by price-time priority with partial fills and price improvement", async () => {
    const sell1 = await order(s1, "SELL", usd(101), 10, at(0));
    const sell2 = await order(s2, "SELL", usd(100), 10, at(1));
    const sell3 = await order(s3, "SELL", usd(100), 10, at(2));
    expect(await holdingOf(s1.id, propertyId)).toMatchObject({ shareUnits: sh(50), reservedUnits: sh(10) });

    // Wants 25 at up to $101: takes s2 (best price, earlier), then s3, then 5 of s1.
    const buy = await order(b1, "BUY", usd(101), 25, at(3));
    expect(buy).toMatchObject({ status: "FILLED", filledUnits: sh(25), replayed: false });

    const trades = await prisma.trade.findMany({ orderBy: { id: "asc" } });
    const byOrder = new Map(trades.map((t) => [t.sellOrderId, t]));
    expect(byOrder.get(sell2.orderId)).toMatchObject({ sellerId: s2.id, buyerId: b1.id, priceCents: usd(100), shareUnits: sh(10), notionalCents: usd(1000), isBuyback: false });
    expect(byOrder.get(sell3.orderId)).toMatchObject({ sellerId: s3.id, priceCents: usd(100), shareUnits: sh(10), notionalCents: usd(1000) });
    expect(byOrder.get(sell1.orderId)).toMatchObject({ sellerId: s1.id, priceCents: usd(101), shareUnits: sh(5), notionalCents: usd(505) });
    expect(trades).toHaveLength(3);

    // Buyer: held $2,525 at the limit, paid $2,505, the $20 improvement went back to available.
    expect(await walletOf(b1.id)).toEqual({ availableCents: usd(10_000 - 2505), heldCents: 0n });
    const buyRow = await prisma.order.findUniqueOrThrow({ where: { id: buy.orderId } });
    expect(buyRow).toMatchObject({ status: "FILLED", heldCents: 0n });
    expect(await holdingOf(b1.id, propertyId)).toEqual({ shareUnits: sh(25), reservedUnits: 0n, costBasisCents: usd(2505) });
    const b1Lots = await lotsOf(b1.id, propertyId);
    expect(b1Lots.map((l) => [l.source, l.remainingUnits, l.costBasisCents]).sort()).toEqual(
      [["TRADE", sh(10), usd(1000)], ["TRADE", sh(10), usd(1000)], ["TRADE", sh(5), usd(505)]].sort(),
    );

    // Sellers: cash in full; shares leave their lots; s1 still has 5 reserved in a part-filled order.
    expect((await walletOf(s1.id)).availableCents).toBe(usd(505));
    expect((await walletOf(s2.id)).availableCents).toBe(usd(1000));
    expect(await holdingOf(s1.id, propertyId)).toEqual({ shareUnits: sh(45), reservedUnits: sh(5), costBasisCents: usd(4500) });
    expect(await holdingOf(s2.id, propertyId)).toEqual({ shareUnits: sh(20), reservedUnits: 0n, costBasisCents: usd(2000) });
    expect((await lotsOf(s1.id, propertyId))[0]).toMatchObject({ remainingUnits: sh(45), costBasisCents: usd(4500) });
    const s1Order = await prisma.order.findUniqueOrThrow({ where: { id: sell1.orderId } });
    expect(s1Order).toMatchObject({ status: "PARTIALLY_FILLED", filledUnits: sh(5), closedAt: null });
    for (const id of [sell2.orderId, sell3.orderId]) expect((await prisma.order.findUniqueOrThrow({ where: { id } })).status).toBe("FILLED");

    const p = await prisma.property.findUniqueOrThrow({ where: { id: propertyId } });
    expect(p.lastTradePriceCents).toBe(usd(101));
    expect(await ledgerSum({ type: { in: ["TRADE_BUY", "TRADE_SELL"] } })).toBe(0n);
    await expectReconciled();
  });

  it("a resting buy is filled at its own price, and its hold shrinks with each partial fill", async () => {
    const buy = await order(b1, "BUY", usd(110), 10, at(0));
    expect(await walletOf(b1.id)).toEqual({ availableCents: usd(8900), heldCents: usd(1100) });

    // A seller asking less is paid the resting bid ($110): the earlier order sets the price.
    await order(s1, "SELL", usd(105), 4, at(1));
    expect((await walletOf(s1.id)).availableCents).toBe(usd(440));
    expect(await walletOf(b1.id)).toEqual({ availableCents: usd(8900), heldCents: usd(660) });
    expect(await prisma.order.findUniqueOrThrow({ where: { id: buy.orderId } })).toMatchObject({ status: "PARTIALLY_FILLED", filledUnits: sh(4), heldCents: usd(660) });

    // Fractional fill: 0.37 share at $110 = $40.70 exactly.
    await order(s2, "SELL", usd(110), 0.37, at(2));
    expect(await walletOf(b1.id)).toEqual({ availableCents: usd(8900), heldCents: usd(660 - 40.7) });

    // Cancelling the rest releases what is still held.
    const cancelled = await cancelOrder({ userId: b1.id, orderId: buy.orderId });
    expect(cancelled).toMatchObject({ status: "CANCELLED", heldCents: 0n, filledUnits: sh(4.37) });
    expect(await walletOf(b1.id)).toEqual({ availableCents: usd(10_000 - 440 - 40.7), heldCents: 0n });
    expect((await holdingOf(b1.id, propertyId)).shareUnits).toBe(sh(4.37));
    await expectReconciled();
  });

  it("cancelling a sell releases reserved shares; only the owner can cancel, and only once", async () => {
    const sell = await order(s1, "SELL", usd(100), 10);
    expect((await holdingOf(s1.id, propertyId)).reservedUnits).toBe(sh(10));

    await expect(cancelOrder({ userId: s2.id, orderId: sell.orderId })).rejects.toThrow(/Order not found/);
    const res = await cancelOrder({ userId: s1.id, orderId: sell.orderId });
    expect(res.status).toBe("CANCELLED");
    expect(res.closedAt).toBeInstanceOf(Date);
    expect(await holdingOf(s1.id, propertyId)).toMatchObject({ shareUnits: sh(50), reservedUnits: 0n });
    await expect(cancelOrder({ userId: s1.id, orderId: sell.orderId })).rejects.toThrow(/already closed/);

    // A cancelled order no longer matches.
    const buy = await order(b1, "BUY", usd(100), 10, at(1));
    expect(buy.status).toBe("OPEN");
    expect(await prisma.trade.count()).toBe(0);
    await expectReconciled();
  });

  it("closing the window expires open orders and releases cash and shares", async () => {
    const restingBuy = await order(b1, "BUY", usd(90), 10, at(0));
    const restingSell = await order(s1, "SELL", usd(110), 10, at(1));
    const partBuy = await order(b2, "BUY", usd(100), 10, at(2));
    await order(s2, "SELL", usd(100), 4, at(3)); // fills 4 of b2's 10
    const filled = await order(s3, "SELL", usd(95), 1, at(4)); // fills against b2 at $100

    expect(await walletOf(b1.id)).toEqual({ availableCents: usd(9100), heldCents: usd(900) });
    expect(await walletOf(b2.id)).toEqual({ availableCents: usd(9000), heldCents: usd(500) });

    await closeWindow(windowId, null, W_CLOSE);

    for (const id of [restingBuy.orderId, restingSell.orderId, partBuy.orderId]) {
      expect(await prisma.order.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: "EXPIRED", heldCents: 0n, closedAt: W_CLOSE });
    }
    expect((await prisma.order.findUniqueOrThrow({ where: { id: filled.orderId } })).status).toBe("FILLED");
    expect(await walletOf(b1.id)).toEqual({ availableCents: usd(10_000), heldCents: 0n });
    expect(await walletOf(b2.id)).toEqual({ availableCents: usd(9500), heldCents: 0n });
    expect(await holdingOf(s1.id, propertyId)).toMatchObject({ shareUnits: sh(50), reservedUnits: 0n });
    expect(await holdingOf(b2.id, propertyId)).toMatchObject({ shareUnits: sh(5), reservedUnits: 0n });
    expect(await prisma.tradingWindow.findUniqueOrThrow({ where: { id: windowId } })).toMatchObject({ status: "CLOSED" });
    expect(await prisma.notification.count({ where: { type: "ORDER_EXPIRED" } })).toBe(3);

    await expect(order(b1, "BUY", usd(100), 1, at(5))).rejects.toThrow(/trading window is closed/);
    await expect(closeWindow(windowId, null, W_CLOSE)).rejects.toThrow(/Only an open window/);
    await expectReconciled();
  });

  it("closing a window early ends it at that moment", async () => {
    await order(b1, "BUY", usd(90), 10, at(0));
    await closeWindow(windowId, null, at(10));
    expect((await prisma.tradingWindow.findUniqueOrThrow({ where: { id: windowId } })).closesAt).toEqual(at(10));
    expect(await walletOf(b1.id)).toEqual({ availableCents: usd(10_000), heldCents: 0n });
    await expectReconciled();
  });

  it("a user's own orders never match each other", async () => {
    await fund(s1.id, usd(5000));
    const own = await order(s1, "SELL", usd(100), 10, at(0));
    const other = await order(s2, "SELL", usd(100), 10, at(1));

    // s1 bids at the price of its own (earlier) ask: it skips its own and takes s2's.
    const buy = await order(s1, "BUY", usd(100), 10, at(2));
    expect(buy).toMatchObject({ status: "FILLED" });
    const trades = await prisma.trade.findMany();
    expect(trades).toHaveLength(1);
    expect(trades[0]).toMatchObject({ sellOrderId: other.orderId, sellerId: s2.id, buyerId: s1.id });
    expect((await prisma.order.findUniqueOrThrow({ where: { id: own.orderId } })).status).toBe("OPEN");

    // Nothing else to match: a second bid from s1 rests next to its own ask.
    const rest = await order(s1, "BUY", usd(100), 5, at(3));
    expect(rest.status).toBe("OPEN");
    expect(await prisma.trade.count()).toBe(1);

    // Another user can take s1's ask.
    await order(b1, "BUY", usd(100), 10, at(4));
    expect((await prisma.order.findUniqueOrThrow({ where: { id: own.orderId } })).status).toBe("FILLED");
    await expectReconciled();
  });

  it("an order placed twice with the same key is placed once", async () => {
    const k = key();
    const input = { userId: b1.id, propertyId, side: "BUY" as const, limitPriceCents: usd(100), units: sh(5), idempotencyKey: k, now: T };
    const [a, b] = await Promise.all([placeOrder(input), placeOrder(input)]);
    expect(a.orderId).toBe(b.orderId);
    expect([a.replayed, b.replayed].sort()).toEqual([false, true]);
    expect(await prisma.order.count()).toBe(1);
    expect(await walletOf(b1.id)).toEqual({ availableCents: usd(9500), heldCents: usd(500) });
    await expectReconciled();
  });

  it("many concurrent buyers never take more than a sell order offers, and no wallet goes negative", async () => {
    const sell = await order(s1, "SELL", usd(100), 20, at(0));
    const buyers = await Promise.all(Array.from({ length: 8 }, () => createUser({ fundCents: usd(500) })));

    // 8 × 5 shares wanted, 20 on offer.
    const settled = await Promise.allSettled(buyers.map((u, i) => order(u, "BUY", usd(100), 5, at(1 + i))));
    expect(settled.every((s) => s.status === "fulfilled")).toBe(true);

    expect(await prisma.order.findUniqueOrThrow({ where: { id: sell.orderId } })).toMatchObject({ status: "FILLED", filledUnits: sh(20) });
    expect((await prisma.trade.aggregate({ _sum: { shareUnits: true } }))._sum.shareUnits).toBe(sh(20));
    expect(await holdingOf(s1.id, propertyId)).toMatchObject({ shareUnits: sh(30), reservedUnits: 0n });
    const filledBuyers = await prisma.order.count({ where: { side: "BUY", status: "FILLED" } });
    const restingBuyers = await prisma.order.count({ where: { side: "BUY", status: "OPEN" } });
    expect([filledBuyers, restingBuyers]).toEqual([4, 4]);
    for (const u of buyers) {
      const w = await walletOf(u.id);
      expect(w.availableCents + w.heldCents).toBe(usd(500) - (await holdingOf(u.id, propertyId)).costBasisCents);
    }
    await expectReconciled();
  });

  describe("sell to the liquidity reserve", () => {
    it("pays the appraised value less 5%, within the monthly cap and the reserve's cash, and retires the shares", async () => {
      // Funding created the reserve, empty.
      await expect(sellToReserve({ userId: s1.id, propertyId, units: sh(1), idempotencyKey: key(), now: T })).rejects.toThrow(/no buyback budget left/);
      await seedReserve(propertyId, usd(3000));

      const first = await sellToReserve({ userId: s1.id, propertyId, units: sh(10), idempotencyKey: key(), now: T });
      expect(first).toMatchObject({ proceedsCents: usd(950), replayed: false }); // $95/share
      expect((await walletOf(s1.id)).availableCents).toBe(usd(950));
      expect(await holdingOf(s1.id, propertyId)).toEqual({ shareUnits: sh(40), reservedUnits: 0n, costBasisCents: usd(4000) });
      const trade = await prisma.trade.findUniqueOrThrow({ where: { id: first.tradeId } });
      expect(trade).toMatchObject({ isBuyback: true, buyerId: null, buyOrderId: null, sellOrderId: null, priceCents: usd(95), shareUnits: sh(10), notionalCents: usd(950) });

      // $2,000 monthly cap: $1,050 left → at most 11.052631 shares (shown truncated to 11.0526).
      await expect(sellToReserve({ userId: s2.id, propertyId, units: sh(12), idempotencyKey: key(), now: at(1) })).rejects.toThrow(/can buy up to 11\.0526 shares \(\$1,050\.00\)/);
      await sellToReserve({ userId: s2.id, propertyId, units: sh(11), idempotencyKey: key(), now: at(2) });
      await expect(sellToReserve({ userId: s3.id, propertyId, units: sh(1), idempotencyKey: key(), now: at(3) })).rejects.toThrow(/can buy up to 0\.0526 shares/);

      let reserve = await prisma.liquidityReserve.findUniqueOrThrow({ where: { propertyId } });
      expect(reserve).toMatchObject({ balanceCents: usd(3000 - 950 - 1045), usedThisMonthCents: usd(1995), usagePeriod: "2025-08" });

      // Next month the cap resets, but the reserve only has $1,005 left.
      await createWindow({ opensAt: utc(2025, 9, 1), closesAt: utc(2025, 9, 8) });
      const sept = utc(2025, 9, 2);
      await expect(sellToReserve({ userId: s3.id, propertyId, units: sh(11), idempotencyKey: key(), now: sept })).rejects.toThrow(/can buy up to 10\.5789 shares \(\$1,005\.00\)/);
      await sellToReserve({ userId: s3.id, propertyId, units: sh(10), idempotencyKey: key(), now: sept });
      reserve = await prisma.liquidityReserve.findUniqueOrThrow({ where: { propertyId } });
      expect(reserve).toMatchObject({ balanceCents: usd(55), usedThisMonthCents: usd(950), usagePeriod: "2025-09" });

      const p = await prisma.property.findUniqueOrThrow({ where: { id: propertyId } });
      expect(p.retiredUnits).toBe(sh(31));
      expect(p.soldUnits).toBe(sh(100));
      expect(await ledgerSum({ account: "LIQUIDITY_RESERVE", propertyId })).toBe(usd(55));
      expect(await ledgerSum({ type: "BUYBACK_SALE", account: "USER_WALLET" })).toBe(usd(2945));
      await expectReconciled();
    });

    it("respects the holding period, reserved shares, the open window, and idempotency", async () => {
      await seedReserve(propertyId, usd(3000));
      await prisma.tradingWindow.deleteMany();
      await createWindow({ opensAt: utc(2025, 7, 1), closesAt: utc(2025, 8, 31) });

      await expect(sellToReserve({ userId: s1.id, propertyId, units: sh(1), idempotencyKey: key(), now: utc(2025, 7, 9) })).rejects.toThrow(/sell up to 0/);
      await order(s3, "SELL", usd(110), 15, T);
      await expect(sellToReserve({ userId: s3.id, propertyId, units: sh(6), idempotencyKey: key(), now: T })).rejects.toThrow(/sell up to 5 shares/);

      const k = key();
      const r1 = await sellToReserve({ userId: s3.id, propertyId, units: sh(5), idempotencyKey: k, now: T });
      const r2 = await sellToReserve({ userId: s3.id, propertyId, units: sh(5), idempotencyKey: k, now: T });
      expect(r2).toEqual({ ...r1, replayed: true });
      expect((await walletOf(s3.id)).availableCents).toBe(usd(475));
      expect((await prisma.property.findUniqueOrThrow({ where: { id: propertyId } })).retiredUnits).toBe(sh(5));

      await expect(sellToReserve({ userId: s1.id, propertyId, units: sh(1), idempotencyKey: key(), now: utc(2025, 9, 1) })).rejects.toThrow(/trading window is closed/);
      await expectReconciled();
    });
  });

  it("syncTradingWindows schedules, opens and closes windows", async () => {
    await prisma.tradingWindow.deleteMany();
    // A window the cron missed entirely (it was down all of July).
    const missed = await createWindow({ opensAt: utc(2025, 7, 1), closesAt: utc(2025, 7, 8), status: "SCHEDULED" });

    const aug1 = utc(2025, 8, 1, 0, 1);
    expect(await syncTradingWindows(aug1)).toEqual({ scheduled: 2, opened: 1, closed: 0 });
    const windows = await prisma.tradingWindow.findMany({ where: { propertyId: null, id: { not: missed.id } }, orderBy: { opensAt: "asc" } });
    expect(windows.map((w) => [w.opensAt, w.closesAt, w.status])).toEqual([
      [utc(2025, 8, 1), utc(2025, 8, 8), "OPEN"],
      [utc(2025, 9, 1), utc(2025, 9, 8), "SCHEDULED"],
    ]);
    expect((await prisma.tradingWindow.findUniqueOrThrow({ where: { id: missed.id } })).status).toBe("CLOSED");
    expect(await prisma.notification.count({ where: { type: "WINDOW_OPENED" } })).toBe(3);

    // Running again changes nothing.
    expect(await syncTradingWindows(new Date(aug1.getTime() + 60_000))).toEqual({ scheduled: 0, opened: 0, closed: 0 });
    expect(await prisma.tradingWindow.count()).toBe(3);

    // Orders work in the window the job opened.
    const resting = await order(b1, "BUY", usd(95), 10, utc(2025, 8, 3));
    expect(resting.status).toBe("OPEN");

    // At the close time the job closes the window and expires the order.
    expect(await syncTradingWindows(utc(2025, 8, 8))).toEqual({ scheduled: 0, opened: 0, closed: 1 });
    expect((await prisma.order.findUniqueOrThrow({ where: { id: resting.orderId } })).status).toBe("EXPIRED");
    expect(await walletOf(b1.id)).toEqual({ availableCents: usd(10_000), heldCents: 0n });
    await expect(order(b1, "BUY", usd(95), 1, utc(2025, 8, 8, 1))).rejects.toThrow(/trading window is closed/);

    // September: opens the scheduled window and schedules October.
    expect(await syncTradingWindows(utc(2025, 9, 1, 0, 5))).toEqual({ scheduled: 1, opened: 1, closed: 0 });
    expect(await prisma.tradingWindow.count({ where: { status: "OPEN" } })).toBe(1);
    await expectReconciled();
  });

  // ---------- known issues (fixed in src; these guard against regressions) ----------

  it("cash held in open buy orders counts toward the annual investment limit", async () => {
    const capped = await createUser({ annualLimitCents: usd(1000), fundCents: usd(5000) });
    await order(capped, "BUY", usd(100), 6, at(0)); // rests, holding $600
    expect(await walletOf(capped.id)).toEqual({ availableCents: usd(4400), heldCents: usd(600) });

    // Another $500 order would take committed cash to $1,100.
    await expect(order(capped, "BUY", usd(100), 5, at(1))).rejects.toThrow(/annual investment limit/);
    await expect(order(capped, "BUY", usd(100), 4, at(1))).resolves.toMatchObject({ status: "OPEN" });

    // The same applies to buying in an offering.
    const offering = await createProperty();
    await expect(buyPrimary({ userId: capped.id, propertyId: offering.id, amountCents: usd(26), idempotencyKey: key(), now: at(2) })).rejects.toThrow(/You can invest \$0\.00 more/);
    expect(await walletOf(capped.id)).toEqual({ availableCents: usd(4000), heldCents: usd(1000) });
    await expectReconciled();
  });

  it("resting orders priced outside the current circuit-breaker band do not fill", async () => {
    const stale = await order(s1, "SELL", usd(76), 10, at(0)); // within ±25% of $100
    await addAppraisal(propertyId, usd(120), utc(2025, 8, 2)); // band is now $90–$150

    const buy = await order(b1, "BUY", usd(100), 10, at(1));
    expect(buy).toMatchObject({ status: "OPEN", filledUnits: 0n });
    expect(await prisma.trade.count()).toBe(0);
    expect(await prisma.order.findUniqueOrThrow({ where: { id: stale.orderId } })).toMatchObject({ status: "OPEN", filledUnits: 0n });
    expect(await holdingOf(s1.id, propertyId)).toMatchObject({ shareUnits: sh(50), reservedUnits: sh(10) });

    // A seller inside the band still trades with the buyer.
    await order(s2, "SELL", usd(95), 10, at(2));
    expect((await prisma.order.findUniqueOrThrow({ where: { id: buy.orderId } })).status).toBe("FILLED");
    expect((await prisma.trade.findFirstOrThrow()).priceCents).toBe(usd(100));
    await expectReconciled();
  });

  it("an order cannot land in a window that is being closed (placeOrder / closeWindow race)", async () => {
    // Hold b1's wallet lock so placeOrder stops after it has seen the window open.
    const lock = await holdLock((tx) => tx.$queryRaw`SELECT "id" FROM "Wallet" WHERE "userId" = ${b1.id} FOR UPDATE`);
    let released = false;
    try {
      const placing = track(order(b1, "BUY", usd(100), 3, at(0)).catch((e: unknown) => e));
      await waitFor(async () => (await lockWaiters()) >= 1, 5_000, "placeOrder to block on the wallet lock");

      // Close the window while the order is in flight.
      const closing = track(closeWindow(windowId, null, at(1)).catch((e: unknown) => e));
      await waitFor(async () => closing.settled() || (await lockWaiters()) >= 2, 5_000, "closeWindow to finish or queue");

      await lock.release();
      released = true;
      const [placed, closed] = await Promise.all([placing.promise, closing.promise]);
      expect(closed).toBeUndefined(); // closeWindow succeeded
      void placed; // either outcome is fine: refused, or accepted and then expired by the close

      expect((await prisma.tradingWindow.findUniqueOrThrow({ where: { id: windowId } })).status).toBe("CLOSED");
      expect(await prisma.order.count({ where: { windowId, status: { in: ["OPEN", "PARTIALLY_FILLED"] } } })).toBe(0);
      expect(await walletOf(b1.id)).toEqual({ availableCents: usd(10_000), heldCents: 0n });
      await expectReconciled();
    } finally {
      if (!released) await lock.release();
    }
  });
});
