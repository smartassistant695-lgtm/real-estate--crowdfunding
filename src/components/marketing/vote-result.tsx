import Link from "next/link";
import type { ProposalStatus } from "@prisma/client";
import { Badge, Meter } from "@/components/ui/primitives";
import { formatBps, formatUnits, ratioBps, UNITS_PER_SHARE } from "@/lib/domain/money";
import { fmtDate, PROPOSAL_STATUS } from "@/lib/labels";

export type VoteResultData = {
  id: string;
  title: string;
  status: ProposalStatus;
  property: { name: string; city: string; slug: string };
  closesAt: Date;
  outstandingUnits: bigint;
  forUnits: bigint;
  againstUnits: bigint;
  abstainUnits: bigint;
  participatingUnits: bigint;
  voters: number;
  quorumBps: number;
  passThresholdBps: number;
};

const shares = (u: bigint) => Number(u / UNITS_PER_SHARE);

/** A closed vote with its real tally: turnout against quorum, then For / Against / Abstain. */
export function VoteResult({ v }: { v: VoteResultData }) {
  const status = PROPOSAL_STATUS[v.status];
  const turnoutBps = ratioBps(v.participatingUnits, v.outstandingUnits);
  const decisive = v.forUnits + v.againstUnits;
  const cast = decisive + v.abstainUnits;
  const forBps = ratioBps(v.forUnits, decisive);
  const outcome =
    v.status === "NO_QUORUM"
      ? `Only ${formatBps(turnoutBps, { decimals: 1 })} of shares voted, short of the ${formatBps(v.quorumBps, { decimals: 0 })} quorum, so nothing changed.`
      : v.status === "PASSED"
        ? `${formatBps(forBps, { decimals: 1 })} of the counted For and Against votes were For, above the ${formatBps(v.passThresholdBps, { decimals: 0 })} needed.`
        : `${formatBps(forBps, { decimals: 1 })} of the counted For and Against votes were For, not more than the ${formatBps(v.passThresholdBps, { decimals: 0 })} needed.`;

  return (
    <article className="border-t border-ink pt-4">
      <div className="flex items-start justify-between gap-4">
        <h3 className="text-md">{v.title}</h3>
        <Badge tone={status.tone} className="mt-1">{status.label}</Badge>
      </div>
      <p className="mt-1 text-sm text-stone">
        <Link className="link" href={`/properties/${v.property.slug}`}>{v.property.name}</Link>, {v.property.city} · closed {fmtDate(v.closesAt)} · <span className="num">{v.voters}</span> holders voted
      </p>

      <div className="mt-5 grid gap-5">
        <div>
          <p className="flex justify-between gap-4 text-sm">
            <span>Turnout</span>
            <span className="num">{formatUnits(v.participatingUnits, 0)} of {formatUnits(v.outstandingUnits, 0)} shares · {formatBps(turnoutBps, { decimals: 1 })}</span>
          </p>
          <Meter
            className="mt-2"
            label={`Turnout ${formatBps(turnoutBps, { decimals: 1 })}, quorum ${formatBps(v.quorumBps, { decimals: 0 })}`}
            max={shares(v.outstandingUnits)}
            segments={[{ value: shares(v.participatingUnits), tone: "accent", label: "Voted" }]}
            thresholds={[{ at: (shares(v.outstandingUnits) * v.quorumBps) / 10_000, label: `Quorum ${formatBps(v.quorumBps, { decimals: 0 })}` }]}
          />
        </div>
        {cast > 0n ? (
          <div>
            <p className="flex justify-between gap-4 text-sm">
              <span>Counted votes</span>
              <span className="num">For {formatUnits(v.forUnits, 0)} · Against {formatUnits(v.againstUnits, 0)}{v.abstainUnits > 0n ? ` · Abstain ${formatUnits(v.abstainUnits, 0)}` : ""}</span>
            </p>
            <Meter
              className="mt-2"
              label={`For ${formatUnits(v.forUnits, 0)}, against ${formatUnits(v.againstUnits, 0)}, abstain ${formatUnits(v.abstainUnits, 0)} shares`}
              max={shares(cast)}
              segments={[
                { value: shares(v.forUnits), tone: "accent", label: "For" },
                { value: shares(v.againstUnits), tone: "ink", label: "Against" },
                { value: shares(v.abstainUnits), tone: "stone", label: "Abstain" },
              ]}
            />
          </div>
        ) : null}
      </div>
      <p className="mt-4 text-sm text-ink-soft">{outcome}</p>
    </article>
  );
}
