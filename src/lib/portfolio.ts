import "server-only";
import { prisma } from "@/lib/db";
import { sellableAt } from "@/lib/domain/holding";
import { valueOfUnits } from "@/lib/domain/money";
import { getSettings } from "@/lib/settings";

/** Everything the portfolio page shows about what a user owns, computed in one place. */
export async function loadPortfolio(userId: string, now = new Date()) {
  const [settings, holdings, lots, dividends, wallet] = await Promise.all([
    getSettings(),
    prisma.holding.findMany({
      where: { userId, shareUnits: { gt: 0n } },
      include: { property: { include: { appraisals: { orderBy: [{ effectiveDate: "desc" }, { createdAt: "desc" }], take: 1 } } } },
      orderBy: { createdAt: "asc" },
    }),
    prisma.holdingLot.findMany({ where: { userId, remainingUnits: { gt: 0n } }, orderBy: { acquiredAt: "asc" } }),
    prisma.dividendPayment.groupBy({ by: ["distributionId"], where: { userId, distribution: { status: "PAID" } }, _sum: { amountCents: true } }),
    prisma.wallet.findUniqueOrThrow({ where: { userId } }),
  ]);
  const dists = await prisma.dividendDistribution.findMany({ where: { id: { in: dividends.map((d) => d.distributionId) } }, select: { id: true, propertyId: true } });
  const propOf = new Map(dists.map((d) => [d.id, d.propertyId]));
  const divByProperty = new Map<string, bigint>();
  let dividendsCents = 0n;
  for (const d of dividends) {
    const amt = d._sum.amountCents ?? 0n;
    dividendsCents += amt;
    const pid = propOf.get(d.distributionId);
    if (pid) divByProperty.set(pid, (divByProperty.get(pid) ?? 0n) + amt);
  }

  const rows = holdings.map((h) => {
    const p = h.property;
    const nav = p.appraisals[0]?.navPerShareCents ?? p.offeringPricePerShareCents;
    const mine = lots.filter((l) => l.propertyId === p.id).map((l) => ({ ...l, sellableAt: sellableAt(l.acquiredAt, settings.holdingPeriodMonths) }));
    const sellableUnits = mine.filter((l) => l.sellableAt.getTime() <= now.getTime()).reduce((a, l) => a + l.remainingUnits, 0n);
    const nextLot = mine.find((l) => l.sellableAt.getTime() > now.getTime());
    return {
      holding: h,
      property: p,
      navPerShareCents: nav,
      valueAtNavCents: valueOfUnits(h.shareUnits, nav),
      valueAtLastTradeCents: p.lastTradePriceCents ? valueOfUnits(h.shareUnits, p.lastTradePriceCents) : null,
      dividendsCents: divByProperty.get(p.id) ?? 0n,
      lots: mine,
      sellableUnits,
      nextSellable: nextLot ? { at: nextLot.sellableAt, units: nextLot.remainingUnits } : null,
    };
  });
  const investedCents = rows.reduce((a, r) => a + r.holding.costBasisCents, 0n);
  const holdingsValueCents = rows.reduce((a, r) => a + r.valueAtNavCents, 0n);
  const cashCents = wallet.availableCents + wallet.heldCents;
  // Dividends from homes the user no longer holds still count toward what they have earned.
  const gainCents = holdingsValueCents - investedCents + dividendsCents;
  return { settings, wallet, rows, investedCents, holdingsValueCents, cashCents, totalCents: cashCents + holdingsValueCents, dividendsCents, gainCents };
}
