/**
 * Tools for deterministic concurrency tests: hold a row lock in a separate transaction so a
 * service call stops at a known point, then let it continue.
 */
import { prisma, type Tx } from "@/lib/db";

/** Run `lock` in its own transaction and keep that transaction open until `release()` is awaited. */
export async function holdLock(lock: (tx: Tx) => Promise<unknown>): Promise<{ release: () => Promise<void> }> {
  let release!: () => void;
  const released = new Promise<void>((r) => (release = r));
  let acquired!: () => void;
  let failed!: (e: unknown) => void;
  const ready = new Promise<void>((res, rej) => {
    acquired = res;
    failed = rej;
  });
  const done = prisma
    .$transaction(
      async (tx) => {
        await lock(tx);
        acquired();
        await released;
      },
      { maxWait: 10_000, timeout: 30_000 },
    )
    .catch((e) => failed(e));
  await ready;
  return {
    release: async () => {
      release();
      await done;
    },
  };
}

/** Number of sessions on this database currently waiting for a row/table lock. */
export async function lockWaiters(): Promise<number> {
  const rows = await prisma.$queryRaw<{ n: number }[]>`
    SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'`;
  return rows[0]?.n ?? 0;
}

/** Wait until at least `n` sessions are blocked on a lock, or `until()` is true. Throws after `timeoutMs`. */
export async function waitFor(cond: () => Promise<boolean> | boolean, timeoutMs = 5_000, what = "condition"): Promise<void> {
  const start = Date.now();
  for (;;) {
    if (await cond()) return;
    if (Date.now() - start > timeoutMs) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

/** Track whether a promise has settled, without awaiting it. */
export function track<T>(p: Promise<T>): { promise: Promise<T>; settled: () => boolean } {
  let done = false;
  const promise = p.finally(() => {
    done = true;
  });
  return { promise, settled: () => done };
}
