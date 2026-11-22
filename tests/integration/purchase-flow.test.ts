import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { buyPrimary } from "@/lib/services/purchase";
import { createProperty, createUser, expectReconciled, holdingOf, key, ledgerSum, lotsOf, resetDb, sh, usd, utc, walletOf } from "../helpers/factories";

const NOW = utc(2025, 3, 3, 15);

beforeEach(async () => {
  await resetDb();
});
afterAll(async () => {
  await prisma.$disconnect();
});

describe("buying in the initial offering", () => {
  it("buys by dollar amount: units round down, cost rounds up, never above the amount typed", async () => {
    const user = await createUser({ fundCents: usd(500) });
    const property = await createProperty({ totalShares: 100, priceCents: 3333n });

    const res = await buyPrimary({ userId: user.id, propertyId: property.id, amountCents: usd(100), idempotencyKey: key(), now: NOW });

    // floor(10,000 × 1,000,000 / 3,333) = 3,000,300 units; ceil(3,000,300 × 3,333 / 1,000,000) = 10,000 cents
    expect(res).toMatchObject({ units: 3_000_300n, costCents: 10_000n, funded: false, replayed: false });
    expect(res.costCents).toBeLessThanOrEqual(usd(100));
    expect(await walletOf(user.id)).toEqual({ availableCents: usd(400), heldCents: 0n });
    expect(await holdingOf(user.id, property.id)).toEqual({ shareUnits: 3_000_300n, reservedUnits: 0n, costBasisCents: 10_000n });

    const lots = await lotsOf(user.id, property.id);
    expect(lots).toHaveLength(1);
    expect(lots[0]).toMatchObject({ source: "PRIMARY", originalUnits: 3_000_300n, remainingUnits: 3_000_300n, costBasisCents: 10_000n, acquiredAt: NOW });

    const purchase = await prisma.primaryPurchase.findUniqueOrThrow({ where: { id: res.purchaseId } });
    expect(purchase).toMatchObject({ userId: user.id, propertyId: property.id, shareUnits: 3_000_300n, priceCents: 3333n, totalCents: 10_000n, refundedAt: null });

    const after = await prisma.property.findUniqueOrThrow({ where: { id: property.id } });
    expect(after.soldUnits).toBe(3_000_300n);
    expect(after.status).toBe("FUNDING");
    expect(await ledgerSum({ account: "PROPERTY_ESCROW", propertyId: property.id })).toBe(10_000n);
    expect(await ledgerSum({ account: "USER_WALLET", userId: user.id, type: "PRIMARY_PURCHASE" })).toBe(-10_000n);
    expect(await prisma.notification.count({ where: { userId: user.id, type: "PURCHASE_CONFIRMED" } })).toBe(1);
    await expectReconciled();
  });

  it("an amount that does not divide evenly costs less than typed, never more", async () => {
    const user = await createUser({ fundCents: usd(500) });
    const property = await createProperty({ totalShares: 100, priceCents: 7777n });

    const res = await buyPrimary({ userId: user.id, propertyId: property.id, amountCents: 5001n, idempotencyKey: key(), now: NOW });
    // floor(5001e6 / 7777) = 643,050 units; ceil(643,050 × 7777 / 1e6) = ceil(5000.99985) = 5001
    expect(res.units).toBe(643_050n);
    expect(res.costCents).toBe(5001n);
    expect((await walletOf(user.id)).availableCents).toBe(usd(500) - 5001n);
    await expectReconciled();
  });

  it("buys by share count", async () => {
    const user = await createUser({ fundCents: usd(1000) });
    const property = await createProperty({ totalShares: 100, priceCents: usd(100) });

    const res = await buyPrimary({ userId: user.id, propertyId: property.id, units: sh(2.5), idempotencyKey: key(), now: NOW });

    expect(res).toMatchObject({ units: 2_500_000n, costCents: usd(250), funded: false, replayed: false });
    expect(await walletOf(user.id)).toEqual({ availableCents: usd(750), heldCents: 0n });
    expect(await holdingOf(user.id, property.id)).toEqual({ shareUnits: sh(2.5), reservedUnits: 0n, costBasisCents: usd(250) });
    await expectReconciled();
  });

  it("a second purchase adds a second lot and increases the same holding", async () => {
    const user = await createUser({ fundCents: usd(1000) });
    const property = await createProperty({ totalShares: 100, priceCents: usd(100) });
    await buyPrimary({ userId: user.id, propertyId: property.id, units: sh(1), idempotencyKey: key(), now: NOW });
    await buyPrimary({ userId: user.id, propertyId: property.id, units: sh(2), idempotencyKey: key(), now: new Date(NOW.getTime() + 60_000) });

    expect(await holdingOf(user.id, property.id)).toEqual({ shareUnits: sh(3), reservedUnits: 0n, costBasisCents: usd(300) });
    expect((await lotsOf(user.id, property.id)).map((l) => l.remainingUnits)).toEqual([sh(1), sh(2)]);
    expect(await prisma.holding.count({ where: { userId: user.id } })).toBe(1);
    await expectReconciled();
  });

  it("enforces the minimum investment, except for a purchase that takes the last shares", async () => {
    const user = await createUser({ fundCents: usd(20_000) });
    const property = await createProperty({ totalShares: 100, priceCents: usd(100) });

    await expect(buyPrimary({ userId: user.id, propertyId: property.id, amountCents: usd(25.99), idempotencyKey: key(), now: NOW })).rejects.toThrow(/minimum investment is \$26/i);
    await expect(buyPrimary({ userId: user.id, propertyId: property.id, units: sh(0.25), idempotencyKey: key(), now: NOW })).rejects.toThrow(/minimum investment/i);
    await expect(buyPrimary({ userId: user.id, propertyId: property.id, amountCents: 0n, idempotencyKey: key(), now: NOW })).rejects.toThrow(/too small/i);
    await expect(buyPrimary({ userId: user.id, propertyId: property.id, units: -sh(1), idempotencyKey: key(), now: NOW })).rejects.toThrow();
    expect((await walletOf(user.id)).availableCents).toBe(usd(20_000));
    expect(await prisma.primaryPurchase.count()).toBe(0);

    // Exactly the minimum is accepted.
    const min = await buyPrimary({ userId: user.id, propertyId: property.id, amountCents: usd(26), idempotencyKey: key(), now: NOW });
    expect(min.costCents).toBe(usd(26));

    // Leave $10 of shares, then buy them: below the minimum but allowed because it finishes the offering.
    await buyPrimary({ userId: user.id, propertyId: property.id, units: sh(100) - min.units - sh(0.1), idempotencyKey: key(), now: NOW });
    const last = await buyPrimary({ userId: user.id, propertyId: property.id, units: sh(0.1), idempotencyKey: key(), now: NOW });
    expect(last).toMatchObject({ costCents: usd(10), funded: true });
    await expectReconciled();
  });

  it("rejects a purchase the wallet cannot cover and changes nothing", async () => {
    const user = await createUser({ fundCents: usd(99.99) });
    const property = await createProperty();

    await expect(buyPrimary({ userId: user.id, propertyId: property.id, units: sh(1), idempotencyKey: key(), now: NOW })).rejects.toThrow(/You have \$99\.99 available/);

    expect(await walletOf(user.id)).toEqual({ availableCents: usd(99.99), heldCents: 0n });
    expect(await holdingOf(user.id, property.id)).toEqual({ shareUnits: 0n, reservedUnits: 0n, costBasisCents: 0n });
    expect((await prisma.property.findUniqueOrThrow({ where: { id: property.id } })).soldUnits).toBe(0n);
    expect(await prisma.primaryPurchase.count()).toBe(0);
    expect(await prisma.ledgerEntry.count({ where: { type: "PRIMARY_PURCHASE" } })).toBe(0);
    await expectReconciled();
  });

  it("a failed attempt does not burn its idempotency key", async () => {
    const user = await createUser({ fundCents: usd(50) });
    const property = await createProperty();
    const k = key();
    await expect(buyPrimary({ userId: user.id, propertyId: property.id, units: sh(1), idempotencyKey: k, now: NOW })).rejects.toThrow(/available/);
    const { fund } = await import("../helpers/factories");
    await fund(user.id, usd(50));
    const res = await buyPrimary({ userId: user.id, propertyId: property.id, units: sh(1), idempotencyKey: k, now: NOW });
    expect(res.replayed).toBe(false);
    expect((await walletOf(user.id)).availableCents).toBe(0n);
    await expectReconciled();
  });

  it("requires an approved identity check and an accepted risk disclosure", async () => {
    const property = await createProperty();
    for (const kycStatus of ["NOT_STARTED", "PENDING", "REJECTED"] as const) {
      const u = await createUser({ kycStatus, fundCents: usd(500) });
      await expect(buyPrimary({ userId: u.id, propertyId: property.id, units: sh(1), idempotencyKey: key(), now: NOW })).rejects.toThrow(/identity check must be approved/i);
      expect((await walletOf(u.id)).availableCents).toBe(usd(500));
    }
    const noDisclosure = await createUser({ riskDisclosure: false, fundCents: usd(500) });
    await expect(buyPrimary({ userId: noDisclosure.id, propertyId: property.id, units: sh(1), idempotencyKey: key(), now: NOW })).rejects.toThrow(/risk disclosure/i);

    // The trading disclosure is not needed to buy in an offering.
    const noTrading = await createUser({ tradingDisclosure: false, fundCents: usd(500) });
    await expect(buyPrimary({ userId: noTrading.id, propertyId: property.id, units: sh(1), idempotencyKey: key(), now: NOW })).resolves.toMatchObject({ costCents: usd(100) });

    expect(await prisma.primaryPurchase.count()).toBe(1);
    await expectReconciled();
  });

  it("only sells while the offering is FUNDING and before its deadline", async () => {
    const user = await createUser({ fundCents: usd(5000) });
    const deadline = utc(2025, 3, 10);
    const open = await createProperty({ fundingDeadline: deadline });
    await expect(buyPrimary({ userId: user.id, propertyId: open.id, units: sh(1), idempotencyKey: key(), now: new Date(deadline.getTime() - 1) })).resolves.toMatchObject({ replayed: false });
    await expect(buyPrimary({ userId: user.id, propertyId: open.id, units: sh(1), idempotencyKey: key(), now: deadline })).rejects.toThrow(/offering has closed/i);
    await expect(buyPrimary({ userId: user.id, propertyId: open.id, units: sh(1), idempotencyKey: key(), now: new Date(deadline.getTime() + 1) })).rejects.toThrow(/offering has closed/i);

    for (const status of ["COMING_SOON", "FUNDED", "TRADING", "EXIT_VOTE", "SOLD", "CANCELLED"] as const) {
      const p = await createProperty({ status });
      await expect(buyPrimary({ userId: user.id, propertyId: p.id, units: sh(1), idempotencyKey: key(), now: NOW })).rejects.toThrow(/not open for investment/i);
    }
    await expect(buyPrimary({ userId: user.id, propertyId: "does-not-exist", units: sh(1), idempotencyKey: key(), now: NOW })).rejects.toThrow(/Property not found/);
    expect((await walletOf(user.id)).availableCents).toBe(usd(4900));
    await expectReconciled();
  });

  it("enforces the annual investment limit across purchases in the same calendar year", async () => {
    const user = await createUser({ annualLimitCents: usd(1000), fundCents: usd(5000) });
    const a = await createProperty();
    const b = await createProperty();

    await buyPrimary({ userId: user.id, propertyId: a.id, amountCents: usd(600), idempotencyKey: key(), now: NOW });
    await expect(buyPrimary({ userId: user.id, propertyId: b.id, amountCents: usd(400.01), idempotencyKey: key(), now: NOW })).rejects.toThrow(/annual investment limit of \$1,000.*invest \$400\.00 more/i);
    await expect(buyPrimary({ userId: user.id, propertyId: a.id, amountCents: usd(500), idempotencyKey: key(), now: NOW })).rejects.toThrow(/annual investment limit/i);
    // Exactly up to the limit is fine.
    await buyPrimary({ userId: user.id, propertyId: b.id, amountCents: usd(400), idempotencyKey: key(), now: NOW });
    await expect(buyPrimary({ userId: user.id, propertyId: b.id, amountCents: usd(26), idempotencyKey: key(), now: NOW })).rejects.toThrow(/invest \$0\.00 more/i);

    expect((await walletOf(user.id)).availableCents).toBe(usd(4000));

    // The limit is per calendar year (UTC): a new year starts a new allowance.
    const nextYear = utc(2026, 1, 1, 0, 1);
    await expect(buyPrimary({ userId: user.id, propertyId: b.id, amountCents: usd(1000), idempotencyKey: key(), now: nextYear })).resolves.toMatchObject({ costCents: usd(1000) });
    await expectReconciled();
  });

  it("never sells more shares than remain", async () => {
    const first = await createUser({ fundCents: usd(20_000) });
    const second = await createUser({ fundCents: usd(20_000) });
    const property = await createProperty({ totalShares: 100, priceCents: usd(100) });
    await buyPrimary({ userId: first.id, propertyId: property.id, units: sh(90), idempotencyKey: key(), now: NOW });

    // By share count: asking for more than is left is refused outright.
    await expect(buyPrimary({ userId: second.id, propertyId: property.id, units: sh(10.000001), idempotencyKey: key(), now: NOW })).rejects.toThrow(/Only 10(\.0+)? shares are left/);
    expect((await walletOf(second.id)).availableCents).toBe(usd(20_000));

    // By amount: the purchase is trimmed to what is left and only that is charged.
    const res = await buyPrimary({ userId: second.id, propertyId: property.id, amountCents: usd(5000), idempotencyKey: key(), now: NOW });
    expect(res).toMatchObject({ units: sh(10), costCents: usd(1000), funded: true });
    expect((await walletOf(second.id)).availableCents).toBe(usd(19_000));

    const after = await prisma.property.findUniqueOrThrow({ where: { id: property.id } });
    expect(after.soldUnits).toBe(after.totalUnits);
    await expect(buyPrimary({ userId: second.id, propertyId: property.id, units: sh(1), idempotencyKey: key(), now: NOW })).rejects.toThrow(/not open for investment/i);
    await expectReconciled();
  });

  it("the last share funds the property: status flips, escrow is released, the liquidity reserve is created", async () => {
    const a = await createUser({ fundCents: usd(10_000) });
    const b = await createUser({ fundCents: usd(10_000) });
    const property = await createProperty({ totalShares: 100, priceCents: usd(100) });

    const r1 = await buyPrimary({ userId: a.id, propertyId: property.id, units: sh(60), idempotencyKey: key(), now: NOW });
    expect(r1.funded).toBe(false);
    expect(await prisma.liquidityReserve.count()).toBe(0);
    expect(await ledgerSum({ account: "PROPERTY_ESCROW", propertyId: property.id })).toBe(usd(6000));

    const fundedAt = new Date(NOW.getTime() + 3600_000);
    const r2 = await buyPrimary({ userId: b.id, propertyId: property.id, units: sh(40), idempotencyKey: key(), now: fundedAt });
    expect(r2.funded).toBe(true);

    const after = await prisma.property.findUniqueOrThrow({ where: { id: property.id } });
    expect(after).toMatchObject({ status: "FUNDED", soldUnits: sh(100), retiredUnits: 0n, fundedAt });

    // Escrow is emptied to the outside world (the closing), in one balanced event.
    expect(await ledgerSum({ account: "PROPERTY_ESCROW", propertyId: property.id })).toBe(0n);
    const release = await prisma.ledgerEntry.findMany({ where: { referenceId: `funded_${property.id}` }, orderBy: { seq: "asc" } });
    expect(release.map((e) => [e.account, e.amountCents])).toEqual([["PROPERTY_ESCROW", -usd(10_000)], ["EXTERNAL", usd(10_000)]]);

    const settings = await prisma.platformSettings.findUniqueOrThrow({ where: { id: 1 } });
    const reserve = await prisma.liquidityReserve.findUniqueOrThrow({ where: { propertyId: property.id } });
    expect(reserve).toMatchObject({ balanceCents: 0n, monthlyCapCents: settings.buybackMonthlyCapCents, discountBps: settings.buybackDiscountBps, usedThisMonthCents: 0n });

    // Every holder is told.
    const told = await prisma.notification.findMany({ where: { type: "PROPERTY_FUNDED" }, select: { userId: true } });
    expect(told.map((t) => t.userId).sort()).toEqual([a.id, b.id].sort());
    expect(await prisma.auditLog.count({ where: { action: "property.funded", entityId: property.id } })).toBe(1);
    await expectReconciled();
  });

  it("replaying an idempotency key returns the same purchase and charges once", async () => {
    const user = await createUser({ fundCents: usd(1000) });
    const other = await createUser({ fundCents: usd(1000) });
    const property = await createProperty();
    const k = key();

    const first = await buyPrimary({ userId: user.id, propertyId: property.id, units: sh(3), idempotencyKey: k, now: NOW });
    const again = await buyPrimary({ userId: user.id, propertyId: property.id, units: sh(3), idempotencyKey: k, now: NOW });
    // Even with different arguments the stored result is returned; nothing new is bought.
    const changed = await buyPrimary({ userId: user.id, propertyId: property.id, units: sh(5), idempotencyKey: k, now: NOW });

    expect(first.replayed).toBe(false);
    for (const r of [again, changed]) expect(r).toEqual({ purchaseId: first.purchaseId, units: sh(3), costCents: usd(300), funded: false, replayed: true });
    expect(await prisma.primaryPurchase.count()).toBe(1);
    expect(await walletOf(user.id)).toEqual({ availableCents: usd(700), heldCents: 0n });
    expect((await holdingOf(user.id, property.id)).shareUnits).toBe(sh(3));
    expect(await prisma.holdingLot.count()).toBe(1);
    expect(await prisma.ledgerEntry.count({ where: { type: "PRIMARY_PURCHASE" } })).toBe(2);
    expect(await prisma.notification.count({ where: { userId: user.id, type: "PURCHASE_CONFIRMED" } })).toBe(1);

    // Someone else's key cannot be reused to read or repeat the result.
    await expect(buyPrimary({ userId: other.id, propertyId: property.id, units: sh(3), idempotencyKey: k, now: NOW })).rejects.toThrow(/could not be processed/i);
    expect((await walletOf(other.id)).availableCents).toBe(usd(1000));
    await expectReconciled();
  });

  it("a double-submitted purchase (same key, at the same time) is charged once", async () => {
    const user = await createUser({ fundCents: usd(1000) });
    const property = await createProperty();
    const k = key();

    const results = await Promise.all(Array.from({ length: 6 }, () => buyPrimary({ userId: user.id, propertyId: property.id, units: sh(3), idempotencyKey: k, now: NOW })));

    expect(new Set(results.map((r) => r.purchaseId)).size).toBe(1);
    expect(results.filter((r) => !r.replayed)).toHaveLength(1);
    expect(await prisma.primaryPurchase.count()).toBe(1);
    expect(await walletOf(user.id)).toEqual({ availableCents: usd(700), heldCents: 0n });
    await expectReconciled();
  });

  it("concurrent buyers wanting more shares than remain never oversell", async () => {
    const property = await createProperty({ totalShares: 100, priceCents: usd(100) });
    const buyers = await Promise.all(Array.from({ length: 14 }, () => createUser({ fundCents: usd(1500) })));

    // 14 buyers × 10 shares = 140 shares wanted, 100 available.
    const settled = await Promise.allSettled(buyers.map((b) => buyPrimary({ userId: b.id, propertyId: property.id, units: sh(10), idempotencyKey: key(), now: NOW })));

    const ok = settled.filter((s) => s.status === "fulfilled");
    const failed = settled.filter((s): s is PromiseRejectedResult => s.status === "rejected");
    expect(ok).toHaveLength(10);
    expect(failed).toHaveLength(4);
    for (const f of failed) expect(String(f.reason?.message)).toMatch(/not open for investment|fully funded|shares are left/i);
    expect(ok.filter((s) => s.status === "fulfilled" && s.value.funded)).toHaveLength(1);

    const after = await prisma.property.findUniqueOrThrow({ where: { id: property.id } });
    expect(after.soldUnits).toBe(sh(100));
    expect(after.status).toBe("FUNDED");
    const held = await prisma.holding.aggregate({ where: { propertyId: property.id }, _sum: { shareUnits: true } });
    expect(held._sum.shareUnits).toBe(sh(100));
    expect(await prisma.primaryPurchase.count({ where: { propertyId: property.id } })).toBe(10);

    for (const [i, b] of buyers.entries()) {
      const w = await walletOf(b.id);
      const bought = settled[i]!.status === "fulfilled";
      expect(w).toEqual({ availableCents: bought ? usd(500) : usd(1500), heldCents: 0n });
    }
    expect(await ledgerSum({ account: "PROPERTY_ESCROW", propertyId: property.id })).toBe(0n);
    await expectReconciled();
  });

  it("concurrent buyers by dollar amount are trimmed to what is left, never past it", async () => {
    const property = await createProperty({ totalShares: 50, priceCents: 3333n });
    const buyers = await Promise.all(Array.from({ length: 8 }, () => createUser({ fundCents: usd(1000) })));

    const settled = await Promise.allSettled(buyers.map((b) => buyPrimary({ userId: b.id, propertyId: property.id, amountCents: usd(300), idempotencyKey: key(), now: NOW })));

    const after = await prisma.property.findUniqueOrThrow({ where: { id: property.id } });
    expect(after.soldUnits).toBe(after.totalUnits);
    expect(after.status).toBe("FUNDED");
    const purchases = await prisma.primaryPurchase.findMany({ where: { propertyId: property.id } });
    expect(purchases.reduce((a, p) => a + p.shareUnits, 0n)).toBe(sh(50));
    expect(settled.filter((s) => s.status === "fulfilled")).toHaveLength(purchases.length);
    for (const b of buyers) {
      const w = await walletOf(b.id);
      const spent = purchases.filter((p) => p.userId === b.id).reduce((a, p) => a + p.totalCents, 0n);
      expect(spent).toBeLessThanOrEqual(usd(300));
      expect(w.availableCents).toBe(usd(1000) - spent);
    }
    await expectReconciled();
  });

  it("one user spending concurrently on several offerings can never overdraw their wallet", async () => {
    const user = await createUser({ fundCents: usd(1000) });
    const properties = await Promise.all(Array.from({ length: 6 }, () => createProperty()));

    // 6 × $300 = $1,800 wanted from a $1,000 wallet.
    const settled = await Promise.allSettled(properties.map((p) => buyPrimary({ userId: user.id, propertyId: p.id, units: sh(3), idempotencyKey: key(), now: NOW })));

    const ok = settled.filter((s) => s.status === "fulfilled").length;
    expect(ok).toBe(3);
    for (const s of settled) if (s.status === "rejected") expect(String(s.reason?.message)).toMatch(/available/i);
    expect(await walletOf(user.id)).toEqual({ availableCents: usd(100), heldCents: 0n });
    expect(await prisma.primaryPurchase.count({ where: { userId: user.id } })).toBe(3);
    await expectReconciled();
  });
});
