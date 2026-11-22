import Link from "next/link";
import { ButtonLink } from "@/components/ui/button";
import { Badge, PageHeader, Table, Td, Th } from "@/components/ui/primitives";
import { prisma } from "@/lib/db";
import { formatBps } from "@/lib/domain/money";
import { fmtDate, PROPOSAL_STATUS, PROPOSAL_TYPE } from "@/lib/labels";
import { proposalTally } from "@/lib/proposal-view";
import { requireAdmin } from "@/lib/session";

export const metadata = { title: "Proposals" };

export default async function AdminProposals() {
  await requireAdmin();
  const list = await prisma.proposal.findMany({ include: { property: { select: { name: true } }, votes: true }, orderBy: { createdAt: "desc" } });
  return (
    <>
      <PageHeader title="Proposals" lede="Only major decisions go to a vote. Planned-exit votes are created automatically in a property’s exit year." actions={<ButtonLink href="/admin/proposals/new">New proposal</ButtonLink>} />
      <Table caption="Proposals" className="mt-6">
        <thead><tr><Th>Proposal</Th><Th>Type</Th><Th>Voting</Th><Th num>Turnout</Th><Th num>For</Th><Th>Status</Th></tr></thead>
        <tbody>
          {list.map((p) => {
            const t = proposalTally(p, p.votes);
            return (
              <tr key={p.id} className="hover:bg-paper-deep">
                <Td className="py-1"><Link className="link" href={`/admin/proposals/${p.id}`}>{p.title}</Link><span className="block text-xs text-stone">{p.property.name}</span></Td>
                <Td className="py-1 text-ink-soft">{PROPOSAL_TYPE[p.type]}{p.isPlannedExit ? " (planned exit)" : ""}</Td>
                <Td className="num py-1 text-ink-soft">{fmtDate(p.opensAt)} – {fmtDate(p.closesAt)}</Td>
                <Td num className="py-1">{p.status === "DRAFT" ? "—" : formatBps(t.turnoutBps, { decimals: 0 })}</Td>
                <Td num className="py-1">{p.status === "DRAFT" ? "—" : formatBps(t.forBps, { decimals: 0 })}</Td>
                <Td className="py-1"><Badge tone={PROPOSAL_STATUS[p.status].tone}>{PROPOSAL_STATUS[p.status].label}</Badge></Td>
              </tr>
            );
          })}
        </tbody>
      </Table>
    </>
  );
}
