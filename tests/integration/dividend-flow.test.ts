import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { DomainError, prisma } from "@/lib/db";
import { approveDistribution, createMonthlyDrafts, payDistribution, previewDistribution, saveFinancials } from "@/lib/services/dividends";
import { placeOrder } from "@/lib/services/trading";
import {
  createAdmin,
  createProperty,
  createTradingProperty,
  createUser,
  createWindow,
  expectReconciled,
  financials,
  fund,
  key,
  ledgerSum,
  resetDb,
  sh,
  usd,
  utc,
  walletOf,
  type TestUser,
} from "../helpers/factories";

const JAN = "2025-01";
const FEB = "2025-02";
const FUNDED_AT = utc(2025, 1, 10, 12);

let admin: TestUser;

beforeEach(async () => {
  // No holding period here, so shares can change hands in the month after funding.
  await resetDb({ holdingPeriodMonths: 0 });
  admin = await createAdmin();
});
afterAll(async () => {
  await prisma.$disconnect();
});

/** Save → preview → approve → pay for one month. */
async function runMonth(propertyId: string, month: string, data: Parameters<typeof financials>[0], paidAt: Date) {
  await saveFinancials({ actorId: admin.id, propertyId, month, data: financials(data) });
  const draft = await previewDistribution({ actorId: admin.id, propertyId, month });
  await approveDistribution({ actorId: admin.id, distributionId: draft.id });
  await payDistribution({ actorId: admin.id, distributionId: draft.id, idempotencyKey: key("pay"), now: paidAt });
  return prisma.dividendDistribution.findUniqueOrThrow({ where: { id: draft.id }, include: { payments: true } });
}

const paymentsByUser = (payments: { userId: string; amountCents: bigint }[]) => new Map(payments.map((p) => [p.userId, p.amountCents]));

describe("monthly dividends", () => {
  it("save financials → preview draft → approve → pay", async () => {
    const a = await createUser();
    const b = await createUser();
    const property = await createTradingProperty({ holders: [[a, 60], [b, 40]], fundedAt: FUNDED_AT });

    // Net income is computed by the server from the line items.
    const row = await saveFinancials({
      actorId: admin.id,
      propertyId: property.id,
      month: JAN,
      data: financials({ grossRentCents: usd(1000), managementFeeCents: usd(80), maintenanceCents: usd(13.37) }),
    });
    expect(row.netIncomeCents).toBe(90_663n);

    const draft = await previewDistribution({ actorId: admin.id, propertyId: property.id, month: JAN });
    expect(draft).toMatchObject({
      status: "DRAFT",
      month: JAN,
      recordDate: new Date(Date.UTC(2025, 1, 1) - 1),
      netIncomeCents: 90_663n,
      carryInCents: 0n,
      reserveAllocationCents: 9_066n, // 10% rounded down
      distributedCents: 81_597n,
      roundingRemainderCents: 0n,
      outstandingUnits: sh(100),
    });
    const draftPayments = await prisma.dividendPayment.findMany({ where: { distributionId: draft.id } });
    // 60% of 815.97 = 489.582, 40% = 326.388 → largest remainder gives the extra cent to b.
    expect(paymentsByUser(draftPayments)).toEqual(new Map([[a.id, 48_958n], [b.id, 32_639n]]));

    // A draft moves no money.
    expect(await walletOf(a.id)).toEqual({ availableCents: 0n, heldCents: 0n });
    expect(await prisma.ledgerEntry.count({ where: { type: "DIVIDEND" } })).toBe(0);

    const approved = await approveDistribution({ actorId: admin.id, distributionId: draft.id });
    expect(approved).toMatchObject({ status: "APPROVED", approvedById: admin.id });
    expect(approved.approvedAt).toBeInstanceOf(Date);
    expect(await walletOf(a.id)).toEqual({ availableCents: 0n, heldCents: 0n });

    const paidAt = utc(2025, 2, 10, 16);
    const res = await payDistribution({ actorId: admin.id, distributionId: draft.id, idempotencyKey: key(), now: paidAt });
    expect(res).toEqual({ replayed: false });

    const paid = await prisma.dividendDistribution.findUniqueOrThrow({ where: { id: draft.id } });
    expect(paid).toMatchObject({ status: "PAID", paidAt });
    expect(await walletOf(a.id)).toEqual({ availableCents: 48_958n, heldCents: 0n });
    expect(await walletOf(b.id)).toEqual({ availableCents: 32_639n, heldCents: 0n });

    // Reserve allocation credited to the reserve and its ledger account.
    const reserve = await prisma.liquidityReserve.findUniqueOrThrow({ where: { propertyId: property.id } });
    expect(reserve.balanceCents).toBe(9_066n);
    expect(await ledgerSum({ account: "LIQUIDITY_RESERVE", propertyId: property.id })).toBe(9_066n);
    expect(await ledgerSum({ account: "EXTERNAL", propertyId: property.id, type: "DIVIDEND" })).toBe(-90_663n);
    expect(await ledgerSum({ account: "PROPERTY_OPERATING", propertyId: property.id })).toBe(0n);
    const entries = await prisma.ledgerEntry.findMany({ where: { referenceId: draft.id } });
    expect(entries.every((e) => e.createdAt.getTime() === paidAt.getTime())).toBe(true);

    expect((await prisma.property.findUniqueOrThrow({ where: { id: property.id } })).dividendCarryCents).toBe(0n);
    expect(await prisma.notification.count({ where: { type: "DIVIDEND_PAID" } })).toBe(2);
    expect(await prisma.auditLog.count({ where: { action: "dividend.paid", entityId: draft.id } })).toBe(1);
    await expectReconciled();
  });

  it("re-saving financials refreshes a draft", async () => {
    const a = await createUser();
    const property = await createTradingProperty({ holders: [[a, 10]], fundedAt: FUNDED_AT });
    await saveFinancials({ actorId: admin.id, propertyId: property.id, month: JAN, data: financials({ grossRentCents: usd(100) }) });
    const draft = await previewDistribution({ actorId: admin.id, propertyId: property.id, month: JAN });
    expect(draft.distributedCents).toBe(usd(90));

    await saveFinancials({ actorId: admin.id, propertyId: property.id, month: JAN, data: financials({ grossRentCents: usd(200) }) });
    const refreshed = await prisma.dividendDistribution.findUniqueOrThrow({ where: { id: draft.id }, include: { payments: true } });
    expect(refreshed).toMatchObject({ status: "DRAFT", netIncomeCents: usd(200), reserveAllocationCents: usd(20), distributedCents: usd(180) });
    expect(refreshed.payments.map((p) => p.amountCents)).toEqual([usd(180)]);
    expect(await prisma.dividendDistribution.count()).toBe(1);
    await expectReconciled();
  });

  it("pays holders at the record date: a buyer after month end gets nothing for that month", async () => {
    const a = await createUser();
    const b = await createUser();
    const c = await createUser();
    await fund(c.id, usd(2000));
    const property = await createTradingProperty({ holders: [[a, 60], [b, 40]], fundedAt: FUNDED_AT });

    // On 2 February, after January's record date, a sells 10 shares to c.
    await createWindow({ opensAt: utc(2025, 2, 1), closesAt: utc(2025, 2, 8) });
    await placeOrder({ userId: a.id, propertyId: property.id, side: "SELL", limitPriceCents: usd(100), units: sh(10), idempotencyKey: key(), now: utc(2025, 2, 2, 10) });
    const buy = await placeOrder({ userId: c.id, propertyId: property.id, side: "BUY", limitPriceCents: usd(100), units: sh(10), idempotencyKey: key(), now: utc(2025, 2, 2, 11) });
    expect(buy.status).toBe("FILLED");

    // January is entered after the trade, but is paid by holdings on 31 January.
    const jan = await runMonth(property.id, JAN, { grossRentCents: usd(1000) }, utc(2025, 2, 10));
    expect(jan.outstandingUnits).toBe(sh(100));
    expect(paymentsByUser(jan.payments)).toEqual(new Map([[a.id, usd(540)], [b.id, usd(360)]]));
    expect(await prisma.dividendPayment.count({ where: { userId: c.id } })).toBe(0);
    expect((await walletOf(c.id)).availableCents).toBe(usd(1000));
    expect((await walletOf(a.id)).availableCents).toBe(usd(1000) + usd(540));

    // February: c holds 10 shares at the record date.
    const feb = await runMonth(property.id, FEB, { grossRentCents: usd(1000) }, utc(2025, 3, 10));
    expect(paymentsByUser(feb.payments)).toEqual(new Map([[a.id, usd(450)], [b.id, usd(360)], [c.id, usd(90)]]));
    expect((await walletOf(c.id)).availableCents).toBe(usd(1090));
    await expectReconciled();
  });

  it("carries the rounding remainder into the next month's pool", async () => {
    const holders = [await createUser(), await createUser(), await createUser()];
    const property = await createTradingProperty({ holders: holders.map((u) => [u, 1] as const), fundedAt: FUNDED_AT });

    // Net $1.11 → reserve 11¢ → pool 100¢ over three equal holders: 33¢ each, 1¢ carried.
    const jan = await runMonth(property.id, JAN, { grossRentCents: 111n }, utc(2025, 2, 10));
    expect(jan).toMatchObject({ reserveAllocationCents: 11n, carryInCents: 0n, distributedCents: 99n, roundingRemainderCents: 1n });
    expect(jan.payments.map((p) => p.amountCents)).toEqual([33n, 33n, 33n]);
    expect((await prisma.property.findUniqueOrThrow({ where: { id: property.id } })).dividendCarryCents).toBe(1n);
    expect(await ledgerSum({ account: "PROPERTY_OPERATING", propertyId: property.id })).toBe(1n);
    await expectReconciled();

    // February: pool = 100¢ + 1¢ carry = 101¢ → 100¢ paid (one holder gets 34¢), 1¢ carried again.
    const feb = await runMonth(property.id, FEB, { grossRentCents: 111n }, utc(2025, 3, 10));
    expect(feb).toMatchObject({ carryInCents: 1n, reserveAllocationCents: 11n, distributedCents: 100n, roundingRemainderCents: 1n });
    expect(feb.payments.map((p) => p.amountCents).sort()).toEqual([33n, 33n, 34n]);
    expect(feb.payments.reduce((s, p) => s + p.amountCents, 0n)).toBe(100n);
    expect((await prisma.property.findUniqueOrThrow({ where: { id: property.id } })).dividendCarryCents).toBe(1n);

    const totals = await Promise.all(holders.map(async (u) => (await walletOf(u.id)).availableCents));
    expect(totals.reduce((s, t) => s + t, 0n)).toBe(199n);
    expect((await prisma.liquidityReserve.findUniqueOrThrow({ where: { propertyId: property.id } })).balanceCents).toBe(22n);
    await expectReconciled();
  });

  it("a month with negative net income pays nothing and leaves the carry untouched", async () => {
    const holders = [await createUser(), await createUser(), await createUser()];
    const property = await createTradingProperty({ holders: holders.map((u) => [u, 1] as const), fundedAt: FUNDED_AT });
    await runMonth(property.id, JAN, { grossRentCents: 111n }, utc(2025, 2, 10)); // leaves 1¢ of carry
    const before = await Promise.all(holders.map((u) => walletOf(u.id)));
    const ledgerBefore = await prisma.ledgerEntry.count();
    const noticesBefore = await prisma.notification.count({ where: { type: "DIVIDEND_PAID" } });

    await saveFinancials({ actorId: admin.id, propertyId: property.id, month: FEB, data: financials({ grossRentCents: usd(1500), maintenanceCents: usd(4200) }) });
    const draft = await previewDistribution({ actorId: admin.id, propertyId: property.id, month: FEB });
    expect(draft).toMatchObject({ netIncomeCents: -usd(2700), carryInCents: 1n, reserveAllocationCents: 0n, distributedCents: 0n, perShareMicroCents: 0n, roundingRemainderCents: 1n });

    await approveDistribution({ actorId: admin.id, distributionId: draft.id });
    await payDistribution({ actorId: admin.id, distributionId: draft.id, idempotencyKey: key(), now: utc(2025, 3, 10) });

    expect((await prisma.dividendDistribution.findUniqueOrThrow({ where: { id: draft.id } })).status).toBe("PAID");
    expect(await Promise.all(holders.map((u) => walletOf(u.id)))).toEqual(before);
    expect(await prisma.dividendPayment.count({ where: { distributionId: draft.id, amountCents: { gt: 0n } } })).toBe(0);
    expect(await prisma.ledgerEntry.count()).toBe(ledgerBefore);
    expect(await prisma.notification.count({ where: { type: "DIVIDEND_PAID" } })).toBe(noticesBefore);
    const p = await prisma.property.findUniqueOrThrow({ where: { id: property.id } });
    expect(p.dividendCarryCents).toBe(1n);
    expect((await prisma.liquidityReserve.findUniqueOrThrow({ where: { propertyId: property.id } })).balanceCents).toBe(11n);
    await expectReconciled();
  });

  it("cannot pay a distribution that has not been approved", async () => {
    const a = await createUser();
    const property = await createTradingProperty({ holders: [[a, 10]], fundedAt: FUNDED_AT });
    await saveFinancials({ actorId: admin.id, propertyId: property.id, month: JAN, data: financials({ grossRentCents: usd(100) }) });
    const draft = await previewDistribution({ actorId: admin.id, propertyId: property.id, month: JAN });

    await expect(payDistribution({ actorId: admin.id, distributionId: draft.id, idempotencyKey: key(), now: utc(2025, 2, 10) })).rejects.toThrow(/Approve the distribution before paying it/);
    await expect(payDistribution({ actorId: admin.id, distributionId: "nope", idempotencyKey: key(), now: utc(2025, 2, 10) })).rejects.toThrow(/not found/);

    expect((await prisma.dividendDistribution.findUniqueOrThrow({ where: { id: draft.id } })).status).toBe("DRAFT");
    expect((await walletOf(a.id)).availableCents).toBe(0n);
    expect(await prisma.ledgerEntry.count({ where: { type: { in: ["DIVIDEND", "RESERVE_ALLOCATION"] } } })).toBe(0);
    await expectReconciled();
  });

  it("cannot pay twice: a replayed key is a no-op and a new key is refused", async () => {
    const a = await createUser();
    const property = await createTradingProperty({ holders: [[a, 10]], fundedAt: FUNDED_AT });
    await saveFinancials({ actorId: admin.id, propertyId: property.id, month: JAN, data: financials({ grossRentCents: usd(100) }) });
    const draft = await previewDistribution({ actorId: admin.id, propertyId: property.id, month: JAN });
    await approveDistribution({ actorId: admin.id, distributionId: draft.id });

    const k = key();
    // Double-click: both requests at once with the same key.
    const [r1, r2] = await Promise.all([
      payDistribution({ actorId: admin.id, distributionId: draft.id, idempotencyKey: k, now: utc(2025, 2, 10) }),
      payDistribution({ actorId: admin.id, distributionId: draft.id, idempotencyKey: k, now: utc(2025, 2, 10) }),
    ]);
    expect([r1.replayed, r2.replayed].sort()).toEqual([false, true]);
    expect(await payDistribution({ actorId: admin.id, distributionId: draft.id, idempotencyKey: k, now: utc(2025, 2, 10) })).toEqual({ replayed: true });
    await expect(payDistribution({ actorId: admin.id, distributionId: draft.id, idempotencyKey: key(), now: utc(2025, 2, 10) })).rejects.toThrow(/already been paid/);

    expect((await walletOf(a.id)).availableCents).toBe(usd(90));
    expect((await prisma.liquidityReserve.findUniqueOrThrow({ where: { propertyId: property.id } })).balanceCents).toBe(usd(10));
    expect(await prisma.ledgerEntry.count({ where: { referenceId: draft.id } })).toBe(3);

    // A paid month is closed: no re-approval, no new financials.
    await expect(approveDistribution({ actorId: admin.id, distributionId: draft.id })).rejects.toThrow(/Only a draft can be approved/);
    await expect(saveFinancials({ actorId: admin.id, propertyId: property.id, month: JAN, data: financials({ grossRentCents: usd(500) }) })).rejects.toThrow(/already approved or paid/);
    await expect(previewDistribution({ actorId: admin.id, propertyId: property.id, month: JAN })).resolves.toMatchObject({ status: "PAID", distributedCents: usd(90) });
    expect((await prisma.monthlyFinancials.findFirstOrThrow()).grossRentCents).toBe(usd(100));
    await expectReconciled();
  });

  it("months are approved and paid in order", async () => {
    const a = await createUser();
    const property = await createTradingProperty({ holders: [[a, 10]], fundedAt: FUNDED_AT });
    for (const month of [JAN, FEB]) await saveFinancials({ actorId: admin.id, propertyId: property.id, month, data: financials({ grossRentCents: usd(100) }) });
    const jan = await previewDistribution({ actorId: admin.id, propertyId: property.id, month: JAN });
    const feb = await previewDistribution({ actorId: admin.id, propertyId: property.id, month: FEB });

    await expect(approveDistribution({ actorId: admin.id, distributionId: feb.id })).rejects.toThrow(/Pay January 2025 first/);
    await approveDistribution({ actorId: admin.id, distributionId: jan.id });
    // Approved is not enough: January must be paid.
    await expect(approveDistribution({ actorId: admin.id, distributionId: feb.id })).rejects.toThrow(/Pay January 2025 first/);
    expect((await prisma.dividendDistribution.findUniqueOrThrow({ where: { id: feb.id } })).status).toBe("DRAFT");

    await payDistribution({ actorId: admin.id, distributionId: jan.id, idempotencyKey: key(), now: utc(2025, 2, 10) });
    await approveDistribution({ actorId: admin.id, distributionId: feb.id });
    await payDistribution({ actorId: admin.id, distributionId: feb.id, idempotencyKey: key(), now: utc(2025, 3, 10) });
    expect((await walletOf(a.id)).availableCents).toBe(usd(180));
    await expectReconciled();
  });

  it("refuses to pay if the carry changed after approval", async () => {
    const holders = [await createUser(), await createUser(), await createUser()];
    const property = await createTradingProperty({ holders: holders.map((u) => [u, 1] as const), fundedAt: FUNDED_AT });
    await saveFinancials({ actorId: admin.id, propertyId: property.id, month: JAN, data: financials({ grossRentCents: 111n }) });
    const jan = await previewDistribution({ actorId: admin.id, propertyId: property.id, month: JAN });
    await approveDistribution({ actorId: admin.id, distributionId: jan.id });
    // Simulate the carry moving underneath an approved distribution.
    await prisma.property.update({ where: { id: property.id }, data: { dividendCarryCents: 5n } });
    await expect(payDistribution({ actorId: admin.id, distributionId: jan.id, idempotencyKey: key(), now: utc(2025, 2, 10) })).rejects.toThrow(/rounding carry-over changed/);
    expect(await prisma.ledgerEntry.count({ where: { type: "DIVIDEND" } })).toBe(0);
    await prisma.property.update({ where: { id: property.id }, data: { dividendCarryCents: 0n } });
    await expectReconciled();
  });

  it("createMonthlyDrafts creates drafts for last month and never pays", async () => {
    const a = await createUser();
    const withFinancials = await createTradingProperty({ holders: [[a, 10]], fundedAt: FUNDED_AT });
    const without = await createTradingProperty({ holders: [[a, 10]], fundedAt: FUNDED_AT });
    const offering = await createProperty(); // still FUNDING: no dividends
    await saveFinancials({ actorId: admin.id, propertyId: withFinancials.id, month: JAN, data: financials({ grossRentCents: usd(100) }) });
    await saveFinancials({ actorId: admin.id, propertyId: offering.id, month: JAN, data: financials({ grossRentCents: usd(100) }) });
    const ledgerBefore = await prisma.ledgerEntry.count();

    const res = await createMonthlyDrafts(utc(2025, 2, 1, 6));
    expect(res.month).toBe(JAN);
    expect(res.created).toEqual([withFinancials.slug]);
    expect(res.missingFinancials).toEqual([without.slug]);

    const dists = await prisma.dividendDistribution.findMany({ include: { payments: true } });
    expect(dists).toHaveLength(1);
    expect(dists[0]).toMatchObject({ propertyId: withFinancials.id, month: JAN, status: "DRAFT", approvedAt: null, paidAt: null, distributedCents: usd(90) });
    expect(dists[0]!.payments).toHaveLength(1);
    expect(await prisma.ledgerEntry.count()).toBe(ledgerBefore);
    expect((await walletOf(a.id)).availableCents).toBe(0n);

    // Running again creates nothing new.
    expect((await createMonthlyDrafts(utc(2025, 2, 1, 7))).created).toEqual([]);
    expect(await prisma.dividendDistribution.count()).toBe(1);

    // In January the job looks at December.
    expect((await createMonthlyDrafts(utc(2025, 1, 1, 6))).month).toBe("2024-12");
    await expectReconciled();
  });

  // ---------- months that have not ended / invalid months ----------
  // These were known issues fixed in src/lib/services/dividends.ts (assertClosedMonth and the
  // record-date check in payDistribution); the tests guard against regressions.

  it("refuses to save financials for, or preview, a month that has not ended yet", async () => {
    const a = await createUser();
    const property = await createTradingProperty({ holders: [[a, 10]], fundedAt: FUNDED_AT });
    for (const month of ["2099-01", monthOf(new Date())]) {
      await expect(saveFinancials({ actorId: admin.id, propertyId: property.id, month, data: financials({ grossRentCents: usd(100) }) })).rejects.toThrow(/has not ended yet/);
      // Even if a row exists (written directly), no draft is built from a record date in the future.
      await prisma.monthlyFinancials.create({ data: { propertyId: property.id, month, ...financials({ grossRentCents: usd(100) }), netIncomeCents: usd(100) } });
      await expect(previewDistribution({ actorId: admin.id, propertyId: property.id, month })).rejects.toBeInstanceOf(DomainError);
    }
    expect(await prisma.dividendDistribution.count()).toBe(0);
  });

  it("refuses to pay a distribution whose record date has not passed", async () => {
    const a = await createUser();
    const property = await createTradingProperty({ holders: [[a, 10]], fundedAt: FUNDED_AT });
    const dist = await prisma.dividendDistribution.create({
      data: {
        propertyId: property.id,
        month: "2099-01",
        recordDate: new Date(Date.UTC(2099, 1, 1) - 1),
        netIncomeCents: usd(100),
        reserveAllocationCents: usd(10),
        distributedCents: usd(90),
        perShareMicroCents: 900_000_000n,
        outstandingUnits: sh(10),
        status: "APPROVED",
        approvedById: admin.id,
        approvedAt: new Date(),
        payments: { create: [{ userId: a.id, shareUnits: sh(10), amountCents: usd(90) }] },
      },
    });
    await expect(payDistribution({ actorId: admin.id, distributionId: dist.id, idempotencyKey: key() })).rejects.toBeInstanceOf(DomainError);
    expect((await walletOf(a.id)).availableCents).toBe(0n);
    await prisma.dividendDistribution.delete({ where: { id: dist.id } });

    // Paying uses the caller's clock: not at the record date itself, only after it.
    await saveFinancials({ actorId: admin.id, propertyId: property.id, month: JAN, data: financials({ grossRentCents: usd(100) }) });
    const jan = await previewDistribution({ actorId: admin.id, propertyId: property.id, month: JAN });
    await approveDistribution({ actorId: admin.id, distributionId: jan.id });
    await expect(payDistribution({ actorId: admin.id, distributionId: jan.id, idempotencyKey: key(), now: jan.recordDate })).rejects.toThrow(/record date for this dividend has not passed/);
    await payDistribution({ actorId: admin.id, distributionId: jan.id, idempotencyKey: key(), now: new Date(jan.recordDate.getTime() + 1) });
    expect((await walletOf(a.id)).availableCents).toBe(usd(90));
    await expectReconciled();
  });

  it("rejects invalid month strings with a domain error", async () => {
    const a = await createUser();
    const property = await createTradingProperty({ holders: [[a, 10]], fundedAt: FUNDED_AT });
    for (const month of ["2025-13", "2025-00", "2025-1", "garbage", ""]) {
      await expect(saveFinancials({ actorId: admin.id, propertyId: property.id, month, data: financials({ grossRentCents: usd(100) }) })).rejects.toBeInstanceOf(DomainError);
      await prisma.monthlyFinancials.upsert({
        where: { propertyId_month: { propertyId: property.id, month } },
        create: { propertyId: property.id, month, ...financials({ grossRentCents: usd(100) }), netIncomeCents: usd(100) },
        update: {},
      });
      await expect(previewDistribution({ actorId: admin.id, propertyId: property.id, month })).rejects.toBeInstanceOf(DomainError);
    }
    expect(await prisma.dividendDistribution.count()).toBe(0);
  });
});

function monthOf(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
