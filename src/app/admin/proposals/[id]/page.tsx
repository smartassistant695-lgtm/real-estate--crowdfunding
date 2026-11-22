import Link from "next/link";
import { notFound } from "next/navigation";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { ActionForm, Checkbox, Input, Submit } from "@/components/ui/form";
import { Badge, Facts, Note, PageHeader, SectionHeading, Table, Td, Th } from "@/components/ui/primitives";
import { prisma } from "@/lib/db";
import { formatBps, formatCents, formatUnits } from "@/lib/domain/money";
import { fmtDateTime, PROPOSAL_STATUS, PROPOSAL_TYPE } from "@/lib/labels";
import { proposalTally } from "@/lib/proposal-view";
import { requireAdmin } from "@/lib/session";
import { finalizeProposalAction, publishProposalAction, recordSaleAction } from "../../actions";

export const metadata = { title: "Proposal" };

export default async function AdminProposal({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const p = await prisma.proposal.findUnique({ where: { id }, include: { property: true, votes: { include: { user: { select: { name: true } } }, orderBy: { castAt: "desc" } } } });
  if (!p) notFound();
  const t = proposalTally(p, p.votes);
  const reserve = await prisma.liquidityReserve.findUnique({ where: { propertyId: p.propertyId } });
  const canSell = p.type === "SELL_PROPERTY" && p.status === "PASSED" && p.property.status === "EXIT_VOTE";
  const payouts = p.property.status === "SOLD" ? await prisma.exitPayout.findMany({ where: { propertyId: p.propertyId }, include: { user: { select: { name: true } } }, orderBy: { amountCents: "desc" } }) : [];

  return (
    <>
      <PageHeader back={{ href: "/admin/proposals", label: "Proposals" }} title={p.title} lede={`${p.property.name} · ${PROPOSAL_TYPE[p.type]}${p.isPlannedExit ? " (planned exit)" : ""}`} actions={<><Badge tone={PROPOSAL_STATUS[p.status].tone}>{PROPOSAL_STATUS[p.status].label}</Badge>{p.status !== "DRAFT" ? <Link href={`/proposals/${p.id}`} className="link text-sm">Investor view</Link> : null}</>} />
      <div className="grid grid-cols-[minmax(0,1fr)] gap-12 pt-10 xl:grid-cols-[22rem_1fr]">
        <section aria-labelledby="rules">
          <SectionHeading id="rules">Rules and dates</SectionHeading>
          <Facts rows={[
            { label: "Record date", value: fmtDateTime(p.recordDate) },
            { label: "Opens", value: fmtDateTime(p.opensAt) },
            { label: "Closes", value: fmtDateTime(p.closesAt) },
            { label: "Shares outstanding (record date)", value: p.status === "DRAFT" ? "set when published" : formatUnits(p.outstandingUnits, 0) },
            { label: "Quorum", value: formatBps(p.quorumBps, { decimals: 0 }) },
            { label: "Passes above", value: formatBps(p.passThresholdBps, { decimals: 0 }) },
            { label: "Voting cap per holder", value: formatBps(p.votingCapBps, { decimals: 0 }) },
            ...(p.status !== "DRAFT" ? [{ label: "Turnout", value: formatBps(t.turnoutBps, { decimals: 1 }) }, { label: "For (of decisive votes)", value: formatBps(t.forBps, { decimals: 1 }) }] : []),
          ]} />
          <div className="mt-6 flex flex-wrap gap-3">
            {p.status === "DRAFT" ? <ConfirmAction action={publishProposalAction} fields={{ id: p.id }} trigger="Publish" title="Publish this proposal?" body="Holders on the record date are notified and can vote once it opens. The text can no longer be changed." confirm="Publish" /> : null}
            {p.status === "OPEN" ? (
              <ConfirmAction action={finalizeProposalAction} fields={{ id: p.id, early: p.closesAt.getTime() > Date.now() ? "1" : "0" }} trigger={p.closesAt.getTime() > Date.now() ? "Close voting early" : "Record the result"} triggerVariant={p.closesAt.getTime() > Date.now() ? "danger" : "primary"} danger={p.closesAt.getTime() > Date.now()} title={p.closesAt.getTime() > Date.now() ? "Close voting before the deadline?" : "Record the result?"} body={`On today’s tally: ${t.quorumMet ? (t.projected === "PASSED" ? "it passes" : "it does not pass") : "quorum has not been reached"}. Holders are notified of the result.`} confirm="Close voting" />
            ) : null}
          </div>
        </section>

        <div className="space-y-14">
          {canSell ? (
            <section aria-labelledby="sale">
              <SectionHeading id="sale">Record the sale</SectionHeading>
              <Note className="mb-5">Holders voted to sell. When the sale closes, enter the figures from the closing statement. Every holder is paid pro rata: sale price − selling costs + the liquidity reserve ({formatCents(reserve?.balanceCents ?? 0n)}) + undistributed rounding ({formatCents(p.property.dividendCarryCents)}) + the final part-month’s net income. Pending dividends must be paid first.</Note>
              <ActionForm action={recordSaleAction} idempotent className="max-w-form space-y-4">
                <input type="hidden" name="propertyId" value={p.propertyId} />
                <Input label="Sale price" name="salePrice" prefix="$" inputMode="decimal" required />
                <Input label="Selling costs" name="saleCosts" prefix="$" inputMode="decimal" required hint="Agent commission, closing costs, payoffs." />
                <Input label="Net income since the last dividend" name="finalOperating" prefix="$" inputMode="decimal" hint="From the closing statement. Leave blank if none." />
                <Checkbox name="confirm" required label="I have checked these figures against the closing statement. Paying out cannot be undone." />
                <Submit variant="danger" className="w-full sm:w-auto" pendingLabel="Paying out…">Record sale and pay holders</Submit>
              </ActionForm>
            </section>
          ) : null}
          {payouts.length ? (
            <section aria-labelledby="payouts">
              <SectionHeading id="payouts">Sale payouts</SectionHeading>
              <Table caption="Sale payouts">
                <thead><tr><Th>Holder</Th><Th num>Shares</Th><Th num>Paid</Th><Th num>Total return</Th></tr></thead>
                <tbody>{payouts.map((x) => <tr key={x.id}><Td className="py-1">{x.user.name}</Td><Td num className="py-1">{formatUnits(x.shareUnits)}</Td><Td num className="py-1">{formatCents(x.amountCents)}</Td><Td num className="py-1">{formatCents(x.amountCents + x.dividendsCents - x.costBasisCents, { sign: true })}</Td></tr>)}</tbody>
              </Table>
            </section>
          ) : null}
          <section aria-labelledby="votes">
            <SectionHeading id="votes" aside={`${p.votes.length} votes`}>Votes cast</SectionHeading>
            {p.votes.length ? (
              <Table caption="Votes">
                <thead><tr><Th>Holder</Th><Th>Choice</Th><Th num>Shares</Th><Th num>Counted</Th><Th>When</Th></tr></thead>
                <tbody>{p.votes.map((v) => <tr key={v.id} className="hover:bg-paper-deep"><Td className="py-1">{v.user.name}</Td><Td className="py-1">{v.choice.toLowerCase()}</Td><Td num className="py-1">{formatUnits(v.rawShareUnits, 2)}</Td><Td num className="py-1">{formatUnits(v.countedShareUnits, 2)}{v.countedShareUnits < v.rawShareUnits ? <span className="block text-xs text-stone">capped</span> : null}</Td><Td className="num py-1 text-ink-soft">{fmtDateTime(v.castAt)}</Td></tr>)}</tbody>
              </Table>
            ) : <p className="text-sm text-stone">No votes yet.</p>}
          </section>
        </div>
      </div>
    </>
  );
}
