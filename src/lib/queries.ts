import "server-only";
import type { Prisma } from "@prisma/client";
import type { PropertyCardData } from "@/components/site/property-card";
import { prisma } from "@/lib/db";

const cardInclude = {
  photos: { orderBy: { position: "asc" }, take: 1 },
  appraisals: { orderBy: [{ effectiveDate: "desc" }, { createdAt: "desc" }], take: 1 },
} satisfies Prisma.PropertyInclude;

type CardRow = Prisma.PropertyGetPayload<{ include: typeof cardInclude }>;

export function toCard(p: CardRow): PropertyCardData {
  const preFunded = p.status === "FUNDING" || p.status === "COMING_SOON" || p.status === "CANCELLED";
  const nav = p.appraisals[0]?.navPerShareCents;
  return {
    slug: p.slug, name: p.name, city: p.city, state: p.state, propertyType: p.propertyType, bedrooms: p.bedrooms, bathrooms: p.bathrooms, status: p.status,
    photo: p.photos[0] ? { url: p.photos[0].url, alt: p.photos[0].alt } : null,
    projectedAnnualYieldBps: p.projectedAnnualYieldBps,
    pricePerShareCents: preFunded || !nav ? p.offeringPricePerShareCents : nav,
    priceLabel: preFunded || !nav ? "Share price" : "Value / share",
    soldUnits: p.soldUnits, totalUnits: p.totalUnits, fundingDeadline: p.fundingDeadline,
  };
}

export async function listPropertyCards(where: Prisma.PropertyWhereInput = {}, orderBy: Prisma.PropertyOrderByWithRelationInput[] = [{ createdAt: "desc" }]) {
  const rows = await prisma.property.findMany({ where, include: cardInclude, orderBy });
  return rows.map((r) => ({ card: toCard(r), row: r }));
}
