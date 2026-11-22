import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Empty, Page, PageHeader, SectionHeading } from "@/components/ui/primitives";
import { prisma } from "@/lib/db";
import { formatBps } from "@/lib/domain/money";
import { daysUntil, fmtDate, PROPOSAL_STATUS, PROPOSAL_TYPE } from "@/lib/labels";
import { proposalTally } from "@/lib/proposal-view";
import { requireInvestor } from "@/lib/session";

export const metadata: Metadata = { title: "Votes" };

export default async function GovernancePage() {
  const user = await requireInvestor();
  // Proposals on homes the user holds now, or held on a proposal's record date (they may have sold since).
  const held = await prisma.ledgerEntry.findMany({ where: { userId: user.id, account: "USER_WALLET", shareUnits: { not: null } }, select: { propertyId: true }, distinct: ["propertyId"] });
  const ids = held.map((h) => h.propertyId).filter((x): x is string => !!x);
  const proposals = await prisma.proposal.findMany({ where: { propertyId: { in: ids }, status: { not: "DRAFT" } }, include: { property: { select: { name: true, slug: true } }, votes: true }, orderBy: [{ closesAt: "desc" }] });
  const open = proposals.filter((p) => p.status === "OPEN");
  const past = proposals.filter((p) => p.status !== "OPEN");

  const row = (p: (typeof proposals)[number]) => {
    const t = proposalTally(p, p.votes);
    const mine = p.votes.find((v) => v.userId === user.id);
    return (
      <li key={p.id} className="grid gap-3 border-b border-rule py-5 md:grid-cols-[1fr_14rem] md:items-start">
        <div>
          <p className="text-sm text-stone">{p.property.name} · {PROPOSAL_TYPE[p.type]}</p>
          <Link href={`/proposals/${p.id}`} className="mt-1 block font-serif text-md underline-offset-4 hover:underline">{p.title}</Link>
          <p className="mt-1 max-w-prose text-sm text-ink-soft">{p.summary}</p>
        </div>
        <div className="text-sm md:text-right">
          <Badge tone={PROPOSAL_STATUS[p.status].tone}>{PROPOSAL_STATUS[p.status].label}</Badge>
          <p className="num mt-2 text-ink-soft">{p.status === "OPEN" ? `Closes ${daysUntil(p.closesAt)}` : `Closed ${fmtDate(p.finalizedAt ?? p.closesAt)}`}</p>
          <p className="num text-ink-soft">Turnout {formatBps(t.turnoutBps, { decimals: 0 })} · {formatBps(t.forBps, { decimals: 0 })} for</p>
          <p className={mine ? "text-ink" : p.status === "OPEN" ? "font-medium text-ink" : "text-stone"}>{mine ? `You voted ${mine.choice.toLowerCase()}` : p.status === "OPEN" ? "You have not voted" : "You did not vote"}</p>
        </div>
      </li>
    );
  };

  return (
    <Page className="pb-8">
      <PageHeader title="Votes" lede="Holders decide major questions about the homes they own: selling, refinancing, a large renovation, changing the manager, or moving the exit date. Day-to-day running is left to the manager." />
      <section className="pt-10" aria-labelledby="open">
        <SectionHeading id="open">Open now</SectionHeading>
        {open.length ? <ul>{open.map(row)}</ul> : <p className="py-4 text-sm text-stone">Nothing is open for a vote on homes you own.</p>}
      </section>
      <section className="pt-14" aria-labelledby="past">
        <SectionHeading id="past">Past votes</SectionHeading>
        {past.length ? <ul>{past.map(row)}</ul> : <Empty title="No past votes yet.">When a vote closes, its result stays here with the final tally.</Empty>}
      </section>
    </Page>
  );
}
