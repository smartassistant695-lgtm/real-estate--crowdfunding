/**
 * Factories for integration tests. Everything that moves money or shares goes through the real
 * services; only reference data (users, properties, appraisals, windows) is written directly.
 */
import { randomUUID } from "node:crypto";
import type { Prisma, PropertyStatus } from "@prisma/client";
import { expect } from "vitest";
import { prisma } from "@/lib/db";
import { postLedger, reconcile } from "@/lib/services/ledger";
import { buyPrimary } from "@/lib/services/purchase";
import { deposit, MAX_DEPOSIT_CENTS } from "@/lib/services/wallet";

export const DAY = 24 * 3600 * 1000;
export const UNITS = 1_000_000n;

/** Dollars → cents. */
export const usd = (dollars: number): bigint => BigInt(Math.round(dollars * 100));
/** Whole/fractional shares → micro-share units. */
export const sh = (shares: number): bigint => BigInt(Math.round(shares * 1_000_000));
/** UTC date helper: utc(2025, 1, 10) = 10 January 2025 00:00 UTC (month is 1-based). */
export const utc = (y: number, m: number, d: number, h = 0, min = 0): Date => new Date(Date.UTC(y, m - 1, d, h, min));

let counter = 0;
/** A fresh idempotency key. The uuid comes first because the mock payments provider only keeps the first 12 characters. */
export const key = (label = "k"): string => `${randomUUID()}-${label}-${++counter}`;

function assertTestDatabase() {
  const url = process.env.DATABASE_URL ?? "";
  if (!/\/hearth_test(\?|$)/.test(url)) throw new Error(`Refusing to truncate: DATABASE_URL does not point at hearth_test (${url.replace(/:\/\/.*@/, "://***@")})`);
}

/** Empty every table (except migrations) and recreate the settings row with its defaults. */
export async function resetDb(settings: Partial<Prisma.PlatformSettingsUncheckedCreateInput> = {}) {
  assertTestDatabase();
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname = current_schema() AND tablename <> '_prisma_migrations'`;
  await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} RESTART IDENTITY CASCADE`);
  return prisma.platformSettings.create({ data: { id: 1, ...settings } });
}

export type TestUser = { id: string; email: string; name: string };

/** An investor who can invest and trade: wallet, KYC approved, both disclosures accepted. */
export async function createUser(
  opts: {
    name?: string;
    annualLimitCents?: bigint;
    kycStatus?: "NOT_STARTED" | "PENDING" | "APPROVED" | "REJECTED";
    riskDisclosure?: boolean;
    tradingDisclosure?: boolean;
    fundCents?: bigint;
  } = {},
): Promise<TestUser> {
  const n = ++counter;
  const when = utc(2024, 6, 1);
  const user = await prisma.user.create({
    data: {
      email: `user${n}-${randomUUID().slice(0, 8)}@test.local`,
      passwordHash: "x",
      name: opts.name ?? `User ${n}`,
      kycStatus: opts.kycStatus ?? "APPROVED",
      kycSubmittedAt: when,
      riskDisclosureAcceptedAt: opts.riskDisclosure === false ? null : when,
      tradingDisclosureAcceptedAt: opts.tradingDisclosure === false ? null : when,
      onboardingCompletedAt: when,
      // Generous by default so only the tests about the limit run into it.
      annualInvestmentLimitCents: opts.annualLimitCents ?? usd(10_000_000),
      wallet: { create: {} },
    },
  });
  if (opts.fundCents && opts.fundCents > 0n) await fund(user.id, opts.fundCents);
  return { id: user.id, email: user.email, name: user.name };
}

export async function createAdmin(): Promise<TestUser> {
  const n = ++counter;
  const user = await prisma.user.create({
    data: { email: `admin${n}-${randomUUID().slice(0, 8)}@test.local`, passwordHash: "x", name: `Admin ${n}`, role: "ADMIN", kycStatus: "APPROVED", annualInvestmentLimitCents: 0n, wallet: { create: {} } },
  });
  return { id: user.id, email: user.email, name: user.name };
}

/** Add cash through the real wallet service (split into transfers under the per-deposit maximum). */
export async function fund(userId: string, amountCents: bigint) {
  let left = amountCents;
  while (left > 0n) {
    const chunk = left > MAX_DEPOSIT_CENTS ? MAX_DEPOSIT_CENTS : left;
    await deposit({ userId, amountCents: chunk, idempotencyKey: key("dep") });
    left -= chunk;
  }
}

export async function createProperty(
  opts: {
    name?: string;
    totalShares?: number;
    priceCents?: bigint;
    status?: PropertyStatus;
    fundingDeadline?: Date | null;
    plannedExitYear?: number;
  } = {},
) {
  const n = ++counter;
  const priceCents = opts.priceCents ?? usd(100);
  const totalUnits = sh(opts.totalShares ?? 100);
  return prisma.property.create({
    data: {
      slug: `property-${n}-${randomUUID().slice(0, 8)}`,
      name: opts.name ?? `Test House ${n}`,
      street: `${n} Test Street`,
      city: "Columbus",
      state: "OH",
      zip: "43201",
      propertyType: "SINGLE_FAMILY",
      bedrooms: 3,
      bathrooms: 2,
      squareFeet: 1500,
      yearBuilt: 1990,
      description: "Integration test property",
      risks: [],
      purchasePriceCents: (totalUnits * priceCents) / UNITS,
      closingCostsCents: 0n,
      reserveFundCents: 0n,
      totalUnits,
      offeringPricePerShareCents: priceCents,
      projectedMonthlyRentCents: usd(1500),
      projectedAnnualYieldBps: 600,
      status: opts.status ?? "FUNDING",
      fundingDeadline: opts.fundingDeadline === undefined ? utc(2099, 1, 1) : opts.fundingDeadline,
      plannedExitYear: opts.plannedExitYear ?? 2035,
      propertyManagerName: "Test Property Management",
      entityName: `Test House ${n} LLC`,
    },
  });
}

/** Record an appraisal with an explicit per-share value (what the circuit breaker and buyback read). */
export async function addAppraisal(propertyId: string, navPerShareCents: bigint, effectiveDate: Date = utc(2025, 1, 15)) {
  const p = await prisma.property.findUniqueOrThrow({ where: { id: propertyId } });
  return prisma.appraisal.create({
    data: { propertyId, valueCents: (p.totalUnits * navPerShareCents) / UNITS, navPerShareCents, effectiveDate, source: "Test appraisal", createdAt: effectiveDate },
  });
}

export async function createWindow(opts: { opensAt: Date; closesAt: Date; status?: "SCHEDULED" | "OPEN" | "CLOSED"; propertyId?: string | null }) {
  return prisma.tradingWindow.create({ data: { opensAt: opts.opensAt, closesAt: opts.closesAt, status: opts.status ?? "OPEN", propertyId: opts.propertyId ?? null } });
}

/**
 * A fully funded property that is trading. Each holder is given exactly the cash their shares
 * cost and buys through `buyPrimary` at `fundedAt`, so afterwards every holder's wallet is $0
 * (unless they already had cash) and all lots are dated `fundedAt`.
 */
export async function createTradingProperty(opts: {
  holders: readonly (readonly [TestUser, number])[];
  priceCents?: bigint;
  fundedAt?: Date;
  navPerShareCents?: bigint | null;
  plannedExitYear?: number;
  status?: "FUNDED" | "TRADING";
}) {
  const priceCents = opts.priceCents ?? usd(100);
  const fundedAt = opts.fundedAt ?? utc(2025, 1, 10, 12);
  const totalShares = opts.holders.reduce((a, [, s]) => a + s, 0);
  const property = await createProperty({ totalShares, priceCents, plannedExitYear: opts.plannedExitYear });
  for (const [user, shares] of opts.holders) {
    const units = sh(shares);
    const cost = (units * priceCents + UNITS - 1n) / UNITS;
    await fund(user.id, cost);
    await buyPrimary({ userId: user.id, propertyId: property.id, units, idempotencyKey: key("buy"), now: fundedAt });
  }
  const funded = await prisma.property.findUniqueOrThrow({ where: { id: property.id } });
  if (funded.status !== "FUNDED") throw new Error("createTradingProperty: property should be FUNDED after the holders bought every share");
  if (opts.navPerShareCents !== null) await addAppraisal(property.id, opts.navPerShareCents ?? priceCents, fundedAt);
  if (opts.status === "FUNDED") return funded;
  return prisma.property.update({ where: { id: property.id }, data: { status: "TRADING" } });
}

/** Put cash into a property's liquidity reserve with a balanced ledger event (as a dividend's reserve allocation would). */
export async function seedReserve(propertyId: string, amountCents: bigint, when: Date = utc(2025, 2, 10)) {
  await prisma.$transaction(async (tx) => {
    await tx.liquidityReserve.update({ where: { propertyId }, data: { balanceCents: { increment: amountCents } } });
    await postLedger(tx, `test_reserve_${randomUUID()}`, [
      { account: "LIQUIDITY_RESERVE", propertyId, type: "RESERVE_ALLOCATION", amountCents, memo: "Test: reserve funded" },
      { account: "EXTERNAL", propertyId, type: "RESERVE_ALLOCATION", amountCents: -amountCents, memo: "Test: reserve funded" },
    ], when);
  });
}

// ---------- readers ----------

export async function walletOf(userId: string): Promise<{ availableCents: bigint; heldCents: bigint }> {
  const w = await prisma.wallet.findUniqueOrThrow({ where: { userId } });
  return { availableCents: w.availableCents, heldCents: w.heldCents };
}

export async function holdingOf(userId: string, propertyId: string): Promise<{ shareUnits: bigint; reservedUnits: bigint; costBasisCents: bigint }> {
  const h = await prisma.holding.findUnique({ where: { userId_propertyId: { userId, propertyId } } });
  return { shareUnits: h?.shareUnits ?? 0n, reservedUnits: h?.reservedUnits ?? 0n, costBasisCents: h?.costBasisCents ?? 0n };
}

export async function lotsOf(userId: string, propertyId: string) {
  return prisma.holdingLot.findMany({ where: { userId, propertyId }, orderBy: [{ acquiredAt: "asc" }, { createdAt: "asc" }] });
}

/** Sum of a ledger account's entries, optionally for one property / user / type. */
export async function ledgerSum(where: Prisma.LedgerEntryWhereInput): Promise<bigint> {
  const s = await prisma.ledgerEntry.aggregate({ where, _sum: { amountCents: true } });
  return s._sum.amountCents ?? 0n;
}

/** The books must balance at the end of every test, and no balance may ever be negative. */
export async function expectReconciled() {
  const report = await reconcile();
  expect(report.issues).toEqual([]);
  expect(report.ok).toBe(true);
  expect(report.ledgerSumCents).toBe(0n);
  const negativeWallets = await prisma.wallet.count({ where: { OR: [{ availableCents: { lt: 0n } }, { heldCents: { lt: 0n } }] } });
  expect(negativeWallets).toBe(0);
}
