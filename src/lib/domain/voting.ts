import { BPS, mulDivFloor } from "./money";

export type Choice = "FOR" | "AGAINST" | "ABSTAIN";
export type Outcome = "PASSED" | "FAILED" | "NO_QUORUM";

/** Most units any one holder can have counted: capBps of the shares outstanding at the record date. */
export function votingCapUnits(outstandingUnits: bigint, capBps: number): bigint {
  return mulDivFloor(outstandingUnits, BigInt(capBps), BPS);
}

/** A holder's counted voting power: their shares at the record date, limited by the cap. */
export function countedUnits(rawUnits: bigint, outstandingUnits: bigint, capBps: number): bigint {
  const cap = votingCapUnits(outstandingUnits, capBps);
  return rawUnits < cap ? rawUnits : cap;
}

export type Tally = {
  forUnits: bigint;
  againstUnits: bigint;
  abstainUnits: bigint;
  /** Uncapped shares represented by everyone who voted; used for quorum. */
  rawParticipatingUnits: bigint;
};

export function tallyVotes(votes: readonly { choice: Choice; rawShareUnits: bigint; countedShareUnits: bigint }[]): Tally {
  const t: Tally = { forUnits: 0n, againstUnits: 0n, abstainUnits: 0n, rawParticipatingUnits: 0n };
  for (const v of votes) {
    t.rawParticipatingUnits += v.rawShareUnits;
    if (v.choice === "FOR") t.forUnits += v.countedShareUnits;
    else if (v.choice === "AGAINST") t.againstUnits += v.countedShareUnits;
    else t.abstainUnits += v.countedShareUnits;
  }
  return t;
}

/**
 * Quorum: the (uncapped) shares of everyone who voted, including abstentions, must be at least
 * quorumBps of the shares outstanding. The cap limits influence, not attendance.
 */
export function quorumMet(tally: Tally, outstandingUnits: bigint, quorumBps: number): boolean {
  if (outstandingUnits <= 0n) return false;
  return tally.rawParticipatingUnits * BPS >= outstandingUnits * BigInt(quorumBps);
}

/**
 * Decide a proposal.
 *  - No quorum → NO_QUORUM.
 *  - Otherwise it passes only if counted FOR votes are STRICTLY MORE than passThresholdBps of
 *    counted FOR + AGAINST votes. Abstentions count toward quorum but not toward the threshold.
 *    A tie at a 50% threshold fails.
 */
export function decide(tally: Tally, outstandingUnits: bigint, quorumBps: number, passThresholdBps: number): Outcome {
  if (!quorumMet(tally, outstandingUnits, quorumBps)) return "NO_QUORUM";
  const decisive = tally.forUnits + tally.againstUnits;
  if (decisive === 0n) return "FAILED";
  return tally.forUnits * BPS > decisive * BigInt(passThresholdBps) ? "PASSED" : "FAILED";
}
