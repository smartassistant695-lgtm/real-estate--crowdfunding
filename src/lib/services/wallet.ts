import "server-only";
import { claimIdempotencyKey, DomainError, lockWallets, prisma, runTx, storeIdempotentResult, type Tx } from "@/lib/db";
import { formatCents } from "@/lib/domain/money";
import { providers } from "@/lib/providers";
import { audit } from "./audit";
import { postLedger } from "./ledger";

export const MAX_DEPOSIT_CENTS = 2_500_000n; // $25,000 per simulated transfer

export async function deposit(input: { userId: string; amountCents: bigint; idempotencyKey: string; ipAddress?: string | null }) {
  if (input.amountCents <= 0n) throw new DomainError("Enter an amount greater than $0.", "amount");
  if (input.amountCents > MAX_DEPOSIT_CENTS) throw new DomainError(`The most you can add at once is ${formatCents(MAX_DEPOSIT_CENTS, { whole: true })}.`, "amount");
  return runTx(async (tx) => {
    const replay = await claimIdempotencyKey(tx, input.idempotencyKey, input.userId, "deposit");
    if (replay) return { replayed: true };
    // The provider is called only after this request's key is claimed, and with the same key, so a
    // replay never starts a second transfer. A live ACH provider settles days later: the real
    // adapter must record a PENDING transfer here and credit the wallet from its webhook instead.
    const transfer = await providers.payments.initiateDeposit(input);
    if (!transfer.ok) throw new DomainError(transfer.error);
    await lockWallets(tx, [input.userId]);
    await tx.wallet.update({ where: { userId: input.userId }, data: { availableCents: { increment: input.amountCents } } });
    await tx.user.updateMany({ where: { id: input.userId, fundedAt: null }, data: { fundedAt: new Date() } });
    await postLedger(tx, transfer.transferId, [
      { account: "USER_WALLET", userId: input.userId, type: "DEPOSIT", amountCents: input.amountCents, memo: "Simulated deposit from linked bank" },
      { account: "EXTERNAL", type: "DEPOSIT", amountCents: -input.amountCents, memo: `Simulated bank transfer in (${providers.payments.name})` },
    ]);
    await audit(tx, { actorId: input.userId, action: "wallet.deposit", entityType: "Wallet", entityId: input.userId, after: { amountCents: input.amountCents }, ipAddress: input.ipAddress });
    await storeIdempotentResult(tx, input.idempotencyKey, { ok: true });
    return { replayed: false };
  });
}

export async function withdraw(input: { userId: string; amountCents: bigint; idempotencyKey: string; ipAddress?: string | null }) {
  if (input.amountCents <= 0n) throw new DomainError("Enter an amount greater than $0.", "amount");
  return runTx(async (tx) => {
    const replay = await claimIdempotencyKey(tx, input.idempotencyKey, input.userId, "withdraw");
    if (replay) return { replayed: true };
    const wallet = (await lockWallets(tx, [input.userId])).get(input.userId)!;
    if (wallet.availableCents < input.amountCents) {
      throw new DomainError(`You have ${formatCents(wallet.availableCents)} available to withdraw. Cash held for open buy orders cannot be withdrawn.`, "amount");
    }
    // Same key as the claim above, so a retried transaction cannot send the money twice. A live
    // provider needs the PENDING-then-webhook pattern described in deposit().
    const transfer = await providers.payments.initiateWithdrawal(input);
    if (!transfer.ok) throw new DomainError(transfer.error);
    await tx.wallet.update({ where: { userId: input.userId }, data: { availableCents: { decrement: input.amountCents } } });
    await postLedger(tx, transfer.transferId, [
      { account: "USER_WALLET", userId: input.userId, type: "WITHDRAWAL", amountCents: -input.amountCents, memo: "Simulated withdrawal to linked bank" },
      { account: "EXTERNAL", type: "WITHDRAWAL", amountCents: input.amountCents, memo: `Simulated bank transfer out (${providers.payments.name})` },
    ]);
    await audit(tx, { actorId: input.userId, action: "wallet.withdraw", entityType: "Wallet", entityId: input.userId, after: { amountCents: input.amountCents }, ipAddress: input.ipAddress });
    await storeIdempotentResult(tx, input.idempotencyKey, { ok: true });
    return { replayed: false };
  });
}

/** Admin-only correction. Always audited, always balanced against EXTERNAL. */
export async function adjust(input: { actorId: string; userId: string; amountCents: bigint; memo: string; idempotencyKey: string; ipAddress?: string | null }) {
  if (input.amountCents === 0n) throw new DomainError("Adjustment cannot be zero.");
  return runTx(async (tx) => {
    if (await claimIdempotencyKey(tx, input.idempotencyKey, input.actorId, "adjust")) return;
    const target = await tx.user.findUnique({ where: { id: input.userId }, select: { role: true } });
    if (target?.role !== "INVESTOR") throw new DomainError("Only investor wallets can be adjusted.");
    const wallet = (await lockWallets(tx, [input.userId])).get(input.userId)!;
    if (wallet.availableCents + input.amountCents < 0n) throw new DomainError("Adjustment would make the balance negative.");
    await tx.wallet.update({ where: { userId: input.userId }, data: { availableCents: { increment: input.amountCents } } });
    const ref = `adj_${input.idempotencyKey}`;
    await postLedger(tx, ref, [
      { account: "USER_WALLET", userId: input.userId, type: "ADJUSTMENT", amountCents: input.amountCents, memo: input.memo },
      { account: "EXTERNAL", type: "ADJUSTMENT", amountCents: -input.amountCents, memo: `Admin adjustment: ${input.memo}` },
    ]);
    await storeIdempotentResult(tx, input.idempotencyKey, { ok: true });
    await audit(tx, { actorId: input.actorId, action: "wallet.adjust", entityType: "Wallet", entityId: input.userId, before: { availableCents: wallet.availableCents }, after: { amountCents: input.amountCents, memo: input.memo }, ipAddress: input.ipAddress });
  });
}

/**
 * Cash a user has put into buying shares in the current calendar year (UTC).
 * Offering purchases count by the year they were made, unless refunded (a refund in January of a
 * December purchase must not free up room in January). Secondary buys count by the year they
 * settled. Cash held for open buy orders is added by the callers, which hold the wallet lock.
 */
export async function investedThisYear(tx: Tx | typeof prisma, userId: string, now = new Date()): Promise<bigint> {
  const from = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
  const to = new Date(Date.UTC(now.getUTCFullYear() + 1, 0, 1));
  const [primary, trades] = await Promise.all([
    tx.primaryPurchase.aggregate({ where: { userId, refundedAt: null, createdAt: { gte: from, lt: to } }, _sum: { totalCents: true } }),
    tx.ledgerEntry.aggregate({ where: { userId, account: "USER_WALLET", type: "TRADE_BUY", createdAt: { gte: from, lt: to } }, _sum: { amountCents: true } }),
  ]);
  return (primary._sum.totalCents ?? 0n) - (trades._sum.amountCents ?? 0n);
}
