import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { InvestingDisclosure } from "@/components/site/footer";
import { Markdown } from "@/components/ui/markdown";
import { Badge, Facts, Meter, Note, Page, SectionHeading, Table, Td, Th } from "@/components/ui/primitives";
import { prisma } from "@/lib/db";
import { formatBps, formatUnits } from "@/lib/domain/money";
import { daysUntil, fmtDate, fmtDateTime, PROPOSAL_STATUS, PROPOSAL_TYPE } from "@/lib/labels";
import { proposalTally } from "@/lib/proposal-view";
import { votingPower } from "@/lib/services/governance";
import { requireUser } from "@/lib/session";
import { castVoteAction } from "./actions";
import { VoteForm } from "./vote-form";

export const metadata: Metadata = { title: "Proposal" };
type Impact = { label: string; current: string; proposed: string };

export default async function ProposalPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const p = await prisma.proposal.findUnique({ where: { id }, include: { property: true, votes: true } });
  if (!p || (p.status === "DRAFT" && user.role !== "ADMIN")) notFound();
  const now = new Date();
  const t = proposalTally(p, p.votes);
  const mine = p.votes.find((v) => v.userId === user.id) ?? null;
  const power = user.role === "INVESTOR" ? await votingPower(prisma, p, user.id) : null;
  const open = p.status === "OPEN" && now.getTime() >= p.opensAt.getTime() && now.getTime() < p.closesAt.getTime();
  const status = PROPOSAL_STATUS[p.status];
  const impact = (Array.isArray(p.financialImpact) ? p.financialImpact : []) as Impact[];
  const capped = power && power.countedUnits < power.rawUnits;
  const thresholdPct = p.passThresholdBps / 100;
  const outcomeText =
    p.status === "PASSED" ? "Passed." : p.status === "FAILED" ? "Did not pass." : p.status === "NO_QUORUM" ? "Not enough shares voted, so no decision was made." : t.quorumMet ? (t.projected === "PASSED" ? "If voting ended now, it would pass." : "If voting ended now, it would not pass.") : "Quorum has not been reached yet.";

  return (
    <Page className="pb-8">
      <header className="grid gap-6 border-b border-ink pb-8 pt-10 md:grid-cols-[1fr_auto] md:items-end md:pt-14">
        <div className="max-w-prose">
          <nav aria-label="Breadcrumb" className="mb-4 text-sm text-stone">
            <Link href={`/properties/${p.property.slug}?tab=governance`} className="hover:text-ink">{p.property.name}</Link> <span aria-hidden>/</span> {PROPOSAL_TYPE[p.type]}
          </nav>
          <h1 className="text-2xl md:text-3xl">{p.title}</h1>
          <p className="mt-4 text-md text-ink-soft">{p.summary}</p>
        </div>
        <div className="md:text-right">
          <Badge tone={status.tone}>{status.label}</Badge>
          <p className="num mt-2 text-sm text-ink-soft">
            {p.status === "OPEN" ? (now < p.opensAt ? `Opens ${fmtDateTime(p.opensAt)}` : <>Closes {fmtDateTime(p.closesAt)}<br />{daysUntil(p.closesAt)}</>) : `Closed ${fmtDate(p.finalizedAt ?? p.closesAt)}`}
          </p>
        </div>
      </header>

      <div className="grid gap-12 pt-10 lg:grid-cols-[1fr_22rem]">
        <div className="min-w-0 space-y-14">
          <section aria-labelledby="tally">
            <SectionHeading id="tally" aside={`${t.voters} ${t.voters === 1 ? "holder has" : "holders have"} voted`}>{p.status === "OPEN" ? "Live tally" : "Result"}</SectionHeading>
            <p className="mb-6 font-serif text-md">{outcomeText}</p>
            <div className="space-y-8">
              <div>
                <p className="mb-2 flex justify-between text-sm"><span>Turnout</span><span className="num">{formatBps(t.turnoutBps, { decimals: 1 })} of shares</span></p>
                <Meter max={10_000} segments={[{ value: t.turnoutBps, tone: "accent", label: "Turnout" }]} thresholds={[{ at: p.quorumBps, label: `Quorum ${formatBps(p.quorumBps, { decimals: 0 })}` }]} label={`Turnout ${formatBps(t.turnoutBps, { decimals: 1 })} of shares; quorum is ${formatBps(p.quorumBps, { decimals: 0 })}`} />
              </div>
              <div>
                <p className="mb-2 flex justify-between text-sm"><span>For vs. against (counted shares)</span><span className="num">{formatBps(t.forBps, { decimals: 1 })} for</span></p>
                <Meter max={10_000} segments={[{ value: t.forBps, tone: "accent", label: "For" }, { value: t.againstBps, tone: "ink", label: "Against" }]} thresholds={[{ at: p.passThresholdBps, label: `Passes above ${thresholdPct}%` }]} label={`${formatBps(t.forBps, { decimals: 1 })} for, ${formatBps(t.againstBps, { decimals: 1 })} against; passes above ${thresholdPct}%`} />
              </div>
            </div>
            <Table caption="Vote tally" className="mt-8">
              <thead><tr><Th>Choice</Th><Th num>Counted shares</Th><Th num>Share of decisive votes</Th></tr></thead>
              <tbody>
                <tr><Td>For</Td><Td num>{formatUnits(t.forUnits, 2)}</Td><Td num>{formatBps(t.forBps, { decimals: 1 })}</Td></tr>
                <tr><Td>Against</Td><Td num>{formatUnits(t.againstUnits, 2)}</Td><Td num>{formatBps(t.againstBps, { decimals: 1 })}</Td></tr>
                <tr><Td>Abstain</Td><Td num>{formatUnits(t.abstainUnits, 2)}</Td><Td num className="text-stone">not counted</Td></tr>
              </tbody>
            </Table>
            <p className="mt-3 text-xs text-stone">
              Quorum: shares held by everyone who voted (including abstentions) must reach {formatBps(p.quorumBps, { decimals: 0 })} of the {formatUnits(p.outstandingUnits, 0)} shares outstanding on the record date. To pass, “for” must be more than {thresholdPct}% of for + against. No holder’s vote counts for more than {formatBps(p.votingCapBps, { decimals: 0 })} of shares ({formatUnits(t.capUnits, 0)}).
            </p>
          </section>

          <section aria-labelledby="details">
            <SectionHeading id="details">The proposal in full</SectionHeading>
            <Markdown source={p.details} className="max-w-prose text-ink-soft" />
          </section>

          {p.pros || p.cons ? (
            <section aria-labelledby="case" className="grid gap-8 md:grid-cols-2">
              <h2 id="case" className="sr-only">For and against, from the manager</h2>
              <div>
                <h3 className="mb-3 border-b border-ink pb-2 font-serif text-md">Arguments for</h3>
                <Markdown source={p.pros} className="text-sm text-ink-soft" />
              </div>
              <div>
                <h3 className="mb-3 border-b border-ink pb-2 font-serif text-md">Arguments against</h3>
                <Markdown source={p.cons} className="text-sm text-ink-soft" />
              </div>
            </section>
          ) : null}

          {impact.length ? (
            <section aria-labelledby="impact">
              <SectionHeading id="impact">Financial impact</SectionHeading>
              <Table caption="Financial impact">
                <thead><tr><Th>&nbsp;</Th><Th>Today</Th><Th>If it passes</Th></tr></thead>
                <tbody>{impact.map((r) => <tr key={r.label}><Td className="font-medium">{r.label}</Td><Td className="num">{r.current}</Td><Td className="num">{r.proposed}</Td></tr>)}</tbody>
              </Table>
            </section>
          ) : null}
        </div>

        <aside className="lg:sticky lg:top-6 lg:self-start">
          <div className="border-t-2 border-ink pt-4">
            {power ? (
              <>
                <h2 className="text-lg">Your vote</h2>
                <Facts className="mt-3" rows={[
                  { label: `Shares on record date (${fmtDate(p.recordDate)})`, value: formatUnits(power.rawUnits) },
                  { label: "Counted voting power", value: formatUnits(power.countedUnits) },
                ]} />
                {capped ? <Note className="mt-3">You hold more than {formatBps(p.votingCapBps, { decimals: 0 })} of the shares, so your counted power is capped. Every share still counts toward quorum.</Note> : null}
                {power.rawUnits === 0n ? (
                  <p className="mt-4 text-sm text-ink-soft">Only investors who held shares on the record date can vote. Buying shares afterwards does not add votes.</p>
                ) : open ? (
                  <div className="mt-5"><VoteForm action={castVoteAction} proposalId={p.id} current={mine?.choice ?? null} /></div>
                ) : (
                  <p className="mt-4 text-sm text-ink-soft">{mine ? `You voted ${mine.choice.toLowerCase()} on ${fmtDate(mine.castAt)}.` : p.status === "OPEN" ? "Voting has not opened yet." : "You did not vote."}</p>
                )}
              </>
            ) : (
              <p className="text-sm text-ink-soft">Admins do not vote. <Link href={`/admin/proposals/${p.id}`} className="link">Manage this proposal</Link></p>
            )}
          </div>
        </aside>
      </div>
      <InvestingDisclosure />
    </Page>
  );
}
