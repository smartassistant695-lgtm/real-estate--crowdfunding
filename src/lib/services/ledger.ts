import "server-only";
import type { LedgerAccount, LedgerType } from "@prisma/client";
import { prisma, type Tx } from "@/lib/db";

export type LedgerLine = {
  account: LedgerAccount;
  userId?: string | null;
  propertyId?: string | null;
  type: LedgerType;
  amountCents: bigint;
  shareUnits?: bigint | null;
  memo: string;
};

/**
 * Write the entries for one event. They must balance: cash that enters one account leaves
 * another, so the lines sum to zero. An unbalanced event throws and rolls back the transaction.
 */
export async function postLedger(tx: Tx, referenceId: string, lines: readonly LedgerLine[], createdAt?: Date): Promise<void> {
  const live = lines.filter((l) => l.amountCents !== 0n || (l.shareUnits ?? 0n) !== 0n);
  const sum = live.reduce((a, l) => a + l.amountCents, 0n);
  if (sum !== 0n) throw new Error(`Unbalanced ledger event ${referenceId}: off by ${sum} cents`);
  for (const l of live) {
    if (l.account === "USER_WALLET" && !l.userId) throw new Error("USER_WALLET entry needs a userId");
  }
  if (live.length === 0) return;
  await tx.ledgerEntry.createMany({
    data: live.map((l) => ({
      account: l.account,
      userId: l.userId ?? null,
      propertyId: l.propertyId ?? null,
      type: l.type,
      amountCents: l.amountCents,
      shareUnits: l.shareUnits ?? null,
      referenceId,
      memo: l.memo,
      ...(createdAt ? { createdAt } : {}),
    })),
  });
}

/**
 * Who held how many units of a property at a moment in time, rebuilt from the ledger.
 * This is what "holders at the record date" means for dividends and votes.
 */
export async function holdersAt(tx: Tx, propertyId: string, at: Date): Promise<{ userId: string; units: bigint }[]> {
  const rows = await tx.ledgerEntry.groupBy({
    by: ["userId"],
    where: { propertyId, account: "USER_WALLET", shareUnits: { not: null }, createdAt: { lte: at } },
    _sum: { shareUnits: true },
  });
  return rows
    .filter((r): r is typeof r & { userId: string } => r.userId !== null && (r._sum.shareUnits ?? 0n) > 0n)
    .map((r) => ({ userId: r.userId, units: r._sum.shareUnits ?? 0n }))
    .sort((a, b) => (a.userId < b.userId ? -1 : 1));
}

export type ReconcileReport = { ok: boolean; checkedAt: Date; ledgerSumCents: bigint; issues: string[] };

/**
 * Prove the books agree:
 *  1. the whole ledger sums to zero;
 *  2. every wallet (available + held) equals the sum of that user's wallet entries;
 *  3. every holding equals the sum of that user's share movements, and equals its lots;
 *  4. every liquidity reserve and rounding carry equals its ledger account.
 */
export async function reconcile(): Promise<ReconcileReport> {
  const issues: string[] = [];
  const total = await prisma.ledgerEntry.aggregate({ _sum: { amountCents: true } });
  const ledgerSumCents = total._sum.amountCents ?? 0n;
  if (ledgerSumCents !== 0n) issues.push(`Ledger does not sum to zero (off by ${ledgerSumCents} cents).`);

  const [wallets, walletSums] = await Promise.all([
    prisma.wallet.findMany(),
    prisma.ledgerEntry.groupBy({ by: ["userId"], where: { account: "USER_WALLET" }, _sum: { amountCents: true } }),
  ]);
  const byUser = new Map(walletSums.map((s) => [s.userId, s._sum.amountCents ?? 0n]));
  for (const w of wallets) {
    const expected = byUser.get(w.userId) ?? 0n;
    if (w.availableCents + w.heldCents !== expected) {
      issues.push(`Wallet ${w.userId}: balance ${w.availableCents + w.heldCents} ≠ ledger ${expected}.`);
    }
  }

  const [holdings, unitSums, lotSums] = await Promise.all([
    prisma.holding.findMany(),
    prisma.ledgerEntry.groupBy({
      by: ["userId", "propertyId"],
      where: { account: "USER_WALLET", shareUnits: { not: null } },
      _sum: { shareUnits: true },
    }),
    prisma.holdingLot.groupBy({ by: ["userId", "propertyId"], _sum: { remainingUnits: true, costBasisCents: true } }),
  ]);
  const unitKey = (u: string | null, p: string | null) => `${u}:${p}`;
  const ledgerUnits = new Map(unitSums.map((s) => [unitKey(s.userId, s.propertyId), s._sum.shareUnits ?? 0n]));
  const lots = new Map(lotSums.map((s) => [unitKey(s.userId, s.propertyId), s._sum]));
  for (const h of holdings) {
    const k = unitKey(h.userId, h.propertyId);
    if ((ledgerUnits.get(k) ?? 0n) !== h.shareUnits) issues.push(`Holding ${k}: ${h.shareUnits} units ≠ ledger ${ledgerUnits.get(k) ?? 0n}.`);
    if ((lots.get(k)?.remainingUnits ?? 0n) !== h.shareUnits) issues.push(`Holding ${k}: units do not match lots.`);
    if ((lots.get(k)?.costBasisCents ?? 0n) !== h.costBasisCents) issues.push(`Holding ${k}: cost basis does not match lots.`);
    ledgerUnits.delete(k);
  }
  for (const [k, v] of ledgerUnits) if (v !== 0n) issues.push(`Ledger shows ${v} units for ${k} but there is no holding.`);

  const [props, reserves, accountSums] = await Promise.all([
    prisma.property.findMany({ select: { id: true, slug: true, dividendCarryCents: true, soldUnits: true, retiredUnits: true, status: true } }),
    prisma.liquidityReserve.findMany(),
    prisma.ledgerEntry.groupBy({
      by: ["account", "propertyId"],
      where: { account: { in: ["LIQUIDITY_RESERVE", "PROPERTY_OPERATING"] } },
      _sum: { amountCents: true },
    }),
  ]);
  const acct = new Map(accountSums.map((s) => [`${s.account}:${s.propertyId}`, s._sum.amountCents ?? 0n]));
  for (const r of reserves) {
    if ((acct.get(`LIQUIDITY_RESERVE:${r.propertyId}`) ?? 0n) !== r.balanceCents) issues.push(`Reserve for ${r.propertyId} does not match the ledger.`);
  }
  const heldByProperty = new Map<string, bigint>();
  for (const h of holdings) heldByProperty.set(h.propertyId, (heldByProperty.get(h.propertyId) ?? 0n) + h.shareUnits);
  for (const p of props) {
    if ((acct.get(`PROPERTY_OPERATING:${p.id}`) ?? 0n) !== p.dividendCarryCents) issues.push(`Rounding carry for ${p.slug} does not match the ledger.`);
    const outstanding = p.status === "SOLD" || p.status === "CANCELLED" ? 0n : p.soldUnits - p.retiredUnits;
    if ((heldByProperty.get(p.id) ?? 0n) !== outstanding) issues.push(`Shares outstanding for ${p.slug} do not match holdings.`);
  }
  return { ok: issues.length === 0, checkedAt: new Date(), ledgerSumCents, issues };
}
