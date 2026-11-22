import "server-only";
import { headers } from "next/headers";
import { prisma } from "@/lib/db";

/**
 * Fixed-window rate limit stored in Postgres, so it holds across serverless instances.
 * Returns false when the caller is over the limit. One atomic statement per check.
 */
export async function rateLimit(key: string, limit: number, windowSeconds: number): Promise<boolean> {
  const rows = await prisma.$queryRaw<{ count: number }[]>`
    INSERT INTO "RateLimit" ("key", "count", "windowStart") VALUES (${key}, 1, now())
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE WHEN "RateLimit"."windowStart" < now() - make_interval(secs => ${windowSeconds}) THEN 1 ELSE "RateLimit"."count" + 1 END,
      "windowStart" = CASE WHEN "RateLimit"."windowStart" < now() - make_interval(secs => ${windowSeconds}) THEN now() ELSE "RateLimit"."windowStart" END
    RETURNING "count"`;
  return (rows[0]?.count ?? 1) <= limit;
}

/** Give back one attempt (e.g. after a successful login). Never goes below zero. */
export async function rateLimitRefund(key: string): Promise<void> {
  await prisma.$executeRaw`UPDATE "RateLimit" SET "count" = GREATEST("count" - 1, 0) WHERE "key" = ${key}`;
}

/**
 * The client's IP as set by the hosting platform. On Vercel, `x-vercel-forwarded-for` and
 * `x-real-ip` are written by the edge and cannot be supplied by the client. Elsewhere we take the
 * LAST `x-forwarded-for` hop (added by our own proxy), never the first, which the client controls.
 */
export async function clientIp(): Promise<string> {
  const h = await headers();
  // Proxy headers are only meaningful behind a proxy that overwrites them. On Vercel (VERCEL=1) the
  // edge does; elsewhere set TRUST_PROXY=1 only if your proxy does. Otherwise every request shares
  // one bucket, which still caps abuse without trusting anything the client sent.
  if (process.env.VERCEL !== "1" && process.env.TRUST_PROXY !== "1") return "untrusted";
  const platform = h.get("x-vercel-forwarded-for") ?? h.get("x-real-ip");
  if (platform) return platform.split(",")[0]!.trim();
  const hops = h.get("x-forwarded-for")?.split(",").map((x) => x.trim()).filter(Boolean) ?? [];
  return hops[hops.length - 1] ?? "unknown";
}
