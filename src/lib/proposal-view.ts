import "server-only";
import type { Proposal, Vote } from "@prisma/client";
import { ratioBps } from "@/lib/domain/money";
import { decide, quorumMet, tallyVotes, votingCapUnits } from "@/lib/domain/voting";

/** Tally figures for display: live while open, the stored final figures once decided. */
export function proposalTally(p: Proposal, votes: Pick<Vote, "choice" | "rawShareUnits" | "countedShareUnits">[]) {
  const live = tallyVotes(votes);
  const t = p.status === "OPEN" || p.status === "DRAFT" ? live : { ...live, forUnits: p.forUnits, againstUnits: p.againstUnits, abstainUnits: p.abstainUnits };
  const counted = t.forUnits + t.againstUnits + t.abstainUnits;
  const decisive = t.forUnits + t.againstUnits;
  return {
    ...t,
    counted,
    voters: votes.length,
    turnoutBps: ratioBps(t.rawParticipatingUnits, p.outstandingUnits),
    forBps: ratioBps(t.forUnits, decisive),
    againstBps: ratioBps(t.againstUnits, decisive),
    quorumMet: quorumMet(t, p.outstandingUnits, p.quorumBps),
    projected: decide(t, p.outstandingUnits, p.quorumBps, p.passThresholdBps),
    capUnits: votingCapUnits(p.outstandingUnits, p.votingCapBps),
  };
}
