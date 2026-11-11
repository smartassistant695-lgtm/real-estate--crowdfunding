import { describe, expect, it } from "vitest";
import { countedUnits, decide, quorumMet, tallyVotes, votingCapUnits, type Choice, type Tally } from "@/lib/domain/voting";
import { prng } from "./_prng";

const SHARE = 1_000_000n;
const OUTSTANDING = 1_000n * SHARE;
const CAP = 2000; // 20%

/** Build a vote the way the app does: counted = min(raw, cap). */
const vote = (choice: Choice, shares: bigint, outstanding = OUTSTANDING, capBps = CAP) => ({
  choice,
  rawShareUnits: shares * SHARE,
  countedShareUnits: countedUnits(shares * SHARE, outstanding, capBps),
});
const tally = (forUnits: bigint, againstUnits: bigint, abstainUnits = 0n, raw?: bigint): Tally => ({
  forUnits,
  againstUnits,
  abstainUnits,
  rawParticipatingUnits: raw ?? forUnits + againstUnits + abstainUnits,
});

describe("votingCapUnits", () => {
  it("is 20% of the shares outstanding", () => {
    expect(votingCapUnits(OUTSTANDING, 2000)).toBe(200n * SHARE);
    expect(votingCapUnits(5n * SHARE, 2000)).toBe(SHARE);
  });

  it("rounds down", () => {
    expect(votingCapUnits(7n, 2000)).toBe(1n); // 1.4
    expect(votingCapUnits(4n, 2000)).toBe(0n); // 0.8
    expect(votingCapUnits(1_234_567n, 2000)).toBe(246_913n); // 246,913.4
  });

  it("handles 0% and 100% caps and nothing outstanding", () => {
    expect(votingCapUnits(OUTSTANDING, 0)).toBe(0n);
    expect(votingCapUnits(OUTSTANDING, 10_000)).toBe(OUTSTANDING);
    expect(votingCapUnits(0n, 2000)).toBe(0n);
  });
});

describe("countedUnits (raw vs counted)", () => {
  it("counts a small holder in full", () => {
    expect(countedUnits(50n * SHARE, OUTSTANDING, CAP)).toBe(50n * SHARE);
    expect(countedUnits(1n, OUTSTANDING, CAP)).toBe(1n);
    expect(countedUnits(0n, OUTSTANDING, CAP)).toBe(0n);
  });

  it("limits a large holder to the cap", () => {
    expect(countedUnits(600n * SHARE, OUTSTANDING, CAP)).toBe(200n * SHARE);
    expect(countedUnits(OUTSTANDING, OUTSTANDING, CAP)).toBe(200n * SHARE);
  });

  it("is exact at the cap boundary", () => {
    const cap = 200n * SHARE;
    expect(countedUnits(cap - 1n, OUTSTANDING, CAP)).toBe(cap - 1n);
    expect(countedUnits(cap, OUTSTANDING, CAP)).toBe(cap);
    expect(countedUnits(cap + 1n, OUTSTANDING, CAP)).toBe(cap);
  });

  it("never exceeds raw or the cap (randomized)", () => {
    const r = prng(20);
    for (let i = 0; i < 1000; i++) {
      const out = r.big(1, 2_000_000_000);
      const raw = r.big(0, Number(out));
      const capBps = r.int(0, 10_000);
      const c = countedUnits(raw, out, capBps);
      expect(c <= raw).toBe(true);
      expect(c * 10_000n <= out * BigInt(capBps)).toBe(true);
      expect(c === raw || c === votingCapUnits(out, capBps)).toBe(true);
    }
  });
});

describe("tallyVotes", () => {
  it("sums counted units per choice and raw units for participation", () => {
    const t = tallyVotes([
      vote("FOR", 600n), // capped to 200
      vote("FOR", 50n),
      vote("AGAINST", 150n),
      vote("AGAINST", 250n), // capped to 200
      vote("ABSTAIN", 300n), // capped to 200
      vote("ABSTAIN", 10n),
    ]);
    expect(t).toEqual({
      forUnits: 250n * SHARE,
      againstUnits: 350n * SHARE,
      abstainUnits: 210n * SHARE,
      rawParticipatingUnits: 1_360n * SHARE,
    });
  });

  it("is all zeros with no votes", () => {
    expect(tallyVotes([])).toEqual({ forUnits: 0n, againstUnits: 0n, abstainUnits: 0n, rawParticipatingUnits: 0n });
  });

  it("uses the stored counted units as given (snapshot at vote time)", () => {
    const t = tallyVotes([{ choice: "FOR", rawShareUnits: 900n, countedShareUnits: 200n }]);
    expect(t.forUnits).toBe(200n);
    expect(t.rawParticipatingUnits).toBe(900n);
  });
});

describe("quorumMet", () => {
  it("is met exactly at the threshold and missed one unit below", () => {
    // 30% of 1,000 shares = 300 shares
    expect(quorumMet(tally(0n, 0n, 0n, 300n * SHARE), OUTSTANDING, 3000)).toBe(true);
    expect(quorumMet(tally(0n, 0n, 0n, 300n * SHARE - 1n), OUTSTANDING, 3000)).toBe(false);
    expect(quorumMet(tally(0n, 0n, 0n, 300n * SHARE + 1n), OUTSTANDING, 3000)).toBe(true);
  });

  it("does not round a fractional threshold down", () => {
    // 30% of 7 units = 2.1 -> 2 units is not enough, 3 is
    expect(quorumMet(tally(0n, 0n, 0n, 2n), 7n, 3000)).toBe(false);
    expect(quorumMet(tally(0n, 0n, 0n, 3n), 7n, 3000)).toBe(true);
  });

  it("uses raw (uncapped) units: a capped whale still brings full attendance", () => {
    const t = tallyVotes([vote("FOR", 600n)]);
    expect(t.forUnits).toBe(200n * SHARE);
    expect(quorumMet(t, OUTSTANDING, 5000)).toBe(true); // 60% raw >= 50%
    // If quorum used counted units it would be 20% and fail.
    expect(t.forUnits * 10_000n >= OUTSTANDING * 5000n).toBe(false);
  });

  it("counts abstentions toward quorum", () => {
    const t = tallyVotes([vote("ABSTAIN", 300n), vote("FOR", 10n)]);
    expect(quorumMet(t, OUTSTANDING, 3000)).toBe(true);
    expect(quorumMet(tallyVotes([vote("FOR", 10n)]), OUTSTANDING, 3000)).toBe(false);
  });

  it("abstentions alone can make quorum", () => {
    expect(quorumMet(tallyVotes([vote("ABSTAIN", 150n), vote("ABSTAIN", 150n)]), OUTSTANDING, 3000)).toBe(true);
  });

  it("is never met when nothing is outstanding", () => {
    expect(quorumMet(tally(1n, 0n), 0n, 0)).toBe(false);
    expect(quorumMet(tally(1n, 0n), -1n, 3000)).toBe(false);
  });

  it("a 0% quorum is met even with no votes; a 100% quorum needs everyone", () => {
    expect(quorumMet(tally(0n, 0n), OUTSTANDING, 0)).toBe(true);
    expect(quorumMet(tally(0n, 0n, 0n, OUTSTANDING - 1n), OUTSTANDING, 10_000)).toBe(false);
    expect(quorumMet(tally(0n, 0n, 0n, OUTSTANDING), OUTSTANDING, 10_000)).toBe(true);
  });
});

describe("decide", () => {
  const QUORUM = 3000;
  const MAJORITY = 5000;
  // Enough raw attendance for quorum in every case below unless stated.
  const withQuorum = (f: bigint, a: bigint, ab = 0n) => tally(f, a, ab, 400n * SHARE);

  it("returns NO_QUORUM when attendance is short, however lopsided the vote", () => {
    const t = tallyVotes([vote("FOR", 100n), vote("FOR", 100n), vote("FOR", 99n)]);
    expect(decide(t, OUTSTANDING, QUORUM, MAJORITY)).toBe("NO_QUORUM");
  });

  it("returns NO_QUORUM with no votes at all", () => {
    expect(decide(tallyVotes([]), OUTSTANDING, QUORUM, MAJORITY)).toBe("NO_QUORUM");
  });

  it("passes with a clear majority", () => {
    expect(decide(withQuorum(300n, 100n), OUTSTANDING, QUORUM, MAJORITY)).toBe("PASSED");
  });

  it("fails with a clear minority", () => {
    expect(decide(withQuorum(100n, 300n), OUTSTANDING, QUORUM, MAJORITY)).toBe("FAILED");
  });

  it("a 50/50 tie fails", () => {
    expect(decide(withQuorum(200n * SHARE, 200n * SHARE), OUTSTANDING, QUORUM, MAJORITY)).toBe("FAILED");
  });

  it("one unit more than half passes; one unit less fails", () => {
    expect(decide(withQuorum(200n * SHARE + 1n, 200n * SHARE), OUTSTANDING, QUORUM, MAJORITY)).toBe("PASSED");
    expect(decide(withQuorum(200n * SHARE, 200n * SHARE + 1n), OUTSTANDING, QUORUM, MAJORITY)).toBe("FAILED");
    expect(decide(withQuorum(2n, 1n), OUTSTANDING, QUORUM, MAJORITY)).toBe("PASSED");
  });

  it("needs STRICTLY more than a supermajority threshold", () => {
    // threshold 60%: exactly 60/40 fails, 61/39 passes
    expect(decide(withQuorum(60n, 40n), OUTSTANDING, QUORUM, 6000)).toBe("FAILED");
    expect(decide(withQuorum(61n, 39n), OUTSTANDING, QUORUM, 6000)).toBe("PASSED");
    expect(decide(withQuorum(6001n, 3999n), OUTSTANDING, QUORUM, 6000)).toBe("PASSED");
    // two-thirds expressed as 6667 bps: exactly 2:1 (66.67%) falls just short
    expect(decide(withQuorum(2n, 1n), OUTSTANDING, QUORUM, 6667)).toBe("FAILED");
    expect(decide(withQuorum(2n, 1n), OUTSTANDING, QUORUM, 6666)).toBe("PASSED");
  });

  it("excludes abstentions from the threshold", () => {
    // 30 FOR, 20 AGAINST, 350 ABSTAIN: 60% of decisive votes, though only 7.5% of all votes cast
    expect(decide(withQuorum(30n, 20n, 350n), OUTSTANDING, QUORUM, MAJORITY)).toBe("PASSED");
    // Abstentions cannot break a tie either way.
    expect(decide(withQuorum(20n, 20n, 360n), OUTSTANDING, QUORUM, MAJORITY)).toBe("FAILED");
  });

  it("fails when nobody is decisive (everyone abstained), even with quorum", () => {
    const t = tallyVotes([vote("ABSTAIN", 200n), vote("ABSTAIN", 200n)]);
    expect(quorumMet(t, OUTSTANDING, QUORUM)).toBe(true);
    expect(decide(t, OUTSTANDING, QUORUM, MAJORITY)).toBe("FAILED");
    // ...including with a 0% pass threshold, which would otherwise be "0 > 0".
    expect(decide(t, OUTSTANDING, QUORUM, 0)).toBe("FAILED");
  });

  it("abstentions give quorum to an otherwise under-attended vote", () => {
    const votes = [vote("FOR", 60n), vote("AGAINST", 40n)];
    expect(decide(tallyVotes(votes), OUTSTANDING, QUORUM, MAJORITY)).toBe("NO_QUORUM");
    expect(decide(tallyVotes([...votes, vote("ABSTAIN", 200n)]), OUTSTANDING, QUORUM, MAJORITY)).toBe("PASSED");
  });

  it("unanimous FOR passes a simple majority", () => {
    expect(decide(withQuorum(400n, 0n), OUTSTANDING, QUORUM, MAJORITY)).toBe("PASSED");
  });

  it("unanimous AGAINST fails", () => {
    expect(decide(withQuorum(0n, 400n), OUTSTANDING, QUORUM, MAJORITY)).toBe("FAILED");
  });

  it("the cap changes outcomes: a 60% whale cannot outvote two 15% holders", () => {
    const votes = [vote("FOR", 600n), vote("AGAINST", 150n), vote("AGAINST", 150n)];
    const t = tallyVotes(votes);
    expect(t.forUnits).toBe(200n * SHARE); // capped
    expect(t.againstUnits).toBe(300n * SHARE);
    expect(t.rawParticipatingUnits).toBe(900n * SHARE);
    expect(decide(t, OUTSTANDING, QUORUM, MAJORITY)).toBe("FAILED");
    // Uncapped it would have passed 600 to 300.
    const uncapped = tallyVotes(votes.map((v) => ({ ...v, countedShareUnits: v.rawShareUnits })));
    expect(decide(uncapped, OUTSTANDING, QUORUM, MAJORITY)).toBe("PASSED");
  });

  it("two capped whales on opposite sides tie, and the tie fails", () => {
    const t = tallyVotes([vote("FOR", 450n), vote("AGAINST", 250n)]);
    expect(t.forUnits).toBe(t.againstUnits);
    expect(decide(t, OUTSTANDING, QUORUM, MAJORITY)).toBe("FAILED");
  });

  it("checks quorum before anything else", () => {
    expect(decide(tally(1n, 0n, 0n, 1n), OUTSTANDING, QUORUM, MAJORITY)).toBe("NO_QUORUM");
    expect(decide(tally(1n, 0n, 0n, 1n), 0n, 0, MAJORITY)).toBe("NO_QUORUM");
  });

  // QUESTIONABLE (voting.ts decide, `forUnits * BPS > decisive * passThresholdBps`): because the
  // comparison is strict, a 100% threshold ("unanimity required") can never pass, not even 100-0.
  // Suggested fix: validate passThresholdBps < 10_000, or treat 10_000 as "no AGAINST votes".
  it.fails("a unanimous vote passes a 100% threshold", () => {
    expect(decide(withQuorum(400n, 0n), OUTSTANDING, QUORUM, 10_000)).toBe("PASSED");
  });

  it("matches an independent rational-arithmetic model (randomized)", () => {
    const r = prng(1776);
    for (let i = 0; i < 3000; i++) {
      const out = r.big(1, 5000);
      const f = r.big(0, 2000);
      const a = r.big(0, 2000);
      const ab = r.big(0, 2000);
      const raw = f + a + ab + r.big(0, 2000); // raw >= counted
      const q = r.int(0, 10_000);
      const th = r.int(0, 10_000);
      const expected =
        Number(raw) / Number(out) < q / 10_000 - 1e-12
          ? "NO_QUORUM"
          : f + a === 0n
            ? "FAILED"
            : Number(f) * 10_000 > Number(f + a) * th
              ? "PASSED"
              : "FAILED";
      expect(decide(tally(f, a, ab, raw), out, q, th)).toBe(expected);
    }
  });
});
