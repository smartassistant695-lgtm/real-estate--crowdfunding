import "server-only";
import { claimIdempotencyKey, DomainError, lockProperty, lockWallets, prisma, runTx, storeIdempotentResult, type Tx } from "@/lib/db";
import { netIncome, planDistribution } from "@/lib/domain/dividends";
import { formatCents } from "@/lib/domain/money";
import { endOfMonth, monthKey, monthLabel } from "@/lib/domain/trading-rules";
import { getSettings } from "@/lib/settings";
import { audit } from "./audit";
import { holdersAt, postLedger, type LedgerLine } from "./ledger";
import { notify, type Notice } from "./notifications";

export type FinancialsInput = {
  grossRentCents: bigint;
  vacancyLossCents: bigint;
  managementFeeCents: bigint;
  maintenanceCents: bigint;
  taxesCents: bigint;
  insuranceCents: bigint;
  hoaCents: bigint;
  otherExpensesCents: bigint;
  occupancyRateBps: number;
  notes: string;
};

/** Save a month's income statement. Net income is always computed here, never typed in. */
export async function saveFinancials(input: { actorId: string; propertyId: string; month: string; data: FinancialsInput; ipAddress?: string | null }) {
  return runTx(async (tx) => {
    const paid = await tx.dividendDistribution.findUnique({ where: { propertyId_month: { propertyId: input.propertyId, month: input.month } } });
    if (paid && paid.status !== "DRAFT") throw new DomainError("This month's dividend is already approved or paid. Its financials can no longer be changed.");
    const before = await tx.monthlyFinancials.findUnique({ where: { propertyId_month: { propertyId: input.propertyId, month: input.month } } });
    const net = netIncome(input.data);
    const row = await tx.monthlyFinancials.upsert({
      where: { propertyId_month: { propertyId: input.propertyId, month: input.month } },
      create: { propertyId: input.propertyId, month: input.month, ...input.data, netIncomeCents: net },
      update: { ...input.data, netIncomeCents: net },
    });
    await audit(tx, { actorId: input.actorId, action: before ? "financials.update" : "financials.create", entityType: "MonthlyFinancials", entityId: row.id, before, after: row, ipAddress: input.ipAddress });
    if (paid) await buildDraft(tx, input.propertyId, input.month, input.actorId);
    return row;
  });
}

/** Create or refresh the DRAFT distribution for a month. Never touches an approved or paid one. */
async function buildDraft(tx: Tx, propertyId: string, month: string, actorId: string | null) {
  const property = await lockProperty(tx, propertyId);
  const financials = await tx.monthlyFinancials.findUnique({ where: { propertyId_month: { propertyId, month } } });
  if (!financials) throw new DomainError(`Enter ${monthLabel(month)} financials before previewing a dividend.`);
  const existing = await tx.dividendDistribution.findUnique({ where: { propertyId_month: { propertyId, month } } });
  if (existing && existing.status !== "DRAFT") return existing;

  const settings = await getSettings(tx);
  const recordDate = endOfMonth(month);
  const holders = await holdersAt(tx, propertyId, recordDate);
  const plan = planDistribution({ netIncomeCents: financials.netIncomeCents, carryInCents: property.dividendCarryCents, reserveBps: settings.reserveAllocationBps, holders });
  const data = {
    recordDate,
    netIncomeCents: plan.netIncomeCents,
    carryInCents: plan.carryInCents,
    reserveAllocationCents: plan.reserveAllocationCents,
    distributedCents: plan.distributedCents,
    perShareMicroCents: plan.perShareMicroCents,
    roundingRemainderCents: plan.roundingRemainderCents,
    outstandingUnits: plan.outstandingUnits,
  };
  const dist = existing
    ? await tx.dividendDistribution.update({ where: { id: existing.id }, data })
    : await tx.dividendDistribution.create({ data: { propertyId, month, ...data } });
  await tx.dividendPayment.deleteMany({ where: { distributionId: dist.id } });
  if (plan.payments.length > 0) {
    await tx.dividendPayment.createMany({
      data: plan.payments.map((p) => ({ distributionId: dist.id, userId: p.userId, shareUnits: p.units, amountCents: p.amountCents })),
    });
  }
  await audit(tx, { actorId, action: existing ? "dividend.draft_refreshed" : "dividend.draft_created", entityType: "DividendDistribution", entityId: dist.id, after: data });
  return dist;
}

export async function previewDistribution(input: { actorId: string | null; propertyId: string; month: string }) {
  return runTx((tx) => buildDraft(tx, input.propertyId, input.month, input.actorId));
}

export async function approveDistribution(input: { actorId: string; distributionId: string; ipAddress?: string | null }) {
  return runTx(async (tx) => {
    const found = await tx.dividendDistribution.findUnique({ where: { id: input.distributionId } });
    if (!found) throw new DomainError("Distribution not found.");
    // Refresh under the property lock so the approved figures reflect the current carry and holders.
    const dist = await buildDraft(tx, found.propertyId, found.month, input.actorId);
    if (dist.status !== "DRAFT") throw new DomainError("Only a draft can be approved.");
    const earlier = await tx.dividendDistribution.findFirst({ where: { propertyId: dist.propertyId, month: { lt: dist.month }, status: { not: "PAID" } } });
    if (earlier) throw new DomainError(`Pay ${monthLabel(earlier.month)} first. Dividends are paid in order so rounding carry-over stays correct.`);
    const updated = await tx.dividendDistribution.update({ where: { id: dist.id }, data: { status: "APPROVED", approvedById: input.actorId, approvedAt: new Date() } });
    await audit(tx, { actorId: input.actorId, action: "dividend.approved", entityType: "DividendDistribution", entityId: dist.id, before: { status: "DRAFT" }, after: { status: "APPROVED", distributedCents: dist.distributedCents }, ipAddress: input.ipAddress });
    return updated;
  });
}

/** Pay an APPROVED distribution into wallets. Nothing is ever paid without the approval step. */
export async function payDistribution(input: { actorId: string; distributionId: string; idempotencyKey: string; ipAddress?: string | null }) {
  let afterCommit: (() => Promise<void>) | undefined;
  const result = await runTx(async (tx) => {
    const replay = await claimIdempotencyKey(tx, input.idempotencyKey, input.actorId, "payDistribution");
    if (replay) return { replayed: true };
    const found = await tx.dividendDistribution.findUnique({ where: { id: input.distributionId } });
    if (!found) throw new DomainError("Distribution not found.");
    const property = await lockProperty(tx, found.propertyId);
    const dist = await tx.dividendDistribution.findUniqueOrThrow({ where: { id: input.distributionId }, include: { payments: true } });
    if (dist.status === "PAID") throw new DomainError("This dividend has already been paid.");
    if (dist.status !== "APPROVED") throw new DomainError("Approve the distribution before paying it.");
    if (dist.carryInCents !== property.dividendCarryCents) {
      throw new DomainError("The rounding carry-over changed since this was approved. Re-open the preview and approve again.");
    }
    const paidTotal = dist.payments.reduce((a, p) => a + p.amountCents, 0n);
    if (paidTotal !== dist.distributedCents) throw new Error("Distribution payments do not sum to the distributed total");

    const now = new Date();
    const label = monthLabel(dist.month);
    const income = dist.netIncomeCents > 0n ? dist.netIncomeCents : 0n;
    const lines: LedgerLine[] = [
      { account: "EXTERNAL", propertyId: property.id, type: "DIVIDEND", amountCents: -income, memo: `${label} net rental income received from ${property.propertyManagerName}` },
      { account: "PROPERTY_OPERATING", propertyId: property.id, type: "DIVIDEND", amountCents: income - dist.reserveAllocationCents - dist.distributedCents, memo: `${label} income in, less reserve allocation and payouts (balance is the rounding carry)` },
      { account: "LIQUIDITY_RESERVE", propertyId: property.id, type: "RESERVE_ALLOCATION", amountCents: dist.reserveAllocationCents, memo: `${label} allocation to liquidity reserve` },
    ];
    const paying = dist.payments.filter((p) => p.amountCents > 0n);
    await lockWallets(tx, paying.map((p) => p.userId));
    const notices: Notice[] = [];
    for (const p of paying) {
      await tx.wallet.update({ where: { userId: p.userId }, data: { availableCents: { increment: p.amountCents } } });
      lines.push({ account: "USER_WALLET", userId: p.userId, propertyId: property.id, type: "DIVIDEND", amountCents: p.amountCents, memo: `${label} rent dividend from ${property.name}` });
      notices.push({ userId: p.userId, type: "DIVIDEND_PAID", title: `${formatCents(p.amountCents)} dividend from ${property.name}`, body: `Your share of ${label} rent from ${property.name} is in your wallet: ${formatCents(p.amountCents)}.`, href: "/portfolio/activity" });
    }
    await postLedger(tx, dist.id, lines, now);
    if (dist.reserveAllocationCents > 0n) {
      const settings = await getSettings(tx);
      await tx.liquidityReserve.upsert({
        where: { propertyId: property.id },
        create: { propertyId: property.id, balanceCents: dist.reserveAllocationCents, monthlyCapCents: settings.buybackMonthlyCapCents, discountBps: settings.buybackDiscountBps },
        update: { balanceCents: { increment: dist.reserveAllocationCents } },
      });
    }
    await tx.property.update({ where: { id: property.id }, data: { dividendCarryCents: dist.roundingRemainderCents } });
    await tx.dividendDistribution.update({ where: { id: dist.id }, data: { status: "PAID", paidAt: now } });
    await audit(tx, { actorId: input.actorId, action: "dividend.paid", entityType: "DividendDistribution", entityId: dist.id, before: { status: "APPROVED" }, after: { status: "PAID", distributedCents: dist.distributedCents, reserveAllocationCents: dist.reserveAllocationCents, carryOutCents: dist.roundingRemainderCents, payees: paying.length }, ipAddress: input.ipAddress });
    afterCommit = await notify(tx, notices);
    await storeIdempotentResult(tx, input.idempotencyKey, { ok: true });
    return { replayed: false };
  });
  if (!result.replayed) await afterCommit?.();
  return result;
}

/**
 * Job (1st of each month): create DRAFT distributions for last month wherever financials have
 * been entered. Drafts wait for an admin; this never approves or pays.
 */
export async function createMonthlyDrafts(now = new Date()): Promise<{ month: string; created: string[]; missingFinancials: string[] }> {
  const month = monthKey(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 15)));
  const properties = await prisma.property.findMany({ where: { status: { in: ["FUNDED", "TRADING", "EXIT_VOTE"] } }, select: { id: true, slug: true } });
  const created: string[] = [];
  const missingFinancials: string[] = [];
  for (const p of properties) {
    const has = await prisma.monthlyFinancials.findUnique({ where: { propertyId_month: { propertyId: p.id, month } } });
    if (!has) {
      missingFinancials.push(p.slug);
      continue;
    }
    const existing = await prisma.dividendDistribution.findUnique({ where: { propertyId_month: { propertyId: p.id, month } } });
    if (existing) continue;
    await previewDistribution({ actorId: null, propertyId: p.id, month });
    created.push(p.slug);
  }
  return { month, created, missingFinancials };
}
