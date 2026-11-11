import "server-only";
import type { Order, TradingWindow } from "@prisma/client";
import { claimIdempotencyKey, DomainError, lockProperty, lockWallets, prisma, runTx, storeIdempotentResult, type Tx } from "@/lib/db";
import { consumeLotsFifo, sellableUnits } from "@/lib/domain/holding";
import { matchOrder, type BookOrder } from "@/lib/domain/matching";
import { buyOrderHold, formatCents, formatUnits, MIN_ORDER_PRICE_CENTS, ORDER_LOT_UNITS } from "@/lib/domain/money";
import { circuitBreakerBand, monthKey, quoteBuyback, windowForMonth } from "@/lib/domain/trading-rules";
import { providers, type TradingVenueProvider } from "@/lib/providers";
import { getSettings } from "@/lib/settings";
import { audit } from "./audit";
import { postLedger } from "./ledger";
import { notify, type Notice } from "./notifications";
import { investedThisYear } from "./wallet";

const LIVE = ["OPEN", "PARTIALLY_FILLED"] as const;

/** The open trading window that covers this property right now, if any. */
export async function openWindowFor(tx: Tx | typeof prisma, propertyId: string, now = new Date()): Promise<TradingWindow | null> {
  return tx.tradingWindow.findFirst({
    where: { status: "OPEN", opensAt: { lte: now }, closesAt: { gt: now }, OR: [{ propertyId }, { propertyId: null }] },
    orderBy: { closesAt: "asc" },
  });
}

export async function nextWindowFor(tx: Tx | typeof prisma, propertyId: string, now = new Date()): Promise<TradingWindow | null> {
  return tx.tradingWindow.findFirst({
    where: { status: "SCHEDULED", closesAt: { gt: now }, OR: [{ propertyId }, { propertyId: null }] },
    orderBy: { opensAt: "asc" },
  });
}

export async function latestAppraisal(tx: Tx | typeof prisma, propertyId: string) {
  return tx.appraisal.findFirst({ where: { propertyId }, orderBy: [{ effectiveDate: "desc" }, { createdAt: "desc" }] });
}

function toBook(o: Order): BookOrder {
  return { id: o.id, userId: o.userId, side: o.side, limitPriceCents: o.limitPriceCents, remainingUnits: o.shareUnits - o.filledUnits, seq: o.seq };
}

export type PlaceOrderInput = {
  userId: string;
  propertyId: string;
  side: "BUY" | "SELL";
  limitPriceCents: bigint;
  units: bigint;
  idempotencyKey: string;
  ipAddress?: string | null;
  now?: Date;
};

/**
 * Place a limit order and match it immediately against the book (price-time priority).
 * One transaction: the property row lock serialises the whole book for that property, and all
 * wallets involved are locked together in a fixed order before any balance changes.
 */
export async function placeOrder(input: PlaceOrderInput): Promise<{ orderId: string; filledUnits: bigint; status: string; replayed: boolean }> {
  const now = input.now ?? new Date();
  let afterCommit: (() => Promise<void>) | undefined;
  const transfers: { from: string; to: string; units: bigint; ref: string }[] = [];

  const result = await runTx(async (tx) => {
    const replay = (await claimIdempotencyKey(tx, input.idempotencyKey, input.userId, "placeOrder")) as { orderId: string; filledUnits: string; status: string } | null;
    if (replay) return { orderId: replay.orderId, filledUnits: BigInt(replay.filledUnits), status: replay.status, replayed: true };

    const settings = await getSettings(tx);
    const property = await lockProperty(tx, input.propertyId);
    const user = await tx.user.findUniqueOrThrow({ where: { id: input.userId } });

    if (user.kycStatus !== "APPROVED") throw new DomainError("Your identity check must be approved before you can trade.");
    if (!user.tradingDisclosureAcceptedAt) throw new DomainError("Please read and accept the trading disclosure first.");
    if (property.status !== "TRADING") throw new DomainError("Shares of this property are not trading right now.");
    const window = await openWindowFor(tx, property.id, now);
    if (!window) throw new DomainError("The trading window is closed. Orders can only be placed while a window is open.");

    if (input.units <= 0n || input.units % ORDER_LOT_UNITS !== 0n) throw new DomainError("Enter a quantity in steps of 0.01 share.", "shares");
    if (input.limitPriceCents < MIN_ORDER_PRICE_CENTS) throw new DomainError(`The lowest price you can set is ${formatCents(MIN_ORDER_PRICE_CENTS)}.`, "price");
    const appraisal = await latestAppraisal(tx, property.id);
    if (!appraisal) throw new DomainError("This property has no appraisal yet, so it cannot trade.");
    const band = circuitBreakerBand(appraisal.navPerShareCents, settings.circuitBreakerBps);
    if (input.limitPriceCents < band.minCents || input.limitPriceCents > band.maxCents) {
      throw new DomainError(
        `Your price must be between ${formatCents(band.minCents)} and ${formatCents(band.maxCents)}: within ${settings.circuitBreakerBps / 100}% of the appraised value of ${formatCents(appraisal.navPerShareCents)} per share.`,
        "price",
      );
    }

    // Work out the matches first (read-only), so we know every wallet to lock.
    const resting = await tx.order.findMany({
      where: { propertyId: property.id, windowId: window.id, side: input.side === "BUY" ? "SELL" : "BUY", status: { in: [...LIVE] } },
    });
    const incomingBook: BookOrder = { id: "incoming", userId: input.userId, side: input.side, limitPriceCents: input.limitPriceCents, remainingUnits: input.units, seq: Number.MAX_SAFE_INTEGER };
    const { fills } = matchOrder(incomingBook, resting.map(toBook));
    const wallets = await lockWallets(tx, [input.userId, ...fills.map((f) => f.restingUserId)]);

    let heldCents = 0n;
    if (input.side === "BUY") {
      heldCents = buyOrderHold(input.units, input.limitPriceCents);
      const invested = await investedThisYear(tx, input.userId, now);
      if (invested + heldCents > user.annualInvestmentLimitCents) {
        throw new DomainError(`This order would take you over your annual investment limit of ${formatCents(user.annualInvestmentLimitCents, { whole: true })}.`, "shares");
      }
      const wallet = wallets.get(input.userId)!;
      if (wallet.availableCents < heldCents) {
        throw new DomainError(`This order needs ${formatCents(heldCents)} set aside, and you have ${formatCents(wallet.availableCents)} available.`, "shares");
      }
      await tx.wallet.update({ where: { userId: input.userId }, data: { availableCents: { decrement: heldCents }, heldCents: { increment: heldCents } } });
    } else {
      const holding = await tx.holding.findUnique({ where: { userId_propertyId: { userId: input.userId, propertyId: property.id } } });
      const lots = await tx.holdingLot.findMany({ where: { userId: input.userId, propertyId: property.id, remainingUnits: { gt: 0n } } });
      const sellable = sellableUnits(lots, now, settings.holdingPeriodMonths) - (holding?.reservedUnits ?? 0n);
      if (!holding || sellable < input.units) {
        throw new DomainError(
          `You can sell up to ${formatUnits(sellable > 0n ? sellable : 0n)} shares right now. Shares become sellable ${settings.holdingPeriodMonths} months after you buy them, and shares in open sell orders are already committed.`,
          "shares",
        );
      }
      await tx.holding.update({ where: { id: holding.id }, data: { reservedUnits: { increment: input.units } } });
    }

    let order = await tx.order.create({
      data: { userId: input.userId, propertyId: property.id, side: input.side, limitPriceCents: input.limitPriceCents, shareUnits: input.units, heldCents, windowId: window.id, createdAt: now },
    });

    const notices: Notice[] = [];
    const restingById = new Map(resting.map((o) => [o.id, o]));
    for (const fill of fills) {
      const other = restingById.get(fill.restingOrderId)!;
      const [buy, sell] = input.side === "BUY" ? [order, other] : [other, order];
      const { buyOrder, sellOrder, tradeId } = await settleFill(tx, { property, buy, sell, priceCents: fill.priceCents, units: fill.units, now, holdingPeriodMonths: settings.holdingPeriodMonths });
      if (input.side === "BUY") { order = buyOrder; restingById.set(sellOrder.id, sellOrder); } else { order = sellOrder; restingById.set(buyOrder.id, buyOrder); }
      transfers.push({ from: sell.userId, to: buy.userId, units: fill.units, ref: tradeId });
      for (const o of [buyOrder, sellOrder]) {
        const verb = o.side === "BUY" ? "bought" : "sold";
        notices.push({
          userId: o.userId,
          type: "ORDER_FILLED",
          title: o.status === "FILLED" ? `Order filled: ${property.name}` : `Order partly filled: ${property.name}`,
          body: `You ${verb} ${formatUnits(fill.units)} shares of ${property.name} at ${formatCents(fill.priceCents)} per share (${formatCents(fill.notionalCents)}).`,
          href: "/orders",
        });
      }
    }
    if (fills.length > 0) {
      const last = fills[fills.length - 1]!;
      await tx.property.update({ where: { id: property.id }, data: { lastTradePriceCents: last.priceCents, lastTradeAt: now } });
    }

    await audit(tx, { actorId: input.userId, action: "order.placed", entityType: "Order", entityId: order.id, after: { side: input.side, limitPriceCents: input.limitPriceCents, units: input.units, fills: fills.length, status: order.status }, ipAddress: input.ipAddress });
    afterCommit = await notify(tx, notices);
    const out = { orderId: order.id, filledUnits: order.filledUnits, status: order.status as string };
    await storeIdempotentResult(tx, input.idempotencyKey, out);
    return { ...out, replayed: false };
  });

  if (!result.replayed) {
    for (const t of transfers) await providers.custody.recordTransfer({ fromUserId: t.from, toUserId: t.to, propertyId: input.propertyId, units: t.units, reference: t.ref });
    await afterCommit?.();
  }
  return result;
}

/** Move shares and cash for one match. Callers hold the property lock and both wallets' locks. */
async function settleFill(
  tx: Tx,
  a: { property: { id: string; name: string }; buy: Order; sell: Order; priceCents: bigint; units: bigint; now: Date; holdingPeriodMonths: number },
) {
  const { property, buy, sell, priceCents, units, now } = a;
  const notional = (units * priceCents) / 1_000_000n; // == tradeNotional(units, priceCents)
  if (notional <= 0n) throw new Error("Refusing to settle a zero-value trade");

  // Buyer: pay from the cash held for this order; release whatever the remaining units no longer need.
  const buyFilled = buy.filledUnits + units;
  const stillNeeded = buyOrderHold(buy.shareUnits - buyFilled, buy.limitPriceCents);
  const release = buy.heldCents - notional - stillNeeded;
  if (release < 0n) throw new Error("Buy order hold does not cover its fill");
  await tx.wallet.update({ where: { userId: buy.userId }, data: { heldCents: { decrement: notional + release }, availableCents: { increment: release } } });
  const buyOrder = await tx.order.update({
    where: { id: buy.id },
    data: { filledUnits: buyFilled, heldCents: stillNeeded, status: buyFilled === buy.shareUnits ? "FILLED" : "PARTIALLY_FILLED", closedAt: buyFilled === buy.shareUnits ? now : null },
  });
  await tx.holdingLot.create({ data: { userId: buy.userId, propertyId: property.id, source: "TRADE", originalUnits: units, remainingUnits: units, costBasisCents: notional, acquiredAt: now } });
  await tx.holding.upsert({
    where: { userId_propertyId: { userId: buy.userId, propertyId: property.id } },
    create: { userId: buy.userId, propertyId: property.id, shareUnits: units, costBasisCents: notional },
    update: { shareUnits: { increment: units }, costBasisCents: { increment: notional } },
  });

  // Seller: shares leave oldest lots first; cash arrives in full.
  const basisOut = await removeUnitsFifo(tx, sell.userId, property.id, units, { releaseReserved: true });
  await tx.wallet.update({ where: { userId: sell.userId }, data: { availableCents: { increment: notional } } });
  const sellFilled = sell.filledUnits + units;
  const sellOrder = await tx.order.update({
    where: { id: sell.id },
    data: { filledUnits: sellFilled, status: sellFilled === sell.shareUnits ? "FILLED" : "PARTIALLY_FILLED", closedAt: sellFilled === sell.shareUnits ? now : null },
  });

  const trade = await tx.trade.create({
    data: { propertyId: property.id, buyOrderId: buy.id, sellOrderId: sell.id, buyerId: buy.userId, sellerId: sell.userId, priceCents, shareUnits: units, notionalCents: notional, executedAt: now },
  });
  await postLedger(tx, trade.id, [
    { account: "USER_WALLET", userId: buy.userId, propertyId: property.id, type: "TRADE_BUY", amountCents: -notional, shareUnits: units, memo: `Bought ${formatUnits(units)} shares of ${property.name} at ${formatCents(priceCents)}` },
    { account: "USER_WALLET", userId: sell.userId, propertyId: property.id, type: "TRADE_SELL", amountCents: notional, shareUnits: -units, memo: `Sold ${formatUnits(units)} shares of ${property.name} at ${formatCents(priceCents)} (cost basis ${formatCents(basisOut)})` },
  ], now);
  return { buyOrder, sellOrder, tradeId: trade.id };
}

/** Take units out of a user's lots (FIFO) and holding. Returns the cost basis removed. */
async function removeUnitsFifo(tx: Tx, userId: string, propertyId: string, units: bigint, opts: { releaseReserved: boolean }): Promise<bigint> {
  const lots = await tx.holdingLot.findMany({ where: { userId, propertyId, remainingUnits: { gt: 0n } } });
  const taken = consumeLotsFifo(lots, units);
  let basisOut = 0n;
  for (const t of taken) {
    basisOut += t.costBasisCents;
    await tx.holdingLot.update({ where: { id: t.lotId }, data: { remainingUnits: { decrement: t.units }, costBasisCents: { decrement: t.costBasisCents } } });
  }
  await tx.holding.update({
    where: { userId_propertyId: { userId, propertyId } },
    data: { shareUnits: { decrement: units }, costBasisCents: { decrement: basisOut }, ...(opts.releaseReserved ? { reservedUnits: { decrement: units } } : {}) },
  });
  return basisOut;
}

/** Give back what an unfilled order was holding: cash for a buy, reserved shares for a sell. */
async function releaseOrder(tx: Tx, order: Order, status: "CANCELLED" | "EXPIRED", now: Date) {
  const remaining = order.shareUnits - order.filledUnits;
  if (order.side === "BUY") {
    if (order.heldCents > 0n) {
      await tx.wallet.update({ where: { userId: order.userId }, data: { heldCents: { decrement: order.heldCents }, availableCents: { increment: order.heldCents } } });
    }
  } else if (remaining > 0n) {
    await tx.holding.update({ where: { userId_propertyId: { userId: order.userId, propertyId: order.propertyId } }, data: { reservedUnits: { decrement: remaining } } });
  }
  return tx.order.update({ where: { id: order.id }, data: { status, heldCents: 0n, closedAt: now } });
}

export async function cancelOrder(input: { userId: string; orderId: string; ipAddress?: string | null }) {
  return runTx(async (tx) => {
    const found = await tx.order.findUnique({ where: { id: input.orderId } });
    if (!found || found.userId !== input.userId) throw new DomainError("Order not found.");
    await lockProperty(tx, found.propertyId);
    await lockWallets(tx, [input.userId]);
    const order = await tx.order.findUniqueOrThrow({ where: { id: input.orderId } });
    if (order.status !== "OPEN" && order.status !== "PARTIALLY_FILLED") throw new DomainError("This order is already closed.");
    const updated = await releaseOrder(tx, order, "CANCELLED", new Date());
    await audit(tx, { actorId: input.userId, action: "order.cancelled", entityType: "Order", entityId: order.id, before: { status: order.status, filledUnits: order.filledUnits }, after: { status: "CANCELLED" }, ipAddress: input.ipAddress });
    return updated;
  });
}

/** Expire every live order in a window. Returns notices for the owners. */
async function expireOrders(tx: Tx, where: { windowId?: string; propertyId?: string }, now: Date): Promise<Notice[]> {
  const candidates = await tx.order.findMany({ where: { ...where, status: { in: [...LIVE] } }, select: { propertyId: true, userId: true } });
  if (candidates.length === 0) return [];
  for (const pid of [...new Set(candidates.map((c) => c.propertyId))].sort()) await lockProperty(tx, pid);
  await lockWallets(tx, candidates.map((c) => c.userId));
  const orders = await tx.order.findMany({ where: { ...where, status: { in: [...LIVE] } }, include: { property: { select: { name: true } } } });
  const notices: Notice[] = [];
  for (const o of orders) {
    await releaseOrder(tx, o, "EXPIRED", now);
    const left = o.shareUnits - o.filledUnits;
    notices.push({
      userId: o.userId,
      type: "ORDER_EXPIRED",
      title: `Order expired: ${o.property.name}`,
      body:
        o.side === "SELL"
          ? `The trading window closed before a buyer matched ${formatUnits(left)} of your shares in ${o.property.name}. Those shares are still in your account.`
          : `The trading window closed before a seller matched your order for ${formatUnits(left)} shares of ${o.property.name}. The cash set aside for it is available again.`,
      href: "/orders",
    });
    await audit(tx, { actorId: null, action: "order.expired", entityType: "Order", entityId: o.id, before: { status: o.status }, after: { status: "EXPIRED", unfilledUnits: left } });
  }
  return notices;
}

/** Cancel all live orders for a property (used when it is sold). Caller holds the property lock. */
export async function expireOrdersForProperty(tx: Tx, propertyId: string, now: Date): Promise<Notice[]> {
  return expireOrders(tx, { propertyId }, now);
}

async function holdersOfTradingProperties(tx: Tx, propertyId: string | null): Promise<string[]> {
  const rows = await tx.holding.findMany({
    where: { shareUnits: { gt: 0n }, property: { status: "TRADING", ...(propertyId ? { id: propertyId } : {}) } },
    select: { userId: true },
    distinct: ["userId"],
  });
  return rows.map((r) => r.userId);
}

const fmtDay = (d: Date) => d.toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" });

export async function openWindow(windowId: string, actorId: string | null, now = new Date()) {
  let afterCommit: (() => Promise<void>) | undefined;
  await runTx(async (tx) => {
    const w = await tx.tradingWindow.findUnique({ where: { id: windowId } });
    if (!w || w.status !== "SCHEDULED") throw new DomainError("Only a scheduled window can be opened.");
    if (w.closesAt.getTime() <= now.getTime()) throw new DomainError("This window's closing time has already passed.");
    await tx.tradingWindow.update({ where: { id: w.id }, data: { status: "OPEN", opensAt: w.opensAt.getTime() > now.getTime() ? now : w.opensAt } });
    await audit(tx, { actorId, action: "window.opened", entityType: "TradingWindow", entityId: w.id, after: { opensAt: now, closesAt: w.closesAt } });
    const users = await holdersOfTradingProperties(tx, w.propertyId);
    afterCommit = await notify(tx, users.map((userId) => ({
      userId,
      type: "WINDOW_OPENED" as const,
      title: "The trading window is open",
      body: `You can place buy and sell orders until ${fmtDay(new Date(w.closesAt.getTime() - 1))}. Orders that are not matched by then expire.`,
      href: "/portfolio",
    })));
  });
  await afterCommit?.();
}

export async function closeWindow(windowId: string, actorId: string | null, now = new Date()) {
  let afterCommit: (() => Promise<void>) | undefined;
  await runTx(async (tx) => {
    const w = await tx.tradingWindow.findUnique({ where: { id: windowId } });
    if (!w || w.status !== "OPEN") throw new DomainError("Only an open window can be closed.");
    const notices = await expireOrders(tx, { windowId: w.id }, now);
    await tx.tradingWindow.update({ where: { id: w.id }, data: { status: "CLOSED", closesAt: w.closesAt.getTime() > now.getTime() ? now : w.closesAt } });
    await audit(tx, { actorId, action: "window.closed", entityType: "TradingWindow", entityId: w.id, after: { expiredOrders: notices.length } });
    const users = await holdersOfTradingProperties(tx, w.propertyId);
    notices.push(...users.map((userId) => ({ userId, type: "WINDOW_CLOSED" as const, title: "The trading window has closed", body: "Unmatched orders have expired. Shares and cash that were set aside for them are free again.", href: "/orders" })));
    afterCommit = await notify(tx, notices);
  });
  await afterCommit?.();
}

/**
 * Job: keep the schedule (this month and next, global windows on the first N days), open what
 * is due, and close what has ended, expiring unfilled orders.
 */
export async function syncTradingWindows(now = new Date()): Promise<{ scheduled: number; opened: number; closed: number }> {
  const settings = await getSettings();
  let scheduled = 0;
  for (const offset of [0, 1]) {
    const { opensAt, closesAt } = windowForMonth(now.getUTCFullYear(), now.getUTCMonth() + offset, settings.tradingWindowDays);
    if (closesAt.getTime() <= now.getTime()) continue;
    const monthStart = opensAt;
    const monthEnd = new Date(Date.UTC(opensAt.getUTCFullYear(), opensAt.getUTCMonth() + 1, 1));
    const exists = await prisma.tradingWindow.findFirst({ where: { propertyId: null, opensAt: { gte: monthStart, lt: monthEnd } } });
    if (!exists) {
      await prisma.tradingWindow.create({ data: { propertyId: null, opensAt, closesAt, status: "SCHEDULED" } });
      scheduled++;
    }
  }
  const toClose = await prisma.tradingWindow.findMany({ where: { status: "OPEN", closesAt: { lte: now } } });
  for (const w of toClose) await closeWindow(w.id, null, now);
  // A scheduled window whose time has fully passed (cron was down) is closed without ever opening.
  await prisma.tradingWindow.updateMany({ where: { status: "SCHEDULED", closesAt: { lte: now } }, data: { status: "CLOSED" } });
  const toOpen = await prisma.tradingWindow.findMany({ where: { status: "SCHEDULED", opensAt: { lte: now }, closesAt: { gt: now } } });
  for (const w of toOpen) await openWindow(w.id, null, now);
  return { scheduled, opened: toOpen.length, closed: toClose.length };
}

/** What the reserve would pay right now. Read-only; used for the preview and re-run inside the sale. */
export async function buybackQuoteFor(tx: Tx | typeof prisma, propertyId: string, units: bigint, now = new Date()) {
  const [reserve, appraisal] = await Promise.all([tx.liquidityReserve.findUnique({ where: { propertyId } }), latestAppraisal(tx, propertyId)]);
  if (!reserve || !appraisal) return null;
  const used = reserve.usagePeriod === monthKey(now) ? reserve.usedThisMonthCents : 0n;
  const quote = quoteBuyback({ units, navPerShareCents: appraisal.navPerShareCents, discountBps: reserve.discountBps, monthlyCapCents: reserve.monthlyCapCents, usedThisMonthCents: used, reserveBalanceCents: reserve.balanceCents });
  return { quote, reserve, navPerShareCents: appraisal.navPerShareCents, usedThisMonthCents: used };
}

/**
 * "Sell to reserve": the property's liquidity reserve buys shares at the appraised value less
 * the discount, up to the monthly cap and the cash it holds. Bought-back shares are RETIRED:
 * they stop existing, so each remaining share is a slightly larger slice of the property.
 */
export async function sellToReserve(input: { userId: string; propertyId: string; units: bigint; idempotencyKey: string; ipAddress?: string | null; now?: Date }) {
  const now = input.now ?? new Date();
  let afterCommit: (() => Promise<void>) | undefined;
  const result = await runTx(async (tx) => {
    const replay = (await claimIdempotencyKey(tx, input.idempotencyKey, input.userId, "sellToReserve")) as { proceedsCents: string; tradeId: string } | null;
    if (replay) return { proceedsCents: BigInt(replay.proceedsCents), tradeId: replay.tradeId, replayed: true };

    const settings = await getSettings(tx);
    const property = await lockProperty(tx, input.propertyId);
    const user = await tx.user.findUniqueOrThrow({ where: { id: input.userId } });
    if (user.kycStatus !== "APPROVED") throw new DomainError("Your identity check must be approved before you can sell.");
    if (!user.tradingDisclosureAcceptedAt) throw new DomainError("Please read and accept the trading disclosure first.");
    if (property.status !== "TRADING") throw new DomainError("Shares of this property are not trading right now.");
    if (!(await openWindowFor(tx, property.id, now))) throw new DomainError("The trading window is closed. You can sell to the reserve while a window is open.");
    if (input.units <= 0n) throw new DomainError("Enter how many shares to sell.", "shares");

    await tx.$queryRaw`SELECT "id" FROM "LiquidityReserve" WHERE "propertyId" = ${property.id} FOR UPDATE`;
    await lockWallets(tx, [input.userId]);
    const holding = await tx.holding.findUnique({ where: { userId_propertyId: { userId: input.userId, propertyId: property.id } } });
    const lots = await tx.holdingLot.findMany({ where: { userId: input.userId, propertyId: property.id, remainingUnits: { gt: 0n } } });
    const sellable = sellableUnits(lots, now, settings.holdingPeriodMonths) - (holding?.reservedUnits ?? 0n);
    if (!holding || sellable < input.units) throw new DomainError(`You can sell up to ${formatUnits(sellable > 0n ? sellable : 0n)} shares right now.`, "shares");

    const q = await buybackQuoteFor(tx, property.id, input.units, now);
    if (!q) throw new DomainError("This property does not have a liquidity reserve yet.");
    if (!q.quote.ok) {
      const msg =
        q.quote.reason === "TOO_SMALL"
          ? "That quantity is worth less than one cent."
          : q.quote.reason === "NO_BUDGET"
            ? "The reserve has no buyback budget left this month. You can place a sell order on the market instead, or try again next month."
            : `The reserve can buy up to ${formatUnits(q.quote.maxUnits)} shares (${formatCents(q.quote.budgetCents)}) for the rest of this month.`;
      throw new DomainError(msg, "shares");
    }
    const proceeds = q.quote.proceedsCents;

    const basisOut = await removeUnitsFifo(tx, input.userId, property.id, input.units, { releaseReserved: false });
    await tx.wallet.update({ where: { userId: input.userId }, data: { availableCents: { increment: proceeds } } });
    await tx.liquidityReserve.update({
      where: { propertyId: property.id },
      data: { balanceCents: { decrement: proceeds }, usedThisMonthCents: q.usedThisMonthCents + proceeds, usagePeriod: monthKey(now) },
    });
    await tx.property.update({ where: { id: property.id }, data: { retiredUnits: { increment: input.units } } });
    const trade = await tx.trade.create({
      data: { propertyId: property.id, sellerId: input.userId, isBuyback: true, priceCents: q.quote.priceCents, shareUnits: input.units, notionalCents: proceeds, executedAt: now },
    });
    await postLedger(tx, trade.id, [
      { account: "USER_WALLET", userId: input.userId, propertyId: property.id, type: "BUYBACK_SALE", amountCents: proceeds, shareUnits: -input.units, memo: `Sold ${formatUnits(input.units)} shares of ${property.name} to the liquidity reserve at ${formatCents(q.quote.priceCents)} (cost basis ${formatCents(basisOut)})` },
      { account: "LIQUIDITY_RESERVE", propertyId: property.id, type: "BUYBACK_SALE", amountCents: -proceeds, memo: `Bought back and retired ${formatUnits(input.units)} shares` },
    ], now);
    await audit(tx, { actorId: input.userId, action: "buyback.sold", entityType: "Trade", entityId: trade.id, after: { units: input.units, priceCents: q.quote.priceCents, proceedsCents: proceeds, retired: true }, ipAddress: input.ipAddress });
    afterCommit = await notify(tx, [{ userId: input.userId, type: "ORDER_FILLED", title: `Sold to reserve: ${property.name}`, body: `The liquidity reserve bought ${formatUnits(input.units)} of your shares in ${property.name} for ${formatCents(proceeds)}.`, href: "/orders" }]);
    const out = { proceedsCents: proceeds, tradeId: trade.id };
    await storeIdempotentResult(tx, input.idempotencyKey, out);
    return { ...out, replayed: false };
  });
  if (!result.replayed) {
    await providers.custody.recordRetirement({ userId: input.userId, propertyId: input.propertyId, units: input.units, reference: result.tradeId });
    await afterCommit?.();
  }
  return result;
}

/** The mock TradingVenueProvider: the internal engine above. An ATS adapter replaces this. */
export const internalVenue: TradingVenueProvider = {
  name: "internal-matching-engine",
  submitOrder: (input) => placeOrder(input),
  cancelOrder: async (input) => {
    await cancelOrder(input);
  },
};
