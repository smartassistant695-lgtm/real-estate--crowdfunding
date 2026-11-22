import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { buyPrimary, refundExpiredOfferings } from "@/lib/services/purchase";
import { createProperty, createUser, expectReconciled, holdingOf, key, ledgerSum, lotsOf, resetDb, sh, usd, utc, walletOf, type TestUser } from "../helpers/factories";

const DEADLINE = utc(2025, 3, 1);
const BEFORE = utc(2025, 2, 10, 12);

let x: TestUser, y: TestUser, z: TestUser;

beforeEach(async () => {
  await resetDb();
  [x, y, z] = await Promise.all([createUser({ fundCents: usd(5000) }), createUser({ fundCents: usd(5000) }), createUser({ fundCents: usd(5000) })]);
});
afterAll(async () => {
  await prisma.$disconnect();
});

const buy = (u: TestUser, propertyId: string, opts: { units?: bigint; amountCents?: bigint }, now: Date = BEFORE) =>
  buyPrimary({ userId: u.id, propertyId, ...opts, idempotencyKey: key("buy"), now });

/** An offering that sold 60 of 100 shares: x twice (10 + 20), y by amount ($1,000.00 at $33.33), z 10. */
async function partlySoldOffering(deadline: Date = DEADLINE) {
  const p = await createProperty({ totalShares: 100, priceCents: 3333n, fundingDeadline: deadline });
  await buy(x, p.id, { units: sh(10) });
  await buy(x, p.id, { units: sh(20) }, new Date(BEFORE.getTime() + 3600_000));
  await buy(y, p.id, { amountCents: usd(1000) });
  await buy(z, p.id, { units: sh(10) });
  return p;
}

describe("refunding offerings that did not fund", () => {
  it("refunds every investor in full, zeroes holdings and lots, and marks the property CANCELLED", async () => {
    const p = await partlySoldOffering();
    const spent = new Map<string, bigint>();
    for (const u of [x, y, z]) spent.set(u.id, usd(5000) - (await walletOf(u.id)).availableCents);
    expect(spent.get(x.id)).toBe(3333n * 10n + 3333n * 20n); // $999.90
    expect(spent.get(y.id)).toBe(usd(1000));
    const escrow = await ledgerSum({ account: "PROPERTY_ESCROW", propertyId: p.id });
    expect(escrow).toBe([...spent.values()].reduce((a, b) => a + b, 0n));

    const res = await refundExpiredOfferings(DEADLINE);
    expect(res).toEqual({ cancelled: [p.id] });

    for (const u of [x, y, z]) {
      expect(await walletOf(u.id)).toEqual({ availableCents: usd(5000), heldCents: 0n });
      expect(await holdingOf(u.id, p.id)).toEqual({ shareUnits: 0n, reservedUnits: 0n, costBasisCents: 0n });
      for (const lot of await lotsOf(u.id, p.id)) expect(lot).toMatchObject({ remainingUnits: 0n, costBasisCents: 0n });
      // One refund line per investor, returning their cash and their shares.
      const refund = await prisma.ledgerEntry.findMany({ where: { userId: u.id, type: "REFUND" } });
      expect(refund).toHaveLength(1);
      expect(refund[0]).toMatchObject({ amountCents: spent.get(u.id), createdAt: DEADLINE });
      expect(-(refund[0]!.shareUnits ?? 0n)).toBe((await prisma.primaryPurchase.aggregate({ where: { userId: u.id }, _sum: { shareUnits: true } }))._sum.shareUnits);
    }
    const after = await prisma.property.findUniqueOrThrow({ where: { id: p.id } });
    expect(after).toMatchObject({ status: "CANCELLED", soldUnits: 0n, fundedAt: null });
    expect(await prisma.primaryPurchase.count({ where: { propertyId: p.id, refundedAt: null } })).toBe(0);
    expect(await prisma.primaryPurchase.count({ where: { propertyId: p.id, refundedAt: DEADLINE } })).toBe(4);
    expect(await ledgerSum({ account: "PROPERTY_ESCROW", propertyId: p.id })).toBe(0n);
    expect(await prisma.liquidityReserve.count()).toBe(0);
    // One notice per investor, not per purchase.
    expect(await prisma.notification.count({ where: { type: "OFFERING_REFUNDED" } })).toBe(3);
    expect(await prisma.notification.count({ where: { type: "OFFERING_REFUNDED", userId: x.id } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: "offering.cancelled_refunded", entityId: p.id } })).toBe(1);

    // A cancelled offering takes no more money.
    await expect(buy(x, p.id, { units: sh(1) }, DEADLINE)).rejects.toThrow(/not open for investment/);
    await expectReconciled();
  });

  it("is idempotent: running twice, or twice at once, refunds once", async () => {
    const p = await partlySoldOffering();
    const [first, second] = await Promise.all([refundExpiredOfferings(DEADLINE), refundExpiredOfferings(DEADLINE)]);
    expect([...first.cancelled, ...second.cancelled]).toEqual([p.id]);
    const ledgerCount = await prisma.ledgerEntry.count();

    expect(await refundExpiredOfferings(new Date(DEADLINE.getTime() + 86_400_000))).toEqual({ cancelled: [] });
    expect(await prisma.ledgerEntry.count()).toBe(ledgerCount);
    for (const u of [x, y, z]) expect((await walletOf(u.id)).availableCents).toBe(usd(5000));
    expect(await prisma.notification.count({ where: { type: "OFFERING_REFUNDED" } })).toBe(3);
    await expectReconciled();
  });

  it("leaves fully funded and not-yet-due offerings alone", async () => {
    const notDue = await partlySoldOffering(utc(2025, 3, 2));
    const funded = await createProperty({ totalShares: 20, priceCents: usd(100), fundingDeadline: DEADLINE });
    await buy(x, funded.id, { units: sh(12) });
    await buy(y, funded.id, { units: sh(8) });
    expect((await prisma.property.findUniqueOrThrow({ where: { id: funded.id } })).status).toBe("FUNDED");
    const noDeadline = await createProperty({ fundingDeadline: null });
    await buy(z, noDeadline.id, { units: sh(1) });
    const walletsBefore = await Promise.all([x, y, z].map((u) => walletOf(u.id)));
    const ledgerCount = await prisma.ledgerEntry.count();

    // A millisecond before the deadline nothing is due; at the deadline only the expired one would be.
    expect(await refundExpiredOfferings(new Date(DEADLINE.getTime() - 1))).toEqual({ cancelled: [] });
    expect(await refundExpiredOfferings(DEADLINE)).toEqual({ cancelled: [] });

    expect(await Promise.all([x, y, z].map((u) => walletOf(u.id)))).toEqual(walletsBefore);
    expect(await prisma.ledgerEntry.count()).toBe(ledgerCount);
    expect((await prisma.property.findUniqueOrThrow({ where: { id: notDue.id } })).status).toBe("FUNDING");
    expect((await prisma.property.findUniqueOrThrow({ where: { id: funded.id } })).status).toBe("FUNDED");
    expect((await prisma.property.findUniqueOrThrow({ where: { id: noDeadline.id } })).status).toBe("FUNDING");
    expect((await holdingOf(x.id, funded.id)).shareUnits).toBe(sh(12));

    // The next day the not-yet-due one is refunded, and only it.
    expect(await refundExpiredOfferings(utc(2025, 3, 2))).toEqual({ cancelled: [notDue.id] });
    expect((await holdingOf(x.id, funded.id)).shareUnits).toBe(sh(12));
    await expectReconciled();
  });

  it("cancels an expired offering that sold nothing, without ledger entries", async () => {
    const empty = await createProperty({ fundingDeadline: DEADLINE });
    const ledgerCount = await prisma.ledgerEntry.count();
    expect(await refundExpiredOfferings(DEADLINE)).toEqual({ cancelled: [empty.id] });
    expect((await prisma.property.findUniqueOrThrow({ where: { id: empty.id } })).status).toBe("CANCELLED");
    expect(await prisma.ledgerEntry.count()).toBe(ledgerCount);
    await expectReconciled();
  });

  it("a refund gives back the annual investment allowance", async () => {
    const capped = await createUser({ annualLimitCents: usd(1000), fundCents: usd(5000) });
    const p = await createProperty({ fundingDeadline: DEADLINE });
    const other = await createProperty({ fundingDeadline: utc(2025, 12, 1) });
    await buy(capped, p.id, { amountCents: usd(1000) });
    await expect(buy(capped, other.id, { amountCents: usd(26) })).rejects.toThrow(/annual investment limit/);

    await refundExpiredOfferings(DEADLINE);
    await expect(buy(capped, other.id, { amountCents: usd(1000) }, utc(2025, 3, 5))).resolves.toMatchObject({ costCents: usd(1000) });
    expect((await walletOf(capped.id)).availableCents).toBe(usd(4000));
    await expectReconciled();
  });
});
