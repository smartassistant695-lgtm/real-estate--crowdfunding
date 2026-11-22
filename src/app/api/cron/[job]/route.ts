import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { toJson } from "@/lib/db";
import { audit } from "@/lib/services/audit";
import { prisma } from "@/lib/db";
import { createMonthlyDrafts } from "@/lib/services/dividends";
import { createExitVotes, syncProposals } from "@/lib/services/governance";
import { refundExpiredOfferings } from "@/lib/services/purchase";
import { takePortfolioSnapshots } from "@/lib/services/snapshots";
import { syncTradingWindows } from "@/lib/services/trading";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Scheduled jobs (see vercel.json). Vercel Cron calls these with
 * `Authorization: Bearer <CRON_SECRET>`. Every job is idempotent: running it twice, or late,
 * does no harm. None of them pays dividends — drafts wait for an admin.
 */
const JOBS: Record<string, () => Promise<unknown>> = {
  snapshots: () => takePortfolioSnapshots(),
  "draft-dividends": () => createMonthlyDrafts(),
  "trading-windows": () => syncTradingWindows(),
  "funding-deadlines": () => refundExpiredOfferings(),
  "exit-votes": () => createExitVotes(),
  proposals: () => syncProposals(),
};

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 16) return false; // refuse to run unprotected
  const given = Buffer.from(req.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ job: string }> }) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { job } = await params;
  const run = Object.hasOwn(JOBS, job) ? JOBS[job] : undefined;
  if (!run) return NextResponse.json({ error: "unknown job" }, { status: 404 });
  const started = Date.now();
  try {
    const result = toJson(await run());
    await audit(prisma, { actorId: null, action: `cron.${job}`, entityType: "Cron", entityId: job, after: { result, ms: Date.now() - started } });
    return NextResponse.json({ ok: true, job, result, ms: Date.now() - started });
  } catch (e) {
    console.error(`[cron] ${job} failed`, e);
    return NextResponse.json({ ok: false, job, error: "job failed; see server logs" }, { status: 500 });
  }
}
