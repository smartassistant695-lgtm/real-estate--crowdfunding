import "server-only";
import { Prisma, PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

export type Tx = Prisma.TransactionClient;

/** An error whose message is safe and useful to show to the person who caused it. */
export class DomainError extends Error {
  constructor(message: string, readonly field?: string) {
    super(message);
    this.name = "DomainError";
  }
}

const RETRYABLE = new Set(["P2034", "40001", "40P01"]);
function isRetryable(e: unknown): boolean {
  if (e instanceof Prisma.PrismaClientKnownRequestError) {
    if (RETRYABLE.has(e.code)) return true;
    const meta = e.meta as { code?: string } | undefined;
    return !!meta?.code && RETRYABLE.has(meta.code);
  }
  return e instanceof Error && /deadlock detected|could not serialize/i.test(e.message);
}

/**
 * Run a financial transaction. Row locks (SELECT … FOR UPDATE) are taken inside `fn`.
 * Deadlocks and serialization failures are retried a few times; everything else propagates
 * and rolls the whole transaction back.
 */
export async function runTx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  let attempt = 0;
  for (;;) {
    try {
      return await prisma.$transaction(fn, { maxWait: 10_000, timeout: 30_000 });
    } catch (e) {
      if (attempt++ < 3 && isRetryable(e)) {
        await new Promise((r) => setTimeout(r, 25 * attempt + Math.random() * 50));
        continue;
      }
      throw e;
    }
  }
}

type WalletRow = { id: string; userId: string; availableCents: bigint; heldCents: bigint };

/** Lock wallets FOR UPDATE, always in user-id order so two transactions cannot deadlock on them. */
export async function lockWallets(tx: Tx, userIds: readonly string[]): Promise<Map<string, WalletRow>> {
  const ids = [...new Set(userIds)].sort();
  const out = new Map<string, WalletRow>();
  if (ids.length === 0) return out;
  const rows = await tx.$queryRaw<WalletRow[]>`
    SELECT "id", "userId", "availableCents", "heldCents" FROM "Wallet"
    WHERE "userId" IN (${Prisma.join(ids)}) ORDER BY "userId" FOR UPDATE`;
  for (const r of rows) out.set(r.userId, r);
  for (const id of ids) if (!out.has(id)) throw new DomainError("Wallet not found.");
  return out;
}

/** Lock a property row. Everything that changes a property's shares or order book takes this first. */
export async function lockProperty(tx: Tx, propertyId: string) {
  await tx.$queryRaw`SELECT "id" FROM "Property" WHERE "id" = ${propertyId} FOR UPDATE`;
  const p = await tx.property.findUnique({ where: { id: propertyId } });
  if (!p) throw new DomainError("Property not found.");
  return p;
}

/**
 * Idempotency. Returns the stored result if this key has already completed, otherwise null.
 * The insert happens inside the caller's transaction: a concurrent duplicate blocks here until
 * the first commits (then sees its result) or rolls back (then proceeds).
 */
export async function claimIdempotencyKey(tx: Tx, key: string, userId: string, action: string): Promise<unknown | null> {
  const inserted = await tx.$queryRaw<{ key: string }[]>`
    INSERT INTO "IdempotencyKey" ("key", "userId", "action", "createdAt")
    VALUES (${key}, ${userId}, ${action}, now())
    ON CONFLICT ("key") DO NOTHING RETURNING "key"`;
  if (inserted.length > 0) return null;
  const existing = await tx.idempotencyKey.findUnique({ where: { key } });
  if (!existing || existing.userId !== userId || existing.action !== action) {
    throw new DomainError("This request could not be processed. Refresh the page and try again.");
  }
  return existing.result ?? { replayed: true };
}

export async function storeIdempotentResult(tx: Tx, key: string, result: unknown): Promise<void> {
  await tx.idempotencyKey.update({ where: { key }, data: { result: toJson(result) as Prisma.InputJsonValue } });
}

/** JSON-safe copy: bigint → string, Date → ISO string. For audit entries and idempotent results. */
export function toJson(value: unknown): unknown {
  return JSON.parse(
    JSON.stringify(value ?? null, (_k, v) => (typeof v === "bigint" ? v.toString() : v)),
  );
}
