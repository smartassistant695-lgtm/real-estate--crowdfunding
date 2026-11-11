import "server-only";
import { claimIdempotencyKey, DomainError, lockWallets, runTx, storeIdempotentResult } from "@/lib/db";
import { formatCents } from "@/lib/domain/money";
import { providers } from "@/lib/providers";
import { audit } from "./audit";
import { postLedger } from "./ledger";

export const MAX_DEPOSIT_CENTS = 2_500_000n; // $25,000 per simulated transfer

export async function deposit(input: { userId: string; amountCents: bigint; idempotencyKey: string; ipAddress?: string | null }) {
  if (input.amountCents <= 0n) throw new DomainError("Enter an amount greater than $0.", "amount");
  if (input.amountCents > MAX_DEPOSIT_CENTS) throw new DomainError(`The most you can add at once is ${formatCents(MAX_DEPOSIT_CENTS, { whole: true })}.`, "amount");
  const transfer = await providers.payments.initiateDeposit(input);
  if (!transfer.ok) throw new DomainError(transfer.error);

  return runTx(async (tx) => {
    const replay = await claimIdempotencyKey(tx, input.idempotencyKey, input.userId, "deposit");
    if (replay) return { replayed: true };
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
export async function adjust(input: { actorId: string; userId: string; amountCents: bigint; memo: string; ipAddress?: string | null }) {
  if (input.amountCents === 0n) throw new DomainError("Adjustment cannot be zero.");
  return runTx(async (tx) => {
    const wallet = (await lockWallets(tx, [input.userId])).get(input.userId)!;
    if (wallet.availableCents + input.amountCents < 0n) throw new DomainError("Adjustment would make the balance negative.");
    await tx.wallet.update({ where: { userId: input.userId }, data: { availableCents: { increment: input.amountCents } } });
    const ref = `adj_${Date.now()}_${input.userId.slice(-6)}`;
    await postLedger(tx, ref, [
      { account: "USER_WALLET", userId: input.userId, type: "ADJUSTMENT", amountCents: input.amountCents, memo: input.memo },
      { account: "EXTERNAL", type: "ADJUSTMENT", amountCents: -input.amountCents, memo: `Admin adjustment: ${input.memo}` },
    ]);
    await audit(tx, { actorId: input.actorId, action: "wallet.adjust", entityType: "Wallet", entityId: input.userId, before: { availableCents: wallet.availableCents }, after: { amountCents: input.amountCents, memo: input.memo }, ipAddress: input.ipAddress });
  });
}

/**
 * Cash a user has put into buying shares in the current calendar year (UTC), net of refunds.
 * Read from the ledger, so it cannot drift from what actually happened.
 */
export async function investedThisYear(tx: Parameters<Parameters<typeof runTx>[0]>[0], userId: string, now = new Date()): Promise<bigint> {
  const from = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
  const sum = await tx.ledgerEntry.aggregate({
    where: { userId, account: "USER_WALLET", type: { in: ["PRIMARY_PURCHASE", "TRADE_BUY", "REFUND"] }, createdAt: { gte: from } },
    _sum: { amountCents: true },
  });
  const net = -(sum._sum.amountCents ?? 0n);
  return net > 0n ? net : 0n;
}
