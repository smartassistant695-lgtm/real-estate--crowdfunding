import "server-only";
import type { Prisma, Proposal, ProposalType } from "@prisma/client";
import { claimIdempotencyKey, DomainError, lockProperty, lockWallets, prisma, runTx, storeIdempotentResult, type Tx } from "@/lib/db";
import { distributeExitProceeds, netSaleProceeds } from "@/lib/domain/exit";
import { formatBps, formatCents, formatUnits } from "@/lib/domain/money";
import { countedUnits, decide, tallyVotes, type Choice } from "@/lib/domain/voting";
import { getSettings } from "@/lib/settings";
import { audit } from "./audit";
import { holdersAt, postLedger, type LedgerLine } from "./ledger";
import { notify, type Notice } from "./notifications";
import { expireOrdersForProperty } from "./trading";

export type ImpactRow = { label: string; current: string; proposed: string };

export type ProposalInput = {
  propertyId: string;
  type: ProposalType;
  title: string;
  summary: string;
  details: string;
  pros: string;
  cons: string;
  financialImpact: ImpactRow[];
  opensAt: Date;
  closesAt: Date;
  recordDate: Date;
  extendYears?: number | null;
  isPlannedExit?: boolean;
};

function validateDates(i: { opensAt: Date; closesAt: Date; recordDate: Date }) {
  if (i.closesAt.getTime() <= i.opensAt.getTime()) throw new DomainError("Voting must close after it opens.", "closesAt");
  if (i.recordDate.getTime() > i.opensAt.getTime()) throw new DomainError("The record date must be on or before the day voting opens.", "recordDate");
}

/** Create a proposal as a DRAFT. Quorum, threshold and cap are copied from settings so later edits to settings cannot change a vote in progress. */
export async function createProposal(input: { actorId: string; data: ProposalInput; ipAddress?: string | null }, txArg?: Tx): Promise<Proposal> {
  validateDates(input.data);
  const run = async (tx: Tx) => {
    const settings = await getSettings(tx);
    const p = await tx.proposal.create({
      data: {
        ...input.data,
        financialImpact: input.data.financialImpact as unknown as Prisma.InputJsonValue,
        isPlannedExit: input.data.isPlannedExit ?? false,
        extendYears: input.data.extendYears ?? null,
        createdById: input.actorId,
        quorumBps: settings.proposalQuorumBps,
        passThresholdBps: settings.proposalPassThresholdBps,
        votingCapBps: settings.votingCapBps,
        status: "DRAFT",
      },
    });
    await audit(tx, { actorId: input.actorId, action: "proposal.created", entityType: "Proposal", entityId: p.id, after: { type: p.type, title: p.title, opensAt: p.opensAt, closesAt: p.closesAt }, ipAddress: input.ipAddress });
    return p;
  };
  return txArg ? run(txArg) : runTx(run);
}

/**
 * Publish a draft. Fixes the shares outstanding at the record date (the denominator for quorum
 * and the voting cap) and tells every holder of record. If opensAt is in the future the
 * proposal is visible but votes are refused until then.
 */
export async function publishProposal(input: { actorId: string | null; proposalId: string; ipAddress?: string | null; now?: Date }, txArg?: Tx) {
  const now = input.now ?? new Date();
  let afterCommit: (() => Promise<void>) | undefined;
  const run = async (tx: Tx) => {
    const p = await tx.proposal.findUnique({ where: { id: input.proposalId }, include: { property: true } });
    if (!p) throw new DomainError("Proposal not found.");
    if (p.status !== "DRAFT") throw new DomainError("Only a draft can be published.");
    if (p.recordDate.getTime() > now.getTime()) throw new DomainError("The record date is in the future. Publish on or after the record date.");
    if (p.closesAt.getTime() <= now.getTime()) throw new DomainError("The closing date has already passed. Edit the dates first.");
    const holders = await holdersAt(tx, p.propertyId, p.recordDate);
    const outstanding = holders.reduce((a, h) => a + h.units, 0n);
    if (outstanding === 0n) throw new DomainError("Nobody held shares at the record date, so there is no one to vote.");
    await tx.proposal.update({ where: { id: p.id }, data: { status: "OPEN", outstandingUnits: outstanding } });
    await audit(tx, { actorId: input.actorId, action: "proposal.published", entityType: "Proposal", entityId: p.id, after: { outstandingUnits: outstanding, holders: holders.length }, ipAddress: input.ipAddress });
    afterCommit = await notify(tx, holders.map((h) => ({
      userId: h.userId,
      type: "PROPOSAL_OPENED" as const,
      title: `Vote: ${p.title}`,
      body: `A proposal for ${p.property.name} is open for voting until ${p.closesAt.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" })}. ${p.summary}`,
      href: `/proposals/${p.id}`,
    })));
  };
  if (txArg) {
    await run(txArg);
    return afterCommit;
  }
  await runTx(run);
  await afterCommit?.();
  return undefined;
}

/** A holder's voting power on a proposal: shares at the record date, and the capped figure that counts. */
export async function votingPower(tx: Tx | typeof prisma, proposal: Pick<Proposal, "propertyId" | "recordDate" | "outstandingUnits" | "votingCapBps">, userId: string) {
  const sum = await tx.ledgerEntry.aggregate({
    where: { propertyId: proposal.propertyId, userId, account: "USER_WALLET", shareUnits: { not: null }, createdAt: { lte: proposal.recordDate } },
    _sum: { shareUnits: true },
  });
  const raw = sum._sum.shareUnits ?? 0n;
  const rawUnits = raw > 0n ? raw : 0n;
  return { rawUnits, countedUnits: countedUnits(rawUnits, proposal.outstandingUnits, proposal.votingCapBps) };
}

/** Cast or change a vote. Allowed any number of times until voting closes; every change is audited. */
export async function castVote(input: { userId: string; proposalId: string; choice: Choice; ipAddress?: string | null; now?: Date }) {
  const now = input.now ?? new Date();
  return runTx(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Proposal" WHERE "id" = ${input.proposalId} FOR UPDATE`;
    const p = await tx.proposal.findUnique({ where: { id: input.proposalId } });
    if (!p) throw new DomainError("Proposal not found.");
    if (p.status !== "OPEN") throw new DomainError("Voting on this proposal has ended.");
    if (now.getTime() < p.opensAt.getTime()) throw new DomainError("Voting has not opened yet.");
    if (now.getTime() >= p.closesAt.getTime()) throw new DomainError("Voting on this proposal has closed.");
    const power = await votingPower(tx, p, input.userId);
    if (power.rawUnits <= 0n) throw new DomainError("Only investors who held shares on the record date can vote on this proposal.");
    const before = await tx.vote.findUnique({ where: { proposalId_userId: { proposalId: p.id, userId: input.userId } } });
    const vote = await tx.vote.upsert({
      where: { proposalId_userId: { proposalId: p.id, userId: input.userId } },
      create: { proposalId: p.id, userId: input.userId, choice: input.choice, rawShareUnits: power.rawUnits, countedShareUnits: power.countedUnits, castAt: now },
      update: { choice: input.choice, rawShareUnits: power.rawUnits, countedShareUnits: power.countedUnits, castAt: now },
    });
    await audit(tx, { actorId: input.userId, action: before ? "vote.changed" : "vote.cast", entityType: "Vote", entityId: vote.id, before: before ? { choice: before.choice } : undefined, after: { proposalId: p.id, choice: input.choice, rawShareUnits: power.rawUnits, countedShareUnits: power.countedUnits }, ipAddress: input.ipAddress });
    return vote;
  });
}

/** Close voting and record the outcome. `force` lets an admin close early. */
export async function finalizeProposal(input: { actorId: string | null; proposalId: string; force?: boolean; now?: Date }) {
  const now = input.now ?? new Date();
  let afterCommit: (() => Promise<void>) | undefined;
  const outcome = await runTx(async (tx) => {
    const found = await tx.proposal.findUnique({ where: { id: input.proposalId }, select: { propertyId: true } });
    if (!found) throw new DomainError("Proposal not found.");
    const property = await lockProperty(tx, found.propertyId);
    await tx.$queryRaw`SELECT "id" FROM "Proposal" WHERE "id" = ${input.proposalId} FOR UPDATE`;
    const p = await tx.proposal.findUniqueOrThrow({ where: { id: input.proposalId }, include: { votes: true } });
    if (p.status !== "OPEN") throw new DomainError("This proposal is not open.");
    if (!input.force && now.getTime() < p.closesAt.getTime()) throw new DomainError("Voting has not closed yet.");

    const tally = tallyVotes(p.votes);
    const result = decide(tally, p.outstandingUnits, p.quorumBps, p.passThresholdBps);
    await tx.proposal.update({
      where: { id: p.id },
      data: { status: result, forUnits: tally.forUnits, againstUnits: tally.againstUnits, abstainUnits: tally.abstainUnits, finalizedAt: now, closesAt: now.getTime() < p.closesAt.getTime() ? now : p.closesAt },
    });

    let consequence = "";
    if (p.isPlannedExit) {
      if (result === "PASSED") {
        consequence = " The property will be listed for sale. Proceeds are paid out when the sale closes.";
      } else {
        const years = p.extendYears ?? 1;
        await tx.property.update({ where: { id: property.id }, data: { plannedExitYear: property.plannedExitYear + years, status: property.status === "EXIT_VOTE" ? "TRADING" : property.status } });
        consequence = ` The planned exit moves out ${years} year${years === 1 ? "" : "s"}, to ${property.plannedExitYear + years}. Holders will vote again then.`;
      }
    } else if (p.type === "EXTEND_EXIT_DATE" && result === "PASSED") {
      const years = p.extendYears ?? 1;
      await tx.property.update({ where: { id: property.id }, data: { plannedExitYear: property.plannedExitYear + years } });
      consequence = ` The planned exit year is now ${property.plannedExitYear + years}.`;
    } else if (p.type === "SELL_PROPERTY" && result === "PASSED") {
      await tx.property.update({ where: { id: property.id }, data: { status: "EXIT_VOTE" } });
      consequence = " The property will be listed for sale. Proceeds are paid out when the sale closes.";
    }

    await audit(tx, { actorId: input.actorId, action: "proposal.finalized", entityType: "Proposal", entityId: p.id, before: { status: "OPEN" }, after: { status: result, ...tally, outstandingUnits: p.outstandingUnits, forced: !!input.force } });
    const holders = await holdersAt(tx, p.propertyId, p.recordDate);
    const word = result === "PASSED" ? "passed" : result === "FAILED" ? "did not pass" : "did not reach quorum";
    afterCommit = await notify(tx, holders.map((h) => ({
      userId: h.userId,
      type: "PROPOSAL_RESULT" as const,
      title: `Result: ${p.title}`,
      body: `The proposal ${word}.${consequence}`,
      href: `/proposals/${p.id}`,
    })));
    return result;
  });
  await afterCommit?.();
  return outcome;
}

/** Job: remind voters a day before close, and finalize proposals whose voting has ended. */
export async function syncProposals(now = new Date()): Promise<{ finalized: number; reminded: number }> {
  const closing = await prisma.proposal.findMany({
    where: { status: "OPEN", closingSoonSentAt: null, closesAt: { gt: now, lte: new Date(now.getTime() + 24 * 3600 * 1000) } },
    include: { votes: { select: { userId: true } } },
  });
  let reminded = 0;
  for (const p of closing) {
    const voted = new Set(p.votes.map((v) => v.userId));
    const holders = (await holdersAt(prisma as unknown as Tx, p.propertyId, p.recordDate)).filter((h) => !voted.has(h.userId));
    const send = await notify(prisma, holders.map((h) => ({ userId: h.userId, type: "PROPOSAL_CLOSING" as const, title: `Voting closes soon: ${p.title}`, body: "You have not voted yet. Voting closes within a day.", href: `/proposals/${p.id}` })));
    await prisma.proposal.update({ where: { id: p.id }, data: { closingSoonSentAt: now } });
    await send();
    reminded += holders.length;
  }
  const due = await prisma.proposal.findMany({ where: { status: "OPEN", closesAt: { lte: now } }, select: { id: true } });
  for (const { id } of due) await finalizeProposal({ actorId: null, proposalId: id, now });
  return { finalized: due.length, reminded };
}

/**
 * Job: when a property reaches its planned exit year, open the exit vote automatically.
 * FOR = sell now. If the vote fails or lacks quorum, the exit moves out by `extendYears`.
 */
export async function createExitVotes(now = new Date()): Promise<{ created: string[] }> {
  const year = now.getUTCFullYear();
  const due = await prisma.property.findMany({ where: { status: { in: ["FUNDED", "TRADING"] }, plannedExitYear: { lte: year } } });
  const admin = await prisma.user.findFirst({ where: { role: "ADMIN" }, orderBy: { createdAt: "asc" } });
  if (!admin) return { created: [] };
  const created: string[] = [];
  for (const d of due) {
    let afterCommit: (() => Promise<void>) | undefined;
    const made = await runTx(async (tx) => {
      const property = await lockProperty(tx, d.id);
      if (!["FUNDED", "TRADING"].includes(property.status) || property.plannedExitYear > year) return false;
      const open = await tx.proposal.findFirst({ where: { propertyId: property.id, isPlannedExit: true, status: { in: ["DRAFT", "OPEN"] } } });
      if (open) return false;
      const holders = await holdersAt(tx, property.id, now);
      if (holders.length === 0) return false;
      const appraisal = await tx.appraisal.findFirst({ where: { propertyId: property.id }, orderBy: { effectiveDate: "desc" } });
      const p = await createProposal({
        actorId: admin.id,
        data: {
          propertyId: property.id,
          type: "SELL_PROPERTY",
          isPlannedExit: true,
          extendYears: 1,
          title: `Planned exit: sell ${property.name} or hold one more year`,
          summary: `${property.name} has reached its planned exit year (${property.plannedExitYear}). Vote FOR to sell the home and pay out the proceeds. Vote AGAINST to keep renting it for one more year and vote again then.`,
          details: `When this property was offered, the plan was to sell it in **${property.plannedExitYear}**. That year is here, so the decision goes to the people who own it.\n\n- **FOR** — the manager lists the home for sale. When the sale closes, the proceeds (after selling costs), the liquidity reserve and any undistributed cash are paid to holders in proportion to their shares, and the property is closed.\n- **AGAINST** — the home stays rented and keeps paying monthly dividends. The planned exit moves to ${property.plannedExitYear + 1} and holders vote again.\n\nIf fewer than the required share of holders vote, the home is not sold and the exit date moves out one year.`,
          pros: "- Realises the current value of the home in cash\n- Ends exposure to future repair costs and vacancies",
          cons: "- Selling costs (typically 5–7% of the price) reduce proceeds\n- Monthly dividends stop\n- A sale is a taxable event for holders",
          financialImpact: appraisal
            ? [
                { label: "Latest appraised value", current: formatCents(appraisal.valueCents, { whole: true }), proposed: "Sale price set by the market" },
                { label: "Appraised value per share", current: formatCents(appraisal.navPerShareCents), proposed: "Paid out net of selling costs" },
                { label: "Monthly dividends", current: "Continue", proposed: "Stop at sale" },
              ]
            : [],
          opensAt: now,
          closesAt: new Date(now.getTime() + 14 * 24 * 3600 * 1000),
          recordDate: now,
        },
      }, tx);
      afterCommit = await publishProposal({ actorId: null, proposalId: p.id, now }, tx);
      await tx.property.update({ where: { id: property.id }, data: { status: "EXIT_VOTE" } });
      return true;
    });
    if (made) {
      created.push(d.slug);
      await afterCommit?.();
    }
  }
  return { created };
}

/**
 * Record the sale of a property after a sale proposal has passed. Pays every holder their pro
 * rata share of: sale price − selling costs + the liquidity reserve + any rounding carry.
 * Closes the property and stores each holder's final return.
 */
export async function recordSale(input: { actorId: string; propertyId: string; salePriceCents: bigint; saleCostsCents: bigint; idempotencyKey: string; ipAddress?: string | null; now?: Date }) {
  const now = input.now ?? new Date();
  if (input.salePriceCents <= 0n) throw new DomainError("Enter the sale price.", "salePrice");
  if (input.saleCostsCents < 0n || input.saleCostsCents > input.salePriceCents) throw new DomainError("Selling costs must be between $0 and the sale price.", "saleCosts");
  let afterCommit: (() => Promise<void>) | undefined;
  const result = await runTx(async (tx) => {
    const replay = await claimIdempotencyKey(tx, input.idempotencyKey, input.actorId, "recordSale");
    if (replay) return { replayed: true };
    const property = await lockProperty(tx, input.propertyId);
    if (property.status === "SOLD") throw new DomainError("This property has already been sold.");
    const passed = await tx.proposal.findFirst({ where: { propertyId: property.id, type: "SELL_PROPERTY", status: "PASSED" }, orderBy: { finalizedAt: "desc" } });
    if (!passed) throw new DomainError("A sale can only be recorded after holders have passed a proposal to sell.");

    const notices: Notice[] = await expireOrdersForProperty(tx, property.id, now);
    await tx.$queryRaw`SELECT "id" FROM "LiquidityReserve" WHERE "propertyId" = ${property.id} FOR UPDATE`;
    const reserve = await tx.liquidityReserve.findUnique({ where: { propertyId: property.id } });
    const reserveCents = reserve?.balanceCents ?? 0n;
    const carryCents = property.dividendCarryCents;
    const netCents = netSaleProceeds({ salePriceCents: input.salePriceCents, saleCostsCents: input.saleCostsCents, otherCashCents: reserveCents + carryCents });

    const holdings = await tx.holding.findMany({ where: { propertyId: property.id, shareUnits: { gt: 0n } } });
    if (holdings.length === 0) throw new DomainError("This property has no holders to pay.");
    const dividends = await tx.dividendPayment.groupBy({ by: ["userId"], where: { distribution: { propertyId: property.id, status: "PAID" } }, _sum: { amountCents: true } });
    const divByUser = new Map(dividends.map((d) => [d.userId, d._sum.amountCents ?? 0n]));
    const plan = distributeExitProceeds(netCents, holdings.map((h) => ({ userId: h.userId, units: h.shareUnits, costBasisCents: h.costBasisCents, dividendsCents: divByUser.get(h.userId) ?? 0n })));

    await lockWallets(tx, plan.map((p) => p.userId));
    const lines: LedgerLine[] = [
      { account: "EXTERNAL", propertyId: property.id, type: "EXIT_PROCEEDS", amountCents: -(input.salePriceCents - input.saleCostsCents), memo: `Sale of ${property.name}: ${formatCents(input.salePriceCents)} less ${formatCents(input.saleCostsCents)} selling costs` },
      { account: "LIQUIDITY_RESERVE", propertyId: property.id, type: "EXIT_PROCEEDS", amountCents: -reserveCents, memo: "Liquidity reserve returned to holders at sale" },
      { account: "PROPERTY_OPERATING", propertyId: property.id, type: "EXIT_PROCEEDS", amountCents: -carryCents, memo: "Undistributed rounding carry returned to holders at sale" },
    ];
    for (const p of plan) {
      await tx.wallet.update({ where: { userId: p.userId }, data: { availableCents: { increment: p.amountCents } } });
      lines.push({ account: "USER_WALLET", userId: p.userId, propertyId: property.id, type: "EXIT_PROCEEDS", amountCents: p.amountCents, shareUnits: -p.units, memo: `Sale proceeds for ${formatUnits(p.units)} shares of ${property.name}` });
      notices.push({
        userId: p.userId,
        type: "SALE_COMPLETED",
        title: `${property.name} has been sold`,
        body: `Your ${formatUnits(p.units)} shares paid out ${formatCents(p.amountCents)}. Including ${formatCents(p.dividendsCents)} of dividends, your total return on ${formatCents(p.costBasisCents)} invested was ${formatCents(p.totalReturnCents, { sign: true })} (${formatBps(p.totalReturnBps, { sign: true })}).`,
        href: `/properties/${property.slug}`,
      });
    }
    await postLedger(tx, `sale_${property.id}`, lines, now);
    await tx.exitPayout.createMany({ data: plan.map((p) => ({ propertyId: property.id, userId: p.userId, shareUnits: p.units, amountCents: p.amountCents, costBasisCents: p.costBasisCents, dividendsCents: p.dividendsCents })) });
    await tx.holdingLot.updateMany({ where: { propertyId: property.id }, data: { remainingUnits: 0n, costBasisCents: 0n } });
    await tx.holding.updateMany({ where: { propertyId: property.id }, data: { shareUnits: 0n, costBasisCents: 0n, reservedUnits: 0n } });
    if (reserve) await tx.liquidityReserve.update({ where: { propertyId: property.id }, data: { balanceCents: 0n } });
    await tx.property.update({ where: { id: property.id }, data: { status: "SOLD", salePriceCents: input.salePriceCents, saleCostsCents: input.saleCostsCents, soldAt: now, dividendCarryCents: 0n } });
    await audit(tx, { actorId: input.actorId, action: "property.sold", entityType: "Property", entityId: property.id, before: { status: property.status }, after: { salePriceCents: input.salePriceCents, saleCostsCents: input.saleCostsCents, reserveCents, carryCents, netCents, holders: plan.length }, ipAddress: input.ipAddress });
    afterCommit = await notify(tx, notices);
    await storeIdempotentResult(tx, input.idempotencyKey, { ok: true });
    return { replayed: false };
  });
  if (!result.replayed) await afterCommit?.();
  return result;
}
