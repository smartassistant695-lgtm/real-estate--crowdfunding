import "server-only";
import { prisma } from "@/lib/db";
import { valueOfUnits } from "@/lib/domain/money";

/** Latest appraised value per share for each property. */
export async function navByProperty(): Promise<Map<string, bigint>> {
  const rows = await prisma.appraisal.findMany({ orderBy: [{ effectiveDate: "asc" }, { createdAt: "asc" }], select: { propertyId: true, navPerShareCents: true } });
  const map = new Map<string, bigint>();
  for (const r of rows) map.set(r.propertyId, r.navPerShareCents);
  return map;
}

/** Job (daily): record each investor's cash and holdings (at appraised value) for the value-over-time chart. */
export async function takePortfolioSnapshots(now = new Date()): Promise<{ users: number }> {
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const [users, nav, props] = await Promise.all([
    prisma.user.findMany({ where: { role: "INVESTOR" }, select: { id: true, wallet: true, holdings: { where: { shareUnits: { gt: 0n } } } } }),
    navByProperty(),
    prisma.property.findMany({ select: { id: true, offeringPricePerShareCents: true } }),
  ]);
  const offering = new Map(props.map((p) => [p.id, p.offeringPricePerShareCents]));
  for (const u of users) {
    const cashCents = (u.wallet?.availableCents ?? 0n) + (u.wallet?.heldCents ?? 0n);
    const holdingsCents = u.holdings.reduce((a, h) => a + valueOfUnits(h.shareUnits, nav.get(h.propertyId) ?? offering.get(h.propertyId) ?? 0n), 0n);
    const data = { cashCents, holdingsCents, totalCents: cashCents + holdingsCents };
    await prisma.portfolioSnapshot.upsert({ where: { userId_date: { userId: u.id, date } }, create: { userId: u.id, date, ...data }, update: data });
  }
  return { users: users.length };
}
