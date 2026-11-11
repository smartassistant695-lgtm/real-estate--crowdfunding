import "server-only";
import { BRAND } from "@/config/brand";
import { claimIdempotencyKey, DomainError, lockProperty, lockWallets, prisma, runTx, storeIdempotentResult, type Tx } from "@/lib/db";
import { formatCents, formatUnits, primaryCost, unitsForAmount } from "@/lib/domain/money";
import { providers } from "@/lib/providers";
import { getSettings } from "@/lib/settings";
import { audit } from "./audit";
import { postLedger } from "./ledger";
import { notify, type Notice } from "./notifications";
import { investedThisYear } from "./wallet";

export type PurchaseQuote = {
  units: bigint;
  costCents: bigint;
  feeCents: bigint;
  priceCents: bigint;
  remainingUnits: bigint;
  /** True when the amount was trimmed to the shares left in the offering. */
  cappedToRemaining: boolean;
};

/**
 * Price a purchase. Pure given its inputs; the server calls it again inside the transaction,
 * so nothing the browser sends about price or share count is trusted.
 */
export function quotePurchase(input: {
  amountCents?: bigint;
  units?: bigint;
  priceCents: bigint;
  totalUnits: bigint;
  soldUnits: bigint;
}): PurchaseQuote {
  const remainingUnits = input.totalUnits - input.soldUnits;
  let units = input.units ?? unitsForAmount(input.amountCents ?? 0n, input.priceCents);
  let cappedToRemaining = false;
  if (units > remainingUnits) {
    units = remainingUnits;
    cappedToRemaining = true;
  }
  return { units, costCents: primaryCost(units, input.priceCents), feeCents: 0n, priceCents: input.priceCents, remainingUnits, cappedToRemaining };
}

export async function buyPrimary(input: {
  userId: string;
  propertyId: string;
  amountCents?: bigint;
  units?: bigint;
  idempotencyKey: string;
  ipAddress?: string | null;
  now?: Date;
}): Promise<{ purchaseId: string; units: bigint; costCents: bigint; funded: boolean; replayed: boolean }> {
  const now = input.now ?? new Date();
  let afterCommit: (() => Promise<void>) | undefined;

  const result = await runTx(async (tx) => {
    const replay = (await claimIdempotencyKey(tx, input.idempotencyKey, input.userId, "buyPrimary")) as
      | { purchaseId: string; units: string; costCents: string; funded: boolean }
      | null;
    if (replay) return { purchaseId: replay.purchaseId, units: BigInt(replay.units), costCents: BigInt(replay.costCents), funded: replay.funded, replayed: true };

    const settings = await getSettings(tx);
    const property = await lockProperty(tx, input.propertyId);
    const user = await tx.user.findUniqueOrThrow({ where: { id: input.userId } });

    if (user.kycStatus !== "APPROVED") throw new DomainError("Your identity check must be approved before you can invest.");
    if (!user.riskDisclosureAcceptedAt) throw new DomainError("Please read and accept the risk disclosure before investing.");
    if (property.status !== "FUNDING") throw new DomainError("This offering is not open for investment.");
    if (property.fundingDeadline && property.fundingDeadline.getTime() <= now.getTime()) throw new DomainError("This offering has closed.");

    const quote = quotePurchase({
      amountCents: input.amountCents,
      units: input.units,
      priceCents: property.offeringPricePerShareCents,
      totalUnits: property.totalUnits,
      soldUnits: property.soldUnits,
    });
    if (quote.remainingUnits <= 0n) throw new DomainError("This offering is fully funded.");
    if (quote.cappedToRemaining && input.units !== undefined && input.units > quote.remainingUnits) {
      throw new DomainError(`Only ${formatUnits(quote.remainingUnits)} shares are left in this offering.`, "amount");
    }
    if (quote.units <= 0n) throw new DomainError("That amount is too small to buy any shares.", "amount");
    // The minimum applies unless this purchase takes the last shares of the offering.
    const takesTheRest = quote.units === quote.remainingUnits;
    if (quote.costCents < settings.minInvestmentCents && !takesTheRest) {
      throw new DomainError(`The minimum investment is ${formatCents(settings.minInvestmentCents, { whole: true })}.`, "amount");
    }

    const invested = await investedThisYear(tx, input.userId, now);
    if (invested + quote.costCents > user.annualInvestmentLimitCents) {
      const room = user.annualInvestmentLimitCents > invested ? user.annualInvestmentLimitCents - invested : 0n;
      throw new DomainError(
        `This would take you over your annual investment limit of ${formatCents(user.annualInvestmentLimitCents, { whole: true })}. You can invest ${formatCents(room)} more this year.`,
        "amount",
      );
    }

    const wallet = (await lockWallets(tx, [input.userId])).get(input.userId)!;
    if (wallet.availableCents < quote.costCents) {
      throw new DomainError(`You have ${formatCents(wallet.availableCents)} available. Add funds to your wallet to invest ${formatCents(quote.costCents)}.`, "amount");
    }

    await tx.wallet.update({ where: { userId: input.userId }, data: { availableCents: { decrement: quote.costCents } } });
    const purchase = await tx.primaryPurchase.create({
      data: { userId: input.userId, propertyId: property.id, shareUnits: quote.units, priceCents: quote.priceCents, totalCents: quote.costCents, createdAt: now },
    });
    await tx.holdingLot.create({
      data: { userId: input.userId, propertyId: property.id, source: "PRIMARY", originalUnits: quote.units, remainingUnits: quote.units, costBasisCents: quote.costCents, acquiredAt: now },
    });
    await tx.holding.upsert({
      where: { userId_propertyId: { userId: input.userId, propertyId: property.id } },
      create: { userId: input.userId, propertyId: property.id, shareUnits: quote.units, costBasisCents: quote.costCents },
      update: { shareUnits: { increment: quote.units }, costBasisCents: { increment: quote.costCents } },
    });
    await postLedger(tx, purchase.id, [
      { account: "USER_WALLET", userId: input.userId, propertyId: property.id, type: "PRIMARY_PURCHASE", amountCents: -quote.costCents, shareUnits: quote.units, memo: `Bought ${formatUnits(quote.units)} shares of ${property.name} at ${formatCents(quote.priceCents)}` },
      { account: "PROPERTY_ESCROW", propertyId: property.id, type: "PRIMARY_PURCHASE", amountCents: quote.costCents, memo: "Offering proceeds held in escrow" },
    ], now);

    const soldUnits = property.soldUnits + quote.units;
    const funded = soldUnits === property.totalUnits;
    const notices: Notice[] = [
      { userId: input.userId, type: "PURCHASE_CONFIRMED", title: "Purchase confirmed", body: `You bought ${formatUnits(quote.units)} shares of ${property.name} for ${formatCents(quote.costCents)}.`, href: "/portfolio" },
    ];
    if (funded) {
      notices.push(...(await markFunded(tx, property.id, property.name, property.slug, now)));
      await tx.property.update({ where: { id: property.id }, data: { soldUnits, status: "FUNDED", fundedAt: now } });
    } else {
      await tx.property.update({ where: { id: property.id }, data: { soldUnits } });
    }

    await audit(tx, { actorId: input.userId, action: "purchase.primary", entityType: "PrimaryPurchase", entityId: purchase.id, after: { propertyId: property.id, units: quote.units, costCents: quote.costCents, funded }, ipAddress: input.ipAddress });
    afterCommit = await notify(tx, notices);
    const out = { purchaseId: purchase.id, units: quote.units, costCents: quote.costCents, funded };
    await storeIdempotentResult(tx, input.idempotencyKey, out);
    return { ...out, replayed: false };
  });

  if (!result.replayed) {
    await providers.custody.recordIssuance({ userId: input.userId, propertyId: input.propertyId, units: result.units, reference: result.purchaseId });
    await afterCommit?.();
  }
  return result;
}

/**
 * The last share was sold. Release escrow to close on the home, open the liquidity reserve,
 * and tell every investor. The caller updates the property's status.
 */
async function markFunded(tx: Tx, propertyId: string, name: string, slug: string, now: Date): Promise<Notice[]> {
  const settings = await getSettings(tx);
  const escrow = await tx.ledgerEntry.aggregate({ where: { propertyId, account: "PROPERTY_ESCROW" }, _sum: { amountCents: true } });
  const raised = escrow._sum.amountCents ?? 0n;
  await postLedger(tx, `funded_${propertyId}`, [
    { account: "PROPERTY_ESCROW", propertyId, type: "ADJUSTMENT", amountCents: -raised, memo: "Escrow released at closing" },
    { account: "EXTERNAL", propertyId, type: "ADJUSTMENT", amountCents: raised, memo: `Paid out to purchase the property, cover closing costs and fund its repair reserve (${BRAND.name} demo)` },
  ], now);
  await tx.liquidityReserve.upsert({
    where: { propertyId },
    create: { propertyId, monthlyCapCents: settings.buybackMonthlyCapCents, discountBps: settings.buybackDiscountBps },
    update: {},
  });
  await audit(tx, { actorId: null, action: "property.funded", entityType: "Property", entityId: propertyId, after: { raisedCents: raised } });
  const holders = await tx.holding.findMany({ where: { propertyId, shareUnits: { gt: 0n } }, select: { userId: true } });
  return holders.map((h) => ({
    userId: h.userId,
    type: "PROPERTY_FUNDED" as const,
    title: `${name} is fully funded`,
    body: `Every share of ${name} has been sold. The purchase can now close, and rent will start to be distributed monthly once a tenant's first full month is reported.`,
    href: `/properties/${slug}`,
  }));
}

/**
 * Job: any offering past its deadline without selling out is cancelled and every investor is
 * refunded in full. Safe to run repeatedly.
 */
export async function refundExpiredOfferings(now = new Date()): Promise<{ cancelled: string[] }> {
  const due = await prisma.property.findMany({ where: { status: "FUNDING", fundingDeadline: { lte: now } }, select: { id: true } });
  const cancelled: string[] = [];
  for (const { id } of due) {
    let afterCommit: (() => Promise<void>) | undefined;
    const done = await runTx(async (tx) => {
      const property = await lockProperty(tx, id);
      if (property.status !== "FUNDING" || !property.fundingDeadline || property.fundingDeadline.getTime() > now.getTime()) return false;
      if (property.soldUnits === property.totalUnits) return false;

      const purchases = await tx.primaryPurchase.findMany({ where: { propertyId: id, refundedAt: null }, orderBy: { createdAt: "asc" } });
      const byUser = new Map<string, { cents: bigint; units: bigint }>();
      for (const p of purchases) {
        const cur = byUser.get(p.userId) ?? { cents: 0n, units: 0n };
        byUser.set(p.userId, { cents: cur.cents + p.totalCents, units: cur.units + p.shareUnits });
      }
      await lockWallets(tx, [...byUser.keys()]);
      const lines = [];
      const notices: Notice[] = [];
      let total = 0n;
      for (const [userId, r] of byUser) {
        await tx.wallet.update({ where: { userId }, data: { availableCents: { increment: r.cents } } });
        lines.push({ account: "USER_WALLET" as const, userId, propertyId: id, type: "REFUND" as const, amountCents: r.cents, shareUnits: -r.units, memo: `Refund: ${property.name} did not reach full funding` });
        total += r.cents;
        notices.push({ userId, type: "OFFERING_REFUNDED", title: `${property.name}: offering cancelled, refund issued`, body: `${property.name} did not sell every share by its deadline, so the offering was cancelled. ${formatCents(r.cents)} is back in your wallet.`, href: "/wallet" });
      }
      lines.push({ account: "PROPERTY_ESCROW" as const, propertyId: id, type: "REFUND" as const, amountCents: -total, memo: "Escrow returned to investors" });
      await postLedger(tx, `refund_${id}`, lines, now);
      await tx.primaryPurchase.updateMany({ where: { propertyId: id, refundedAt: null }, data: { refundedAt: now } });
      await tx.holdingLot.updateMany({ where: { propertyId: id }, data: { remainingUnits: 0n, costBasisCents: 0n } });
      await tx.holding.updateMany({ where: { propertyId: id }, data: { shareUnits: 0n, costBasisCents: 0n, reservedUnits: 0n } });
      await tx.property.update({ where: { id }, data: { status: "CANCELLED", soldUnits: 0n } });
      await audit(tx, { actorId: null, action: "offering.cancelled_refunded", entityType: "Property", entityId: id, before: { soldUnits: property.soldUnits }, after: { refundedCents: total, investors: byUser.size } });
      afterCommit = await notify(tx, notices);
      return true;
    });
    if (done) {
      cancelled.push(id);
      await afterCommit?.();
    }
  }
  return { cancelled };
}
