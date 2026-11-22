import type { Page } from "@playwright/test";
import { formatCents } from "../../src/lib/domain/money";
import { circuitBreakerBand } from "../../src/lib/domain/trading-rules";
import { DEMO } from "./env";
import { db, expect, test, UNITS_PER_SHARE } from "./fixtures";

const SLUG = "kenwood-bungalow-columbus";
const NAME = "Kenwood Bungalow";
const SHARES = 5n;

async function placeOrder(page: Page, side: "Buy" | "Sell", priceCents: bigint, shares: bigint) {
  await page.goto(`/properties/${SLUG}/trade`);
  // First trade: the trading disclosure has to be accepted (seeded users already have).
  const disclosure = page.getByRole("checkbox", { name: /I understand that orders can only be placed during trading windows/ });
  if (await disclosure.isVisible().catch(() => false)) {
    await disclosure.check();
    await page.getByRole("button", { name: "Accept and continue" }).click();
  }
  await expect(page.getByText(/The trading window is open until/)).toBeVisible();
  await page.getByRole("group", { name: "Order side" }).getByRole("button", { name: side, exact: true }).click();
  await page.getByLabel("Your price per share").fill((Number(priceCents) / 100).toFixed(2));
  await page.getByLabel("Shares", { exact: true }).fill(shares.toString());
  await page.getByRole("button", { name: "Review order" }).click();
  await expect(page.getByText("Review your order")).toBeVisible();
  await expect(page.getByText(`${side} ${shares} shares`, { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Place order" }).click();
}

async function tradesTab(page: Page) {
  await page.goto("/orders?show=trades");
  return page.getByRole("table", { name: "Your trades" });
}

test("a resting sell order is filled by another investor's buy at the same price", async ({ newUserPage }) => {
  const property = await db.property.findUniqueOrThrow({ where: { slug: SLUG } });
  const settings = await db.platformSettings.findUniqueOrThrow({ where: { id: 1 } });
  const appraisal = await db.appraisal.findFirstOrThrow({ where: { propertyId: property.id }, orderBy: [{ effectiveDate: "desc" }, { createdAt: "desc" }] });
  const band = circuitBreakerBand(appraisal.navPerShareCents, settings.circuitBreakerBps);
  const live = { propertyId: property.id, status: { in: ["OPEN", "PARTIALLY_FILLED"] as ("OPEN" | "PARTIALLY_FILLED")[] } };
  const bestAsk = (await db.order.findFirstOrThrow({ where: { ...live, side: "SELL" }, orderBy: { limitPriceCents: "asc" } })).limitPriceCents;
  const bestBid = (await db.order.findFirst({ where: { ...live, side: "BUY" }, orderBy: { limitPriceCents: "desc" } }))?.limitPriceCents ?? 0n;

  // A price strictly between the best bid and best ask (so the sell rests), inside the band.
  const lo = bestBid + 1n > band.minCents ? bestBid + 1n : band.minCents;
  const hi = bestAsk - 1n < band.maxCents ? bestAsk - 1n : band.maxCents;
  expect(lo, "there must be room between the best bid and best ask").toBeLessThanOrEqual(hi);
  const price = (lo + hi) / 2n;
  const units = SHARES * UNITS_PER_SHARE;
  const notional = price * SHARES;

  // Investor A: investor@demo.test, who holds Kenwood shares well past the holding period.
  const seller = await db.user.findUniqueOrThrow({ where: { email: DEMO.investor.email } });
  // Investor B: a seeded investor with enough cash.
  const candidates = await db.user.findMany({
    where: { role: "INVESTOR", email: { endsWith: "@demo.test", not: DEMO.investor.email }, onboardingCompletedAt: { not: null }, wallet: { availableCents: { gte: notional + 10_000n } } },
    orderBy: { email: "asc" },
  });
  const buyer = candidates[0]!;
  expect(buyer, "a seeded buyer with cash").toBeTruthy();

  const snapshot = async () => {
    const [sw, bw, sh, bh] = await Promise.all([
      db.wallet.findUniqueOrThrow({ where: { userId: seller.id } }),
      db.wallet.findUniqueOrThrow({ where: { userId: buyer.id } }),
      db.holding.findUnique({ where: { userId_propertyId: { userId: seller.id, propertyId: property.id } } }),
      db.holding.findUnique({ where: { userId_propertyId: { userId: buyer.id, propertyId: property.id } } }),
    ]);
    return { sw, bw, sellerUnits: sh?.shareUnits ?? 0n, buyerUnits: bh?.shareUnits ?? 0n };
  };
  const before = await snapshot();
  const startedAt = new Date(Date.now() - 1000);

  // ---- A: sell, which rests in the book ----
  const a = await newUserPage(DEMO.investor.email, DEMO.investor.password);
  await placeOrder(a, "Sell", price, SHARES);
  await expect(a.getByText(`Order placed. It stays open at ${formatCents(price)}`)).toBeVisible();
  const sellOrder = await db.order.findFirstOrThrow({ where: { userId: seller.id, propertyId: property.id, side: "SELL", limitPriceCents: price, createdAt: { gte: startedAt } } });
  expect(sellOrder.status).toBe("OPEN");
  expect(sellOrder.shareUnits).toBe(units);

  // ---- B: buy at the same price, which fills against A ----
  const b = await newUserPage(buyer.email, DEMO.othersPassword);
  await placeOrder(b, "Buy", price, SHARES);
  await expect(b.getByText(`Filled: your order to buy ${SHARES} shares matched in full.`)).toBeVisible();

  // ---- DB: one trade, shares and cash moved by exactly price × shares ----
  const trades = await db.trade.findMany({ where: { propertyId: property.id, executedAt: { gte: startedAt } } });
  expect(trades).toHaveLength(1);
  const t = trades[0]!;
  expect(t).toMatchObject({ sellerId: seller.id, buyerId: buyer.id, sellOrderId: sellOrder.id, priceCents: price, shareUnits: units, notionalCents: notional, isBuyback: false });
  expect((await db.order.findUniqueOrThrow({ where: { id: sellOrder.id } })).status).toBe("FILLED");

  const after = await snapshot();
  expect(after.sellerUnits - before.sellerUnits).toBe(-units);
  expect(after.buyerUnits - before.buyerUnits).toBe(units);
  expect(after.sw.availableCents - before.sw.availableCents).toBe(notional);
  expect(after.sw.heldCents).toBe(before.sw.heldCents);
  expect(after.bw.availableCents - before.bw.availableCents).toBe(-notional);
  expect(after.bw.heldCents).toBe(before.bw.heldCents);

  // ---- UI: both see the trade on the "Your trades" tab ----
  for (const [page, verb, cash] of [[a, "Sold", `+${formatCents(notional)}`], [b, "Bought", `−${formatCents(notional)}`]] as const) {
    const table = await tradesTab(page);
    const row = table.getByRole("row").filter({ hasText: NAME }).filter({ hasText: verb }).filter({ hasText: formatCents(price) }).filter({ hasText: cash });
    await expect(row.first()).toBeVisible();
    await expect(row.first().getByRole("cell").nth(4)).toHaveText(SHARES.toString());
  }
});
