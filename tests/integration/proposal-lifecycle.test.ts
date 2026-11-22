import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { ProposalType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { approveDistribution, payDistribution, previewDistribution, saveFinancials } from "@/lib/services/dividends";
import { castVote, createExitVotes, createProposal, finalizeProposal, publishProposal, recordSale, syncProposals, type ProposalInput } from "@/lib/services/governance";
import { placeOrder } from "@/lib/services/trading";
import {
  createAdmin,
  createTradingProperty,
  createUser,
  createWindow,
  DAY,
  expectReconciled,
  financials,
  fund,
  holdingOf,
  key,
  ledgerSum,
  resetDb,
  sh,
  usd,
  utc,
  walletOf,
  type TestUser,
} from "../helpers/factories";

const FUNDED_AT = utc(2025, 1, 10, 12);
const RECORD = utc(2025, 3, 1);
const OPENS = utc(2025, 3, 2);
const CLOSES = utc(2025, 3, 16);
const DURING = utc(2025, 3, 5);

let admin: TestUser;
let w: TestUser, a: TestUser, b: TestUser, c: TestUser, d: TestUser;
let propertyId: string;

beforeEach(async () => {
  // No holding period, so shares can move after a record date in these tests.
  await resetDb({ holdingPeriodMonths: 0 });
  admin = await createAdmin();
  [w, a, b, c, d] = await fiveHolders();
  // 100 shares: the whale holds 40%, above the 20% voting cap.
  propertyId = (await createTradingProperty({ holders: [[w, 40], [a, 25], [b, 20], [c, 10], [d, 5]], fundedAt: FUNDED_AT, plannedExitYear: 2030 })).id;
});
afterAll(async () => {
  await prisma.$disconnect();
});

async function fiveHolders(): Promise<[TestUser, TestUser, TestUser, TestUser, TestUser]> {
  return Promise.all([createUser({ name: "Whale" }), createUser({ name: "A" }), createUser({ name: "B" }), createUser({ name: "C" }), createUser({ name: "D" })]);
}

function proposal(overrides: Partial<ProposalInput> = {}): ProposalInput {
  return {
    propertyId,
    type: "MAJOR_RENOVATION" as ProposalType,
    title: "Replace the roof",
    summary: "Replace the roof for $12,000.",
    details: "Three bids were obtained.",
    pros: "- Stops leaks",
    cons: "- Lower dividends for four months",
    financialImpact: [{ label: "Roof", current: "20 years old", proposed: "New" }],
    opensAt: OPENS,
    closesAt: CLOSES,
    recordDate: RECORD,
    ...overrides,
  };
}

async function openProposal(overrides: Partial<ProposalInput> = {}, publishAt: Date = OPENS) {
  const p = await createProposal({ actorId: admin.id, data: proposal(overrides) });
  await publishProposal({ actorId: admin.id, proposalId: p.id, now: publishAt });
  return p;
}

const vote = (user: TestUser, proposalId: string, choice: "FOR" | "AGAINST" | "ABSTAIN", now: Date = DURING) => castVote({ userId: user.id, proposalId, choice, now });

describe("proposals", () => {
  it("create → publish → vote → change vote → finalize", async () => {
    const draft = await createProposal({ actorId: admin.id, data: proposal() });
    // Rules are copied from settings when the proposal is created.
    expect(draft).toMatchObject({ status: "DRAFT", quorumBps: 3000, passThresholdBps: 5000, votingCapBps: 2000, outstandingUnits: 0n, createdById: admin.id });
    await prisma.platformSettings.update({ where: { id: 1 }, data: { proposalQuorumBps: 9000 } });
    await expect(vote(a, draft.id, "FOR")).rejects.toThrow();

    await publishProposal({ actorId: admin.id, proposalId: draft.id, now: OPENS });
    const open = await prisma.proposal.findUniqueOrThrow({ where: { id: draft.id } });
    expect(open).toMatchObject({ status: "OPEN", outstandingUnits: sh(100), quorumBps: 3000 });
    expect(await prisma.notification.count({ where: { type: "PROPOSAL_OPENED" } })).toBe(5);
    await expect(publishProposal({ actorId: admin.id, proposalId: draft.id, now: OPENS })).rejects.toThrow(/Only a draft/);

    await vote(a, draft.id, "FOR");
    await vote(b, draft.id, "FOR");
    await vote(c, draft.id, "AGAINST");
    // b changes their mind; one vote per holder, latest choice wins.
    await vote(b, draft.id, "AGAINST", utc(2025, 3, 6));
    expect(await prisma.vote.count({ where: { proposalId: draft.id } })).toBe(3);
    expect(await prisma.vote.findUniqueOrThrow({ where: { proposalId_userId: { proposalId: draft.id, userId: b.id } } })).toMatchObject({ choice: "AGAINST", castAt: utc(2025, 3, 6) });
    expect(await prisma.auditLog.count({ where: { action: "vote.changed" } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: "vote.cast" } })).toBe(3);

    await expect(finalizeProposal({ actorId: admin.id, proposalId: draft.id, now: DURING })).rejects.toThrow(/not closed yet/);
    // FOR 20 (a, capped from 25) vs AGAINST 30 (b 20 + c 10) → fails.
    expect(await finalizeProposal({ actorId: null, proposalId: draft.id, now: CLOSES })).toBe("FAILED");
    const done = await prisma.proposal.findUniqueOrThrow({ where: { id: draft.id } });
    expect(done).toMatchObject({ status: "FAILED", forUnits: sh(20), againstUnits: sh(30), abstainUnits: 0n, finalizedAt: CLOSES, closesAt: CLOSES });
    expect(await prisma.notification.count({ where: { type: "PROPOSAL_RESULT" } })).toBe(5);

    await expect(vote(a, draft.id, "AGAINST", utc(2025, 3, 10))).rejects.toThrow(/has ended/);
    await expect(finalizeProposal({ actorId: null, proposalId: draft.id, now: CLOSES })).rejects.toThrow(/not open/);
    await expectReconciled();
  });

  it("applies the 20% voting cap: raw shares are recorded, capped shares are counted", async () => {
    const p = await openProposal();
    const wv = await vote(w, p.id, "FOR");
    expect(wv).toMatchObject({ rawShareUnits: sh(40), countedShareUnits: sh(20) });
    const av = await vote(a, p.id, "AGAINST");
    expect(av).toMatchObject({ rawShareUnits: sh(25), countedShareUnits: sh(20) });
    const dv = await vote(d, p.id, "AGAINST");
    expect(dv).toMatchObject({ rawShareUnits: sh(5), countedShareUnits: sh(5) });

    // Uncapped this would pass 40–30; capped it is 20–25 and fails.
    expect(await finalizeProposal({ actorId: null, proposalId: p.id, now: CLOSES })).toBe("FAILED");
    expect(await prisma.proposal.findUniqueOrThrow({ where: { id: p.id } })).toMatchObject({ forUnits: sh(20), againstUnits: sh(25) });
  });

  it("passes only when FOR strictly exceeds half of FOR + AGAINST", async () => {
    // Tie: 20 (whale, capped) vs 20 → fails.
    const tie = await openProposal();
    await vote(w, tie.id, "FOR");
    await vote(b, tie.id, "AGAINST");
    expect(await finalizeProposal({ actorId: null, proposalId: tie.id, now: CLOSES })).toBe("FAILED");

    // 20 + 10 FOR vs 20 AGAINST (a's 25, capped) → passes; abstentions are ignored for the threshold.
    const pass = await openProposal();
    await vote(w, pass.id, "FOR");
    await vote(c, pass.id, "FOR");
    await vote(a, pass.id, "AGAINST");
    await vote(d, pass.id, "ABSTAIN");
    expect(await finalizeProposal({ actorId: null, proposalId: pass.id, now: CLOSES })).toBe("PASSED");
    expect(await prisma.proposal.findUniqueOrThrow({ where: { id: pass.id } })).toMatchObject({ status: "PASSED", forUnits: sh(30), againstUnits: sh(20), abstainUnits: sh(5) });
    // A renovation passing does not change the property's status.
    expect((await prisma.property.findUniqueOrThrow({ where: { id: propertyId } })).status).toBe("TRADING");
  });

  it("quorum counts uncapped shares of everyone who voted, abstentions included", async () => {
    const none = await openProposal();
    await vote(a, none.id, "FOR"); // 25% < 30%
    expect(await finalizeProposal({ actorId: null, proposalId: none.id, now: CLOSES })).toBe("NO_QUORUM");
    expect((await prisma.proposal.findUniqueOrThrow({ where: { id: none.id } })).status).toBe("NO_QUORUM");

    const exactly = await openProposal();
    await vote(d, exactly.id, "FOR"); // 5
    await vote(a, exactly.id, "ABSTAIN"); // 25 → 30% exactly
    expect(await finalizeProposal({ actorId: null, proposalId: exactly.id, now: CLOSES })).toBe("PASSED");

    // The whale alone is 40% of shares (counted only 20%), which still meets quorum.
    const whale = await openProposal();
    await vote(w, whale.id, "AGAINST");
    expect(await finalizeProposal({ actorId: null, proposalId: whale.id, now: CLOSES })).toBe("FAILED");

    const empty = await openProposal();
    expect(await finalizeProposal({ actorId: null, proposalId: empty.id, now: CLOSES })).toBe("NO_QUORUM");
  });

  it("voting power comes from record-date holdings: shares bought later do not count", async () => {
    const newcomer = await createUser({ name: "Newcomer" });
    await fund(newcomer.id, usd(2000));
    // After the record date, a sells 10 shares to the newcomer and the whale buys 5 from b.
    await fund(w.id, usd(1000));
    await createWindow({ opensAt: utc(2025, 3, 1, 12), closesAt: utc(2025, 3, 8) });
    await placeOrder({ userId: a.id, propertyId, side: "SELL", limitPriceCents: usd(100), units: sh(10), idempotencyKey: key(), now: utc(2025, 3, 1, 13) });
    await placeOrder({ userId: newcomer.id, propertyId, side: "BUY", limitPriceCents: usd(100), units: sh(10), idempotencyKey: key(), now: utc(2025, 3, 1, 14) });
    expect((await holdingOf(newcomer.id, propertyId)).shareUnits).toBe(sh(10));

    const p = await openProposal();
    await expect(vote(newcomer, p.id, "FOR")).rejects.toThrow(/held shares on the record date/);
    // a now holds 15 but votes with the 25 held on the record date (capped to 20).
    expect(await vote(a, p.id, "FOR")).toMatchObject({ rawShareUnits: sh(25), countedShareUnits: sh(20) });
    // Shares sold after the record date still count for the seller, and outstanding is fixed.
    expect((await prisma.proposal.findUniqueOrThrow({ where: { id: p.id } })).outstandingUnits).toBe(sh(100));
    await expectReconciled();
  });

  it("refuses votes before opening, at or after closing, and from non-holders", async () => {
    const outsider = await createUser();
    const p = await openProposal({}, RECORD); // published before it opens
    await expect(vote(a, p.id, "FOR", utc(2025, 3, 1, 12))).rejects.toThrow(/not opened yet/);
    await expect(vote(a, p.id, "FOR", OPENS)).resolves.toMatchObject({ choice: "FOR" });
    await expect(vote(a, p.id, "AGAINST", new Date(CLOSES.getTime() - 1))).resolves.toMatchObject({ choice: "AGAINST" });
    await expect(vote(b, p.id, "FOR", CLOSES)).rejects.toThrow(/has closed/);
    await expect(vote(outsider, p.id, "FOR")).rejects.toThrow(/held shares on the record date/);
    await expect(castVote({ userId: a.id, proposalId: "missing", choice: "FOR", now: DURING })).rejects.toThrow(/not found/);
    expect(await prisma.vote.count()).toBe(1);
  });

  it("validates dates and publishing", async () => {
    await expect(createProposal({ actorId: admin.id, data: proposal({ closesAt: OPENS }) })).rejects.toThrow(/close after it opens/);
    await expect(createProposal({ actorId: admin.id, data: proposal({ recordDate: utc(2025, 3, 3) }) })).rejects.toThrow(/record date must be on or before/);
    const p = await createProposal({ actorId: admin.id, data: proposal() });
    await expect(publishProposal({ actorId: admin.id, proposalId: p.id, now: utc(2025, 2, 28) })).rejects.toThrow(/record date is in the future/);
    await expect(publishProposal({ actorId: admin.id, proposalId: p.id, now: CLOSES })).rejects.toThrow(/closing date has already passed/);
    // Before anyone held shares there is no one to vote.
    const early = await createProposal({ actorId: admin.id, data: proposal({ recordDate: utc(2025, 1, 1), opensAt: utc(2025, 1, 2) }) });
    await expect(publishProposal({ actorId: admin.id, proposalId: early.id, now: OPENS })).rejects.toThrow(/Nobody held shares/);
  });

  it("an admin can close voting early; syncProposals finalizes what is due", async () => {
    const early = await openProposal();
    await vote(w, early.id, "FOR");
    await vote(c, early.id, "FOR");
    expect(await finalizeProposal({ actorId: admin.id, proposalId: early.id, force: true, now: DURING })).toBe("PASSED");
    expect(await prisma.proposal.findUniqueOrThrow({ where: { id: early.id } })).toMatchObject({ closesAt: DURING, finalizedAt: DURING });

    const due = await openProposal();
    await vote(a, due.id, "AGAINST");
    await vote(b, due.id, "AGAINST");
    // A day before close, non-voters are reminded once.
    expect(await syncProposals(utc(2025, 3, 15, 1))).toEqual({ finalized: 0, reminded: 3 });
    expect(await syncProposals(utc(2025, 3, 15, 2))).toEqual({ finalized: 0, reminded: 0 });
    expect(await syncProposals(CLOSES)).toEqual({ finalized: 1, reminded: 0 });
    expect((await prisma.proposal.findUniqueOrThrow({ where: { id: due.id } })).status).toBe("FAILED");
  });

  it("a passed sale proposal puts the property into EXIT_VOTE", async () => {
    const p = await openProposal({ type: "SELL_PROPERTY", title: "Sell now" });
    await vote(w, p.id, "FOR");
    await vote(a, p.id, "FOR");
    expect(await finalizeProposal({ actorId: null, proposalId: p.id, now: CLOSES })).toBe("PASSED");
    expect(await prisma.property.findUniqueOrThrow({ where: { id: propertyId } })).toMatchObject({ status: "EXIT_VOTE", preExitStatus: "TRADING" });
  });
});

describe("planned exit", () => {
  const EXIT_NOW = utc(2030, 3, 1, 9);
  const EXIT_CLOSES = new Date(EXIT_NOW.getTime() + 14 * DAY);

  it("createExitVotes opens the planned-exit vote and sets EXIT_VOTE, once", async () => {
    const notYet = await createTradingProperty({ holders: [[a, 10]], fundedAt: FUNDED_AT, plannedExitYear: 2031 });
    expect(await createExitVotes(utc(2029, 12, 31))).toEqual({ created: [] });

    const res = await createExitVotes(EXIT_NOW);
    const property = await prisma.property.findUniqueOrThrow({ where: { id: propertyId } });
    expect(res.created).toEqual([property.slug]);
    expect(property).toMatchObject({ status: "EXIT_VOTE", preExitStatus: "TRADING", plannedExitYear: 2030 });
    const p = await prisma.proposal.findFirstOrThrow({ where: { propertyId } });
    expect(p).toMatchObject({ type: "SELL_PROPERTY", isPlannedExit: true, extendYears: 1, status: "OPEN", recordDate: EXIT_NOW, opensAt: EXIT_NOW, closesAt: EXIT_CLOSES, outstandingUnits: sh(100), createdById: admin.id });
    expect((await prisma.property.findUniqueOrThrow({ where: { id: notYet.id } })).status).toBe("TRADING");

    expect(await createExitVotes(new Date(EXIT_NOW.getTime() + DAY))).toEqual({ created: [] });
    expect(await prisma.proposal.count({ where: { isPlannedExit: true } })).toBe(1);
  });

  it("a failed exit vote extends the planned exit year and returns the property to TRADING", async () => {
    await createExitVotes(EXIT_NOW);
    const p = await prisma.proposal.findFirstOrThrow({ where: { propertyId } });
    await vote(w, p.id, "AGAINST", utc(2030, 3, 2));
    await vote(a, p.id, "AGAINST", utc(2030, 3, 2));
    await vote(c, p.id, "FOR", utc(2030, 3, 2));
    expect(await finalizeProposal({ actorId: null, proposalId: p.id, now: EXIT_CLOSES })).toBe("FAILED");
    expect(await prisma.property.findUniqueOrThrow({ where: { id: propertyId } })).toMatchObject({ status: "TRADING", plannedExitYear: 2031, preExitStatus: null });

    // Next year the vote comes round again.
    expect((await createExitVotes(utc(2031, 3, 1))).created).toHaveLength(1);
  });

  it("an exit vote without quorum also extends the exit year", async () => {
    await createExitVotes(EXIT_NOW);
    const p = await prisma.proposal.findFirstOrThrow({ where: { propertyId } });
    await vote(d, p.id, "FOR", utc(2030, 3, 2));
    expect(await finalizeProposal({ actorId: null, proposalId: p.id, now: EXIT_CLOSES })).toBe("NO_QUORUM");
    expect(await prisma.property.findUniqueOrThrow({ where: { id: propertyId } })).toMatchObject({ status: "TRADING", plannedExitYear: 2031 });
    await expect(recordSale({ actorId: admin.id, propertyId, salePriceCents: usd(20_000), saleCostsCents: 0n, idempotencyKey: key() })).rejects.toThrow();
  });

  it("a failed exit vote returns a FUNDED property to FUNDED, not TRADING", async () => {
    await prisma.property.update({ where: { id: propertyId }, data: { status: "FUNDED" } });
    await createExitVotes(EXIT_NOW);
    expect(await prisma.property.findUniqueOrThrow({ where: { id: propertyId } })).toMatchObject({ status: "EXIT_VOTE", preExitStatus: "FUNDED" });
    const p = await prisma.proposal.findFirstOrThrow({ where: { propertyId } });
    await vote(w, p.id, "AGAINST", utc(2030, 3, 2));
    expect(await finalizeProposal({ actorId: null, proposalId: p.id, now: EXIT_CLOSES })).toBe("FAILED");
    expect(await prisma.property.findUniqueOrThrow({ where: { id: propertyId } })).toMatchObject({ status: "FUNDED", plannedExitYear: 2031 });
  });
});

describe("recording a sale", () => {
  it("after a passed exit vote, pays every holder pro rata, cancels open orders first, and closes the property", async () => {
    // 99 shares so January's dividend leaves a rounding carry.
    await resetDb({ holdingPeriodMonths: 0 });
    admin = await createAdmin();
    [w, a, b, c, d] = await fiveHolders();
    const holders = [[w, 40], [a, 25], [b, 20], [c, 10], [d, 4]] as const;
    const property = await createTradingProperty({ holders, fundedAt: FUNDED_AT, plannedExitYear: 2026 });

    await saveFinancials({ actorId: admin.id, propertyId: property.id, month: "2025-01", data: financials({ grossRentCents: 12_345n }) });
    const jan = await previewDistribution({ actorId: admin.id, propertyId: property.id, month: "2025-01" });
    await approveDistribution({ actorId: admin.id, distributionId: jan.id });
    await payDistribution({ actorId: admin.id, distributionId: jan.id, idempotencyKey: key(), now: utc(2025, 2, 10) });
    const before = await prisma.property.findUniqueOrThrow({ where: { id: property.id }, include: { reserve: true } });
    const reserveCents = before.reserve!.balanceCents;
    const carryCents = before.dividendCarryCents;
    expect(reserveCents).toBe(1_234n);
    expect(carryCents).toBe(1n);
    const dividends = new Map((await prisma.dividendPayment.findMany()).map((p) => [p.userId, p.amountCents]));

    // Open orders while still trading: d offers 2 shares, an outsider bids below.
    const outsider = await createUser({ fundCents: usd(1000) });
    await createWindow({ opensAt: utc(2026, 3, 1), closesAt: utc(2026, 3, 31) });
    const sell = await placeOrder({ userId: d.id, propertyId: property.id, side: "SELL", limitPriceCents: usd(100), units: sh(2), idempotencyKey: key(), now: utc(2026, 3, 1, 12) });
    const buy = await placeOrder({ userId: outsider.id, propertyId: property.id, side: "BUY", limitPriceCents: usd(90), units: sh(3), idempotencyKey: key(), now: utc(2026, 3, 1, 13) });
    expect(await walletOf(outsider.id)).toEqual({ availableCents: usd(730), heldCents: usd(270) });

    // The planned-exit vote passes.
    const exitAt = utc(2026, 3, 2);
    expect((await createExitVotes(exitAt)).created).toEqual([property.slug]);
    const p = await prisma.proposal.findFirstOrThrow({ where: { propertyId: property.id } });
    for (const u of [w, a]) await vote(u, p.id, "FOR", utc(2026, 3, 3));
    await vote(b, p.id, "AGAINST", utc(2026, 3, 3));
    expect(await finalizeProposal({ actorId: null, proposalId: p.id, now: p.closesAt })).toBe("PASSED");
    expect((await prisma.property.findUniqueOrThrow({ where: { id: property.id } })).status).toBe("EXIT_VOTE");

    const salePriceCents = usd(12_000);
    const saleCostsCents = usd(700);
    const soldAt = utc(2026, 4, 1);
    const walletsBefore = new Map(await Promise.all([w, a, b, c, d].map(async (u) => [u.id, (await walletOf(u.id)).availableCents] as const)));
    const k = key();
    expect(await recordSale({ actorId: admin.id, propertyId: property.id, salePriceCents, saleCostsCents, idempotencyKey: k, now: soldAt })).toEqual({ replayed: false });

    // Open orders were closed and what they held released.
    for (const id of [sell.orderId, buy.orderId]) expect(["EXPIRED", "CANCELLED"]).toContain((await prisma.order.findUniqueOrThrow({ where: { id } })).status);
    expect(await walletOf(outsider.id)).toEqual({ availableCents: usd(1000), heldCents: 0n });

    // Everything is paid out: sale − costs + reserve + carry, split by shares.
    const net = salePriceCents - saleCostsCents + reserveCents + carryCents;
    const payouts = await prisma.exitPayout.findMany({ where: { propertyId: property.id } });
    expect(payouts).toHaveLength(5);
    expect(payouts.reduce((s, x) => s + x.amountCents, 0n)).toBe(net);
    const total = sh(99);
    for (const [u, shares] of holders) {
      const x = payouts.find((y) => y.userId === u.id)!;
      const exact = (net * sh(shares)) / total;
      expect(x.amountCents === exact || x.amountCents === exact + 1n).toBe(true);
      expect(x).toMatchObject({ shareUnits: sh(shares), costBasisCents: usd(shares * 100), dividendsCents: dividends.get(u.id) ?? 0n });
      expect((await walletOf(u.id)).availableCents).toBe(walletsBefore.get(u.id)! + x.amountCents);
      expect(await holdingOf(u.id, property.id)).toEqual({ shareUnits: 0n, reservedUnits: 0n, costBasisCents: 0n });
    }
    expect(await prisma.holdingLot.count({ where: { propertyId: property.id, remainingUnits: { gt: 0n } } })).toBe(0);

    const sold = await prisma.property.findUniqueOrThrow({ where: { id: property.id }, include: { reserve: true } });
    expect(sold).toMatchObject({ status: "SOLD", salePriceCents, saleCostsCents, soldAt, dividendCarryCents: 0n });
    expect(sold.reserve!.balanceCents).toBe(0n);
    expect(await ledgerSum({ account: "LIQUIDITY_RESERVE", propertyId: property.id })).toBe(0n);
    expect(await ledgerSum({ account: "PROPERTY_OPERATING", propertyId: property.id })).toBe(0n);
    expect(await prisma.notification.count({ where: { type: "SALE_COMPLETED" } })).toBe(5);

    // Replays are no-ops; a second sale is refused.
    expect(await recordSale({ actorId: admin.id, propertyId: property.id, salePriceCents, saleCostsCents, idempotencyKey: k, now: soldAt })).toEqual({ replayed: true });
    await expect(recordSale({ actorId: admin.id, propertyId: property.id, salePriceCents, saleCostsCents, idempotencyKey: key(), now: soldAt })).rejects.toThrow(/already been sold/);
    expect(await prisma.exitPayout.count()).toBe(5);
    await expectReconciled();
  });

  it("is refused without a passed sale proposal, and validates the amounts", async () => {
    const sale = (extra: Partial<Parameters<typeof recordSale>[0]> = {}) =>
      recordSale({ actorId: admin.id, propertyId, salePriceCents: usd(20_000), saleCostsCents: usd(1000), idempotencyKey: key(), now: utc(2025, 6, 1), ...extra });

    await expect(sale()).rejects.toThrow(/after holders voted to sell|passed a proposal to sell/);
    await expect(sale({ salePriceCents: 0n })).rejects.toThrow(/Enter the sale price/);
    await expect(sale({ saleCostsCents: usd(20_001) })).rejects.toThrow(/Selling costs must be between/);
    await expect(sale({ saleCostsCents: -1n })).rejects.toThrow(/Selling costs must be between/);

    // A failed sale proposal is not enough.
    const failed = await openProposal({ type: "SELL_PROPERTY" });
    await vote(a, failed.id, "AGAINST");
    await vote(b, failed.id, "FOR");
    expect(await finalizeProposal({ actorId: null, proposalId: failed.id, now: CLOSES })).toBe("FAILED");
    await expect(sale()).rejects.toThrow(/after holders voted to sell|passed a proposal to sell/);

    expect(await prisma.exitPayout.count()).toBe(0);
    expect((await prisma.property.findUniqueOrThrow({ where: { id: propertyId } })).status).toBe("TRADING");
    await expectReconciled();
  });

  it("is refused unless the property is in its exit process, even after an old sale proposal passed", async () => {
    const p = await openProposal({ type: "SELL_PROPERTY" });
    await vote(w, p.id, "FOR");
    await vote(a, p.id, "FOR");
    expect(await finalizeProposal({ actorId: null, proposalId: p.id, now: CLOSES })).toBe("PASSED");
    // The sale fell through and the admin put the property back into trading.
    await prisma.property.update({ where: { id: propertyId }, data: { status: "TRADING", preExitStatus: null } });

    await expect(recordSale({ actorId: admin.id, propertyId, salePriceCents: usd(20_000), saleCostsCents: 0n, idempotencyKey: key(), now: utc(2025, 6, 1) })).rejects.toThrow(/exit process/);
    expect(await prisma.exitPayout.count()).toBe(0);
    expect((await holdingOf(w.id, propertyId)).shareUnits).toBe(sh(40));
    await expectReconciled();
  });

  it("is refused while any ended month's dividend is unpaid, and pays out the final month's income", async () => {
    const p = await openProposal({ type: "SELL_PROPERTY" });
    await vote(w, p.id, "FOR");
    await vote(a, p.id, "FOR");
    await finalizeProposal({ actorId: null, proposalId: p.id, now: CLOSES });
    for (const month of ["2025-01", "2025-02"]) await saveFinancials({ actorId: admin.id, propertyId, month, data: financials({ grossRentCents: usd(100) }) });
    const jan = await previewDistribution({ actorId: admin.id, propertyId, month: "2025-01" });
    const feb = await previewDistribution({ actorId: admin.id, propertyId, month: "2025-02" });
    await approveDistribution({ actorId: admin.id, distributionId: jan.id });

    const sale = (finalOperatingCents?: bigint) =>
      recordSale({ actorId: admin.id, propertyId, salePriceCents: usd(10_000), saleCostsCents: 0n, finalOperatingCents, idempotencyKey: key(), now: utc(2025, 6, 1) });
    await expect(sale()).rejects.toThrow(/Approve and pay the January 2025 dividend/);
    await payDistribution({ actorId: admin.id, distributionId: jan.id, idempotencyKey: key(), now: utc(2025, 6, 1) });
    // A draft also blocks the sale: that month's rent must reach holders first.
    await expect(sale()).rejects.toThrow(/Approve and pay the February 2025 dividend/);
    await approveDistribution({ actorId: admin.id, distributionId: feb.id });
    await payDistribution({ actorId: admin.id, distributionId: feb.id, idempotencyKey: key(), now: utc(2025, 6, 1) });

    await expect(sale(-1n)).rejects.toThrow(/final month's net income as zero or more/);
    await sale(usd(55.55));
    const payouts = await prisma.exitPayout.aggregate({ _sum: { amountCents: true } });
    // Sale + the reserve's $10 from each paid month + the final month's income.
    expect(payouts._sum.amountCents).toBe(usd(10_000) + usd(20) + usd(55.55));
    expect(await ledgerSum({ account: "EXTERNAL", propertyId, type: "EXIT_PROCEEDS" })).toBe(-(usd(10_000) + usd(55.55)));
    await expectReconciled();
  });

  it("is refused if the most recent sale vote failed, even though an earlier one passed", async () => {
    const first = await openProposal({ type: "SELL_PROPERTY", title: "Sell" });
    await vote(w, first.id, "FOR");
    await vote(a, first.id, "FOR");
    expect(await finalizeProposal({ actorId: null, proposalId: first.id, now: CLOSES })).toBe("PASSED");
    expect((await prisma.property.findUniqueOrThrow({ where: { id: propertyId } })).status).toBe("EXIT_VOTE");

    const second = await openProposal({ type: "SELL_PROPERTY", title: "Sell at the lower offer", recordDate: utc(2025, 4, 1), opensAt: utc(2025, 4, 2), closesAt: utc(2025, 4, 16) }, utc(2025, 4, 2));
    await vote(w, second.id, "AGAINST", utc(2025, 4, 5));
    await vote(a, second.id, "AGAINST", utc(2025, 4, 5));
    expect(await finalizeProposal({ actorId: null, proposalId: second.id, now: utc(2025, 4, 16) })).toBe("FAILED");

    await expect(recordSale({ actorId: admin.id, propertyId, salePriceCents: usd(9_000), saleCostsCents: 0n, idempotencyKey: key(), now: utc(2025, 5, 1) })).rejects.toThrow(/passed a proposal to sell/);
    expect(await prisma.exitPayout.count()).toBe(0);
    await expectReconciled();
  });
});
