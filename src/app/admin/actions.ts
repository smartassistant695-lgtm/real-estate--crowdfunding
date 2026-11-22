"use server";

import type { DocumentCategory, PropertyStatus, PropertyType, ProposalType } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { ActionState } from "@/components/ui/form";
import { dollars, formObject, guard, idempotencyKeySchema, optionalDollars, percent, zodFailure } from "@/lib/action";
import { DomainError } from "@/lib/db";
import { formatCents } from "@/lib/domain/money";
import { netIncome } from "@/lib/domain/dividends";
import { clientIp } from "@/lib/rate-limit";
import * as admin from "@/lib/services/admin";
import { approveDistribution, payDistribution, previewDistribution, saveFinancials } from "@/lib/services/dividends";
import { createProposal, finalizeProposal, publishProposal, recordSale } from "@/lib/services/governance";
import { closeWindow, openWindow } from "@/lib/services/trading";
import { adjust } from "@/lib/services/wallet";
import { requireAdmin } from "@/lib/session";

const id = z.string().min(1).max(40);
const int = (min: number, max: number, msg: string) => z.coerce.number({ error: msg }).int(msg).min(min, msg).max(max, msg);
const date = (msg: string) => z.iso.date(msg).transform((s) => new Date(`${s}T00:00:00Z`));
const dateTime = (msg: string) => z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, msg).transform((s, ctx) => {
  const d = new Date(`${s}:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 16) !== s) { ctx.addIssue({ code: "custom", message: msg }); return z.NEVER; }
  return d;
});
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Choose a month.");
const refresh = () => revalidatePath("/", "layout");

// ---------------- properties ----------------

const propertySchema = z.object({
  slug: z.string().trim().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "Lowercase letters, numbers and hyphens only.").max(80),
  name: z.string().trim().min(3).max(80),
  street: z.string().trim().min(3).max(120),
  city: z.string().trim().min(2).max(60),
  state: z.string().trim().regex(/^[A-Z]{2}$/, "Two-letter state code."),
  zip: z.string().trim().regex(/^\d{5}$/, "Five-digit ZIP."),
  propertyType: z.enum(["SINGLE_FAMILY", "DUPLEX", "TOWNHOME", "SMALL_MULTIFAMILY"]),
  bedrooms: int(0, 40, "Enter a whole number."),
  bathrooms: z.string().regex(/^\d{1,2}(\.5|\.0)?$/, "Use whole or half numbers, like 1.5.").transform(Number),
  squareFeet: int(100, 50_000, "Enter the living area in square feet."),
  yearBuilt: int(1800, 2100, "Enter a year."),
  description: z.string().trim().min(20, "Write at least a sentence.").max(2000),
  neighborhood: z.string().trim().max(2000),
  schoolsNote: z.string().trim().max(300),
  transitNote: z.string().trim().max(300),
  risks: z.string().transform((s) => s.split("\n").map((l) => l.replace(/^[-–•]\s*/, "").trim()).filter(Boolean)).refine((r) => r.length >= 1 && r.length <= 8, "List one to eight risks, one per line."),
  purchasePrice: dollars(),
  closingCosts: dollars(),
  reserveFund: dollars(),
  offeringPrice: dollars(),
  projectedRent: dollars(),
  projectedYield: percent(),
  fundingDeadline: z.string().optional().transform((s, ctx) => {
    if (!s) return null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) { ctx.addIssue({ code: "custom", message: "Enter a date." }); return z.NEVER; }
    return new Date(`${s}T23:59:59Z`);
  }),
  plannedExitYear: int(2000, 2100, "Enter a year."),
  propertyManagerName: z.string().trim().min(2).max(120),
});

function toPropertyInput(d: z.infer<typeof propertySchema>): admin.PropertyInput {
  return {
    slug: d.slug, name: d.name, street: d.street, city: d.city, state: d.state, zip: d.zip, propertyType: d.propertyType as PropertyType,
    bedrooms: d.bedrooms, bathrooms: d.bathrooms, squareFeet: d.squareFeet, yearBuilt: d.yearBuilt, description: d.description,
    neighborhood: d.neighborhood, schoolsNote: d.schoolsNote, transitNote: d.transitNote, risks: d.risks,
    purchasePriceCents: d.purchasePrice, closingCostsCents: d.closingCosts, reserveFundCents: d.reserveFund,
    offeringPricePerShareCents: d.offeringPrice, projectedMonthlyRentCents: d.projectedRent, projectedAnnualYieldBps: d.projectedYield,
    fundingDeadline: d.fundingDeadline, plannedExitYear: d.plannedExitYear, propertyManagerName: d.propertyManagerName,
  };
}

export async function createPropertyAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireAdmin();
  const parsed = propertySchema.safeParse(formObject(fd));
  if (!parsed.success) return zodFailure(parsed.error);
  let newId = "";
  const r = await guard(async () => {
    newId = (await admin.createProperty(user.id, toPropertyInput(parsed.data))).id;
  });
  if (!r?.ok) return r;
  refresh();
  redirect(`/admin/properties/${newId}?created=1`);
}

export async function updatePropertyAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireAdmin();
  const parsed = propertySchema.extend({ id }).safeParse(formObject(fd));
  if (!parsed.success) return zodFailure(parsed.error);
  return guard(async () => {
    await admin.updateProperty(user.id, parsed.data.id, toPropertyInput(parsed.data));
    refresh();
    return { ok: true, message: "Property saved." };
  });
}

export async function changeStatusAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireAdmin();
  const parsed = z.object({ id, to: z.enum(["COMING_SOON", "FUNDING", "FUNDED", "TRADING"]) }).safeParse(formObject(fd));
  if (!parsed.success) return zodFailure(parsed.error);
  return guard(async () => {
    await admin.changePropertyStatus(user.id, parsed.data.id, parsed.data.to as PropertyStatus);
    refresh();
    return { ok: true, message: "Status changed." };
  });
}

export async function cancelOfferingAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireAdmin();
  const parsed = z.object({ id }).safeParse(formObject(fd));
  if (!parsed.success) return zodFailure(parsed.error);
  return guard(async () => {
    await admin.cancelOffering(user.id, parsed.data.id);
    refresh();
    return { ok: true, message: "Offering cancelled and every investor refunded." };
  });
}

export async function setPhotosAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireAdmin();
  const parsed = z.object({ id, photos: z.string().max(10_000) }).safeParse(formObject(fd));
  if (!parsed.success) return zodFailure(parsed.error);
  // One photo per line: URL | description | credit (optional) | credit link (optional). Order = display order.
  const photos = parsed.data.photos.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => {
    const [url = "", alt = "", credit = "", creditUrl = ""] = l.split("|").map((x) => x.trim());
    return { url: url.split("?")[0]!, alt, credit, creditUrl };
  });
  return guard(async () => {
    if (photos.length === 0 || photos.length > 12) throw new DomainError("List between one and twelve photos.", "photos");
    await admin.setPhotos(user.id, parsed.data.id, photos);
    refresh();
    return { ok: true, message: "Photos saved in the new order." };
  });
}

const DOC_CATEGORIES = ["OFFERING_CIRCULAR", "OPERATING_AGREEMENT", "APPRAISAL", "INSPECTION", "FINANCIAL_STATEMENT", "TAX_FORM"] as const;

export async function uploadDocumentAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireAdmin();
  const parsed = z.object({ id, title: z.string().trim().min(3).max(160), category: z.enum(DOC_CATEGORIES) }).safeParse(formObject(fd));
  if (!parsed.success) return zodFailure(parsed.error);
  const file = fd.get("file");
  return guard(async () => {
    if (!(file instanceof File) || file.size === 0) throw new DomainError("Choose a PDF to upload.", "file");
    if (file.size > 10 * 1024 * 1024) throw new DomainError("Files can be at most 10 MB.", "file");
    if (file.type !== "application/pdf") throw new DomainError("Only PDF files can be published.", "file");
    await admin.addDocument(user.id, parsed.data.id, { title: parsed.data.title, category: parsed.data.category as DocumentCategory, filename: file.name, contentType: file.type, bytes: new Uint8Array(await file.arrayBuffer()) });
    refresh();
    return { ok: true, message: "Document published (stored by the mock storage adapter)." };
  });
}

export async function addAppraisalAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireAdmin();
  const parsed = z.object({ id, value: dollars(), effectiveDate: date("Enter the effective date."), source: z.string().trim().min(3).max(120), notes: z.string().trim().max(500) }).safeParse(formObject(fd));
  if (!parsed.success) return zodFailure(parsed.error);
  return guard(async () => {
    const r = await admin.addAppraisal(user.id, parsed.data.id, { valueCents: parsed.data.value, effectiveDate: parsed.data.effectiveDate, source: parsed.data.source, notes: parsed.data.notes });
    refresh();
    return { ok: true, message: `Appraisal recorded: ${formatCents(r.appraisal.navPerShareCents)} per share.${r.expiredOrders ? ` ${r.expiredOrders} order(s) outside the new price range were closed.` : ""}` };
  });
}

// ---------------- financials & dividends ----------------

const financialsSchema = z.object({
  propertyId: id,
  month,
  grossRent: dollars(),
  vacancyLoss: optionalDollars(),
  managementFee: optionalDollars(),
  maintenance: optionalDollars(),
  taxes: optionalDollars(),
  insurance: optionalDollars(),
  hoa: optionalDollars(),
  otherExpenses: optionalDollars(),
  occupancy: percent(),
  notes: z.string().trim().max(500),
});

export async function saveFinancialsAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireAdmin();
  const parsed = financialsSchema.safeParse(formObject(fd));
  if (!parsed.success) return zodFailure(parsed.error);
  const d = parsed.data;
  const data = {
    grossRentCents: d.grossRent, vacancyLossCents: d.vacancyLoss, managementFeeCents: d.managementFee, maintenanceCents: d.maintenance,
    taxesCents: d.taxes, insuranceCents: d.insurance, hoaCents: d.hoa, otherExpensesCents: d.otherExpenses, occupancyRateBps: d.occupancy, notes: d.notes,
  };
  return guard(async () => {
    await saveFinancials({ actorId: user.id, propertyId: d.propertyId, month: d.month, data, ipAddress: await clientIp() });
    refresh();
    return { ok: true, message: `Saved. Net income: ${formatCents(netIncome(data))}.` };
  });
}

export async function previewDividendAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireAdmin();
  const parsed = z.object({ propertyId: id, month }).safeParse(formObject(fd));
  if (!parsed.success) return zodFailure(parsed.error);
  let distId = "";
  const r = await guard(async () => {
    distId = (await previewDistribution({ actorId: user.id, propertyId: parsed.data.propertyId, month: parsed.data.month })).id;
  });
  if (!r?.ok) return r;
  redirect(`/admin/dividends/${distId}`);
}

export async function approveDividendAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireAdmin();
  const parsed = z.object({ id }).safeParse(formObject(fd));
  if (!parsed.success) return zodFailure(parsed.error);
  return guard(async () => {
    await approveDistribution({ actorId: user.id, distributionId: parsed.data.id, ipAddress: await clientIp() });
    refresh();
    return { ok: true, message: "Approved. Review the figures once more, then pay." };
  });
}

export async function payDividendAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireAdmin();
  const parsed = z.object({ id, idempotencyKey: idempotencyKeySchema }).safeParse(formObject(fd));
  if (!parsed.success) return zodFailure(parsed.error);
  return guard(async () => {
    await payDistribution({ actorId: user.id, distributionId: parsed.data.id, idempotencyKey: parsed.data.idempotencyKey, ipAddress: await clientIp() });
    refresh();
    return { ok: true, message: "Paid. Investors have been notified." };
  });
}

// ---------------- trading windows ----------------

export async function scheduleWindowAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireAdmin();
  const parsed = z.object({ propertyId: z.string().max(40), opensAt: dateTime("Enter when it opens (UTC)."), closesAt: dateTime("Enter when it closes (UTC).") }).safeParse(formObject(fd));
  if (!parsed.success) return zodFailure(parsed.error);
  return guard(async () => {
    await admin.scheduleWindow(user.id, { propertyId: parsed.data.propertyId || null, opensAt: parsed.data.opensAt, closesAt: parsed.data.closesAt });
    refresh();
    return { ok: true, message: "Window scheduled." };
  });
}

export async function openWindowAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireAdmin();
  const parsed = z.object({ id }).safeParse(formObject(fd));
  if (!parsed.success) return zodFailure(parsed.error);
  return guard(async () => {
    await openWindow(parsed.data.id, user.id);
    refresh();
    return { ok: true, message: "Window opened. Holders have been notified." };
  });
}

export async function closeWindowAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireAdmin();
  const parsed = z.object({ id }).safeParse(formObject(fd));
  if (!parsed.success) return zodFailure(parsed.error);
  return guard(async () => {
    await closeWindow(parsed.data.id, user.id);
    refresh();
    return { ok: true, message: "Window closed. Unfilled orders expired and their holds were released." };
  });
}

// ---------------- proposals ----------------

const PROPOSAL_TYPES = ["SELL_PROPERTY", "REFINANCE", "MAJOR_RENOVATION", "CHANGE_MANAGER", "EXTEND_EXIT_DATE"] as const;

export async function createProposalAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireAdmin();
  const parsed = z.object({
    propertyId: id,
    type: z.enum(PROPOSAL_TYPES, "Choose a decision type."),
    title: z.string().trim().min(8).max(140),
    summary: z.string().trim().min(20, "Write the summary in a sentence or two.").max(600),
    details: z.string().trim().min(40, "Explain the proposal in full.").max(8000),
    pros: z.string().trim().max(2000),
    cons: z.string().trim().max(2000),
    impact: z.string().trim().max(2000),
    recordDate: dateTime("Enter the record date (UTC)."),
    opensAt: dateTime("Enter when voting opens (UTC)."),
    closesAt: dateTime("Enter when voting closes (UTC)."),
    extendYears: z.string().optional().transform((s) => (s ? Number(s) : null)).refine((n) => n === null || (Number.isInteger(n) && n >= 1 && n <= 2), "Extend by 1 or 2 years."),
  }).safeParse(formObject(fd));
  if (!parsed.success) return zodFailure(parsed.error);
  const d = parsed.data;
  // Financial impact: one row per line, "Label | Today | If it passes".
  const financialImpact = d.impact.split("\n").map((l) => l.split("|").map((x) => x.trim())).filter((c) => c.length >= 3 && c[0]).map(([label, current, proposed]) => ({ label: label!, current: current!, proposed: proposed! }));
  let newId = "";
  const r = await guard(async () => {
    if (d.type === "EXTEND_EXIT_DATE" && !d.extendYears) throw new DomainError("Say how many years to extend by.", "extendYears");
    newId = (await createProposal({ actorId: user.id, ipAddress: await clientIp(), data: { propertyId: d.propertyId, type: d.type as ProposalType, title: d.title, summary: d.summary, details: d.details, pros: d.pros, cons: d.cons, financialImpact, recordDate: d.recordDate, opensAt: d.opensAt, closesAt: d.closesAt, extendYears: d.extendYears } })).id;
  });
  if (!r?.ok) return r;
  redirect(`/admin/proposals/${newId}`);
}

export async function publishProposalAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireAdmin();
  const parsed = z.object({ id }).safeParse(formObject(fd));
  if (!parsed.success) return zodFailure(parsed.error);
  return guard(async () => {
    await publishProposal({ actorId: user.id, proposalId: parsed.data.id, ipAddress: await clientIp() });
    refresh();
    return { ok: true, message: "Published. Holders of record have been notified." };
  });
}

export async function finalizeProposalAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireAdmin();
  const parsed = z.object({ id, early: z.string().optional() }).safeParse(formObject(fd));
  if (!parsed.success) return zodFailure(parsed.error);
  return guard(async () => {
    const outcome = await finalizeProposal({ actorId: user.id, proposalId: parsed.data.id, force: parsed.data.early === "1" });
    refresh();
    return { ok: true, message: `Voting closed. Result: ${outcome.replace("_", " ").toLowerCase()}.` };
  });
}

export async function recordSaleAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireAdmin();
  const parsed = z.object({ propertyId: id, salePrice: dollars(), saleCosts: dollars(), finalOperating: optionalDollars(), idempotencyKey: idempotencyKeySchema, confirm: z.literal("on", "Tick the box to confirm the payout.") }).safeParse(formObject(fd));
  if (!parsed.success) return zodFailure(parsed.error);
  return guard(async () => {
    await recordSale({ actorId: user.id, propertyId: parsed.data.propertyId, salePriceCents: parsed.data.salePrice, saleCostsCents: parsed.data.saleCosts, finalOperatingCents: parsed.data.finalOperating, idempotencyKey: parsed.data.idempotencyKey, ipAddress: await clientIp() });
    refresh();
    return { ok: true, message: "Sale recorded. Proceeds were paid to every holder and the property is closed." };
  });
}

// ---------------- users & settings ----------------

export async function setLimitAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireAdmin();
  const parsed = z.object({ id, limit: dollars() }).safeParse(formObject(fd));
  if (!parsed.success) return zodFailure(parsed.error);
  return guard(async () => {
    await admin.setUserLimit(user.id, parsed.data.id, parsed.data.limit);
    refresh();
    return { ok: true, message: `Annual limit set to ${formatCents(parsed.data.limit, { whole: true })}.` };
  });
}

export async function setKycAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireAdmin();
  const parsed = z.object({ id, status: z.enum(["APPROVED", "REJECTED"]) }).safeParse(formObject(fd));
  if (!parsed.success) return zodFailure(parsed.error);
  return guard(async () => {
    await admin.setKycStatus(user.id, parsed.data.id, parsed.data.status);
    refresh();
    return { ok: true, message: `Identity check marked ${parsed.data.status.toLowerCase()}.` };
  });
}

export async function adjustWalletAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireAdmin();
  const parsed = z.object({ id, direction: z.enum(["credit", "debit"]), amount: dollars(), memo: z.string().trim().min(5, "Say why, for the audit log.").max(200), idempotencyKey: idempotencyKeySchema }).safeParse(formObject(fd));
  if (!parsed.success) return zodFailure(parsed.error);
  return guard(async () => {
    const amt = parsed.data.direction === "credit" ? parsed.data.amount : -parsed.data.amount;
    await adjust({ actorId: user.id, userId: parsed.data.id, amountCents: amt, memo: parsed.data.memo, idempotencyKey: parsed.data.idempotencyKey, ipAddress: await clientIp() });
    refresh();
    return { ok: true, message: "Wallet adjusted and logged." };
  });
}

export async function updateSettingsAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireAdmin();
  const parsed = z.object({
    minInvestment: dollars(), annualLimit: dollars(), holdingPeriodMonths: int(0, 60, "0–60 months."), tradingWindowDays: int(1, 28, "1–28 days."),
    reserveAllocation: percent(), buybackDiscount: percent(), buybackCap: dollars(), quorum: percent(), passThreshold: percent(), votingCap: percent(), circuitBreaker: percent(),
    confirm: z.literal("on", "Tick the box to confirm."),
  }).safeParse(formObject(fd));
  if (!parsed.success) return zodFailure(parsed.error);
  const d = parsed.data;
  return guard(async () => {
    await admin.updateSettings(user.id, {
      minInvestmentCents: d.minInvestment, annualInvestmentLimitCents: d.annualLimit, holdingPeriodMonths: d.holdingPeriodMonths, tradingWindowDays: d.tradingWindowDays,
      reserveAllocationBps: d.reserveAllocation, buybackDiscountBps: d.buybackDiscount, buybackMonthlyCapCents: d.buybackCap, proposalQuorumBps: d.quorum,
      proposalPassThresholdBps: d.passThreshold, votingCapBps: d.votingCap, circuitBreakerBps: d.circuitBreaker,
    }, await clientIp());
    refresh();
    return { ok: true, message: "Settings saved and logged. Open votes keep the rules they started with." };
  });
}
