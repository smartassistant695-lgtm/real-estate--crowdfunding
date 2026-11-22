import "server-only";
import type { DocumentCategory, Prisma, PropertyStatus, PropertyType } from "@prisma/client";
import { entityName } from "@/config/brand";
import { DomainError, lockProperty, lockWallets, prisma, runTx, toJson } from "@/lib/db";
import { perShare } from "@/lib/domain/money";
import { circuitBreakerBand } from "@/lib/domain/trading-rules";
import { providers } from "@/lib/providers";
import { getSettings } from "@/lib/settings";
import { audit } from "./audit";
import { notify, type Notice } from "./notifications";
import { refundExpiredOfferings } from "./purchase";

/** Which status changes an admin may make by hand. Everything else happens through its workflow. */
const MANUAL_TRANSITIONS: Partial<Record<PropertyStatus, PropertyStatus[]>> = {
  COMING_SOON: ["FUNDING"],
  FUNDING: ["COMING_SOON"], // only while nothing has been sold
  FUNDED: ["TRADING"],
  TRADING: ["FUNDED"], // pause trading
};

export type PropertyInput = {
  slug: string;
  name: string;
  street: string;
  city: string;
  state: string;
  zip: string;
  propertyType: PropertyType;
  bedrooms: number;
  bathrooms: number;
  squareFeet: number;
  yearBuilt: number;
  description: string;
  neighborhood: string;
  schoolsNote: string;
  transitNote: string;
  risks: string[];
  purchasePriceCents: bigint;
  closingCostsCents: bigint;
  reserveFundCents: bigint;
  offeringPricePerShareCents: bigint;
  projectedMonthlyRentCents: bigint;
  projectedAnnualYieldBps: number;
  fundingDeadline: Date | null;
  plannedExitYear: number;
  propertyManagerName: string;
};

/** Offering size in micro-shares: total raise ÷ price, which must divide evenly into whole shares. */
function sharesFor(d: Pick<PropertyInput, "purchasePriceCents" | "closingCostsCents" | "reserveFundCents" | "offeringPricePerShareCents">): bigint {
  const raise = d.purchasePriceCents + d.closingCostsCents + d.reserveFundCents;
  if (d.offeringPricePerShareCents <= 0n) throw new DomainError("Enter a share price above $0.", "offeringPrice");
  if (raise <= 0n) throw new DomainError("Enter the purchase price, closing costs and reserve.", "purchasePrice");
  if (raise % d.offeringPricePerShareCents !== 0n) {
    throw new DomainError("The total raise (price + closing costs + reserve) must divide evenly by the share price, so every share costs the same.", "offeringPrice");
  }
  return (raise / d.offeringPricePerShareCents) * 1_000_000n;
}

export async function createProperty(actorId: string, d: PropertyInput) {
  const totalUnits = sharesFor(d);
  return runTx(async (tx) => {
    if (await tx.property.findUnique({ where: { slug: d.slug } })) throw new DomainError("That web address is already used by another property.", "slug");
    const p = await tx.property.create({ data: { ...d, totalUnits, status: "COMING_SOON", entityName: "" } });
    const named = await tx.property.update({ where: { id: p.id }, data: { entityName: entityName(p.sequence) } });
    await audit(tx, { actorId, action: "property.created", entityType: "Property", entityId: p.id, after: named });
    return named;
  });
}

export async function updateProperty(actorId: string, id: string, d: PropertyInput) {
  return runTx(async (tx) => {
    const before = await lockProperty(tx, id);
    // Once an offering opens, investors have relied on the offering terms: the exit year and the
    // manager can only change by a holder vote, and projections are frozen.
    if (before.status !== "COMING_SOON") {
      if (d.plannedExitYear !== before.plannedExitYear) throw new DomainError("The planned exit year can only change through a holder vote (Extend exit date).", "plannedExitYear");
      if (d.propertyManagerName !== before.propertyManagerName) throw new DomainError("The property manager can only change through a holder vote (Change manager).", "propertyManagerName");
      if (d.projectedAnnualYieldBps !== before.projectedAnnualYieldBps || d.projectedMonthlyRentCents !== before.projectedMonthlyRentCents) throw new DomainError("Projections shown in the offering cannot change after it opens.", "projectedYield");
    }
    if (before.status === "FUNDING" && (!d.fundingDeadline || d.fundingDeadline.getTime() <= Date.now())) throw new DomainError("An open offering needs a funding deadline in the future. To end it now, cancel the offering.", "fundingDeadline");
    if (before.status === "FUNDING" && before.fundingDeadline && d.fundingDeadline && d.fundingDeadline.getTime() > before.fundingDeadline.getTime() + 60 * 86_400_000) throw new DomainError("The deadline can be extended by at most 60 days.", "fundingDeadline");
    const economicsChanged =
      d.purchasePriceCents !== before.purchasePriceCents || d.closingCostsCents !== before.closingCostsCents || d.reserveFundCents !== before.reserveFundCents || d.offeringPricePerShareCents !== before.offeringPricePerShareCents;
    if (economicsChanged && (before.status !== "COMING_SOON" || before.soldUnits > 0n)) {
      throw new DomainError("Prices and the share count are fixed once an offering opens. Only descriptive details can change now.");
    }
    if (d.slug !== before.slug && (await tx.property.findUnique({ where: { slug: d.slug } }))) throw new DomainError("That web address is already used.", "slug");
    const totalUnits = economicsChanged ? sharesFor(d) : before.totalUnits;
    const after = await tx.property.update({ where: { id }, data: { ...d, totalUnits } });
    await audit(tx, { actorId, action: "property.updated", entityType: "Property", entityId: id, before, after });
    return after;
  });
}

export async function changePropertyStatus(actorId: string, id: string, to: PropertyStatus) {
  return runTx(async (tx) => {
    const p = await lockProperty(tx, id);
    if (!MANUAL_TRANSITIONS[p.status]?.includes(to)) throw new DomainError(`A property cannot be moved from ${p.status.replace("_", " ").toLowerCase()} to ${to.replace("_", " ").toLowerCase()} by hand.`);
    if (to === "FUNDING") {
      if (!p.fundingDeadline || p.fundingDeadline.getTime() <= Date.now()) throw new DomainError("Set a funding deadline in the future before opening the offering.");
      const docs = await tx.document.count({ where: { propertyId: id, category: "OFFERING_CIRCULAR" } });
      if (docs === 0) throw new DomainError("Publish the offering circular before opening the offering.");
      if (!(await tx.appraisal.findFirst({ where: { propertyId: id } }))) throw new DomainError("Add the pre-purchase appraisal before opening the offering.");
    }
    if (p.status === "FUNDING" && to === "COMING_SOON" && p.soldUnits > 0n) throw new DomainError("Shares have already been sold. Let the deadline pass to refund investors instead.");
    if (to === "TRADING" && !(await tx.appraisal.findFirst({ where: { propertyId: id } }))) throw new DomainError("Add an appraisal before trading starts: order prices are limited around it.");
    const updated = await tx.property.update({ where: { id }, data: { status: to } });
    await audit(tx, { actorId, action: "property.status_changed", entityType: "Property", entityId: id, before: { status: p.status }, after: { status: to } });
    return updated;
  });
}

/** Cancel an offering now (before its deadline) and refund everyone, through the same job the deadline uses. */
export async function cancelOffering(actorId: string, id: string) {
  await runTx(async (tx) => {
    const p = await lockProperty(tx, id);
    if (p.status !== "FUNDING") throw new DomainError("Only an open offering can be cancelled.");
    await tx.property.update({ where: { id }, data: { fundingDeadline: new Date(Date.now() - 1000) } });
    await audit(tx, { actorId, action: "offering.cancel_requested", entityType: "Property", entityId: id, before: { fundingDeadline: p.fundingDeadline } });
  });
  return refundExpiredOfferings();
}

export async function setPhotos(actorId: string, propertyId: string, photos: { url: string; alt: string; credit: string; creditUrl: string }[]) {
  for (const ph of photos) {
    if (!/^https:\/\/images\.unsplash\.com\/photo-[\w-]+$/.test(ph.url)) throw new DomainError("Photos must be images.unsplash.com links in this demo (the image CDN allowed by the site's security policy).", "photos");
    if (!ph.alt.trim()) throw new DomainError("Every photo needs a description for screen readers.", "photos");
  }
  return runTx(async (tx) => {
    await lockProperty(tx, propertyId);
    const before = await tx.propertyPhoto.findMany({ where: { propertyId }, orderBy: { position: "asc" } });
    await tx.propertyPhoto.deleteMany({ where: { propertyId } });
    await tx.propertyPhoto.createMany({ data: photos.map((ph, position) => ({ ...ph, propertyId, position })) });
    await audit(tx, { actorId, action: "property.photos_set", entityType: "Property", entityId: propertyId, before, after: photos });
  });
}

export async function addDocument(actorId: string, propertyId: string | null, d: { title: string; category: DocumentCategory; filename: string; bytes: Uint8Array; contentType: string }) {
  // Check the file really is a PDF, not just labelled as one by the browser.
  const magic = String.fromCharCode(...d.bytes.slice(0, 5));
  if (magic !== "%PDF-") throw new DomainError("That file is not a PDF.", "file");
  const key = `${propertyId ?? "platform"}/${Date.now()}-${d.filename.replace(/[^\w.-]/g, "_").slice(0, 80)}`;
  const stored = await providers.documents.put({ key, filename: d.filename, contentType: d.contentType, bytes: d.bytes });
  const url = new URL(stored.url, "http://placeholder.invalid");
  url.searchParams.set("title", d.title);
  const href = stored.url.startsWith("/") ? `${url.pathname}${url.search}` : url.toString();
  const doc = await prisma.document.create({ data: { propertyId, title: d.title, category: d.category, url: href } });
  await audit(prisma, { actorId, action: "document.published", entityType: "Document", entityId: doc.id, after: { title: d.title, category: d.category, key, provider: providers.documents.name } });
  return doc;
}

/**
 * Record a new appraisal. The per-share value is (home value + the cash the property holds:
 * repair reserve and liquidity reserve) ÷ shares outstanding. Live orders priced outside the new
 * circuit-breaker band are expired, so the order book never shows prices nobody can trade at.
 */
export async function addAppraisal(actorId: string, propertyId: string, d: { valueCents: bigint; effectiveDate: Date; source: string; notes: string }) {
  if (d.valueCents <= 0n) throw new DomainError("Enter the appraised value.", "value");
  if (d.effectiveDate.getTime() > Date.now()) throw new DomainError("The effective date cannot be in the future.", "effectiveDate");
  let afterCommit: (() => Promise<void>) | undefined;
  const result = await runTx(async (tx) => {
    const p = await lockProperty(tx, propertyId);
    if (p.status === "SOLD" || p.status === "CANCELLED") throw new DomainError("This property is closed.");
    const latest = await tx.appraisal.findFirst({ where: { propertyId }, orderBy: [{ effectiveDate: "desc" }, { createdAt: "desc" }] });
    if (latest && d.effectiveDate.getTime() < latest.effectiveDate.getTime()) throw new DomainError("A new appraisal cannot be dated before the latest one.", "effectiveDate");
    const settings = await getSettings(tx);
    const reserve = await tx.liquidityReserve.findUnique({ where: { propertyId } });
    // Until the offering sells out, value is spread over every share offered (the shares that will
    // exist once it closes), not only the ones sold so far.
    const funded = ["FUNDED", "TRADING", "EXIT_VOTE"].includes(p.status);
    const outstanding = funded ? p.soldUnits - p.retiredUnits : p.totalUnits;
    if (outstanding <= 0n) throw new DomainError("This property has no shares.");
    const navPerShareCents = perShare(d.valueCents + p.reserveFundCents + (reserve?.balanceCents ?? 0n), outstanding);
    const a = await tx.appraisal.create({ data: { propertyId, ...d, navPerShareCents } });
    const band = circuitBreakerBand(navPerShareCents, settings.circuitBreakerBps);
    const stale = await tx.order.findMany({ where: { propertyId, status: { in: ["OPEN", "PARTIALLY_FILLED"] }, OR: [{ limitPriceCents: { lt: band.minCents } }, { limitPriceCents: { gt: band.maxCents } }] } });
    const notices: Notice[] = [];
    if (stale.length) {
      await lockWallets(tx, stale.map((o) => o.userId));
      for (const o of stale) {
        const remaining = o.shareUnits - o.filledUnits;
        if (o.side === "BUY" && o.heldCents > 0n) await tx.wallet.update({ where: { userId: o.userId }, data: { heldCents: { decrement: o.heldCents }, availableCents: { increment: o.heldCents } } });
        if (o.side === "SELL" && remaining > 0n) await tx.holding.update({ where: { userId_propertyId: { userId: o.userId, propertyId } }, data: { reservedUnits: { decrement: remaining } } });
        await tx.order.update({ where: { id: o.id }, data: { status: "EXPIRED", heldCents: 0n, closedAt: new Date() } });
        notices.push({ userId: o.userId, type: "ORDER_EXPIRED", title: `Order expired: ${p.name}`, body: `A new appraisal moved the allowed price range for ${p.name}, and your order’s price is now outside it. The order has been closed and anything set aside for it released.`, href: "/orders" });
      }
    }
    await audit(tx, { actorId, action: "appraisal.added", entityType: "Appraisal", entityId: a.id, after: { propertyId, valueCents: d.valueCents, navPerShareCents, expiredOrders: stale.length } });
    afterCommit = await notify(tx, notices);
    return { appraisal: a, expiredOrders: stale.length };
  });
  await afterCommit?.();
  return result;
}

export type SettingsInput = {
  minInvestmentCents: bigint;
  annualInvestmentLimitCents: bigint;
  holdingPeriodMonths: number;
  tradingWindowDays: number;
  reserveAllocationBps: number;
  buybackDiscountBps: number;
  buybackMonthlyCapCents: bigint;
  proposalQuorumBps: number;
  proposalPassThresholdBps: number;
  votingCapBps: number;
  circuitBreakerBps: number;
};

/** Update platform settings. Open proposals keep the rules they opened with (copied at creation). */
export async function updateSettings(actorId: string, d: SettingsInput, ipAddress?: string | null) {
  if (d.minInvestmentCents < 100n) throw new DomainError("The minimum investment must be at least $1.", "minInvestment");
  if (d.tradingWindowDays < 1 || d.tradingWindowDays > 28) throw new DomainError("A trading window must last between 1 and 28 days.", "tradingWindowDays");
  if (d.holdingPeriodMonths < 0 || d.holdingPeriodMonths > 60) throw new DomainError("Holding period must be 0–60 months.", "holdingPeriodMonths");
  if (d.proposalPassThresholdBps >= 10_000) throw new DomainError("The pass threshold must be below 100%, or nothing could ever pass.", "proposalPassThreshold");
  if (d.votingCapBps <= 0) throw new DomainError("The voting cap must be above 0%.", "votingCap");
  if (d.circuitBreakerBps <= 0 || d.circuitBreakerBps >= 10_000) throw new DomainError("The price band must be between 0% and 100%.", "circuitBreaker");
  if (d.proposalQuorumBps < 100) throw new DomainError("Quorum must be at least 1% of shares.", "quorum");
  if (d.proposalPassThresholdBps < 5000) throw new DomainError("The pass threshold must be at least 50%, so a minority can never decide.", "passThreshold");
  if (d.buybackDiscountBps >= 10_000) throw new DomainError("The buyback discount must be below 100%.", "buybackDiscount");
  if (d.reserveAllocationBps > 10_000) throw new DomainError("The reserve allocation cannot exceed 100%.", "reserveAllocation");
  if (d.minInvestmentCents > d.annualInvestmentLimitCents) throw new DomainError("The minimum investment cannot be above the annual limit.", "minInvestment");
  return runTx(async (tx) => {
    const before = await getSettings(tx);
    const after = await tx.platformSettings.update({ where: { id: 1 }, data: d });
    // New reserve terms apply to every property's reserve from now on.
    await tx.liquidityReserve.updateMany({ data: { monthlyCapCents: d.buybackMonthlyCapCents, discountBps: d.buybackDiscountBps } });
    await audit(tx, { actorId, action: "settings.updated", entityType: "PlatformSettings", entityId: "1", before, after, ipAddress });
    return after;
  });
}

export async function setUserLimit(actorId: string, userId: string, annualInvestmentLimitCents: bigint) {
  if (annualInvestmentLimitCents < 0n) throw new DomainError("The limit cannot be negative.", "limit");
  const before = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { annualInvestmentLimitCents: true, role: true } });
  if (before.role !== "INVESTOR") throw new DomainError("Only investor accounts have an investment limit.");
  await prisma.user.update({ where: { id: userId }, data: { annualInvestmentLimitCents } });
  await audit(prisma, { actorId, action: "user.limit_changed", entityType: "User", entityId: userId, before, after: { annualInvestmentLimitCents } });
}

export async function setKycStatus(actorId: string, userId: string, status: "APPROVED" | "REJECTED") {
  const before = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { kycStatus: true, role: true } });
  if (before.role !== "INVESTOR") throw new DomainError("Only investor accounts have an identity check.");
  await prisma.user.update({ where: { id: userId }, data: { kycStatus: status } });
  await audit(prisma, { actorId, action: `kyc.manual_${status.toLowerCase()}`, entityType: "User", entityId: userId, before, after: { kycStatus: status } });
}

export async function scheduleWindow(actorId: string, d: { propertyId: string | null; opensAt: Date; closesAt: Date }) {
  if (d.closesAt.getTime() <= d.opensAt.getTime()) throw new DomainError("The window must close after it opens.", "closesAt");
  if (d.closesAt.getTime() <= Date.now()) throw new DomainError("The window must close in the future.", "closesAt");
  // A property-specific window must not overlap a platform-wide one (or vice versa): two live
  // windows for one property would split its order book.
  const overlap = await prisma.tradingWindow.findFirst({
    where: { status: { not: "CLOSED" }, opensAt: { lt: d.closesAt }, closesAt: { gt: d.opensAt }, ...(d.propertyId ? { OR: [{ propertyId: d.propertyId }, { propertyId: null }] } : {}) },
  });
  if (overlap) throw new DomainError("This overlaps another window. Close or reschedule that one first.");
  const w = await prisma.tradingWindow.create({ data: { ...d, status: "SCHEDULED" } });
  await audit(prisma, { actorId, action: "window.scheduled", entityType: "TradingWindow", entityId: w.id, after: d });
  return w;
}

export { toJson };
export type { Prisma };
