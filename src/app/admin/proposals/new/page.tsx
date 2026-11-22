import { ActionForm, Input, Select, Submit, Textarea } from "@/components/ui/form";
import { PageHeader, SectionHeading } from "@/components/ui/primitives";
import { prisma } from "@/lib/db";
import { formatBps } from "@/lib/domain/money";
import { PROPOSAL_TYPE } from "@/lib/labels";
import { requireAdmin } from "@/lib/session";
import { getSettings } from "@/lib/settings";
import { createProposalAction } from "../../actions";

export const metadata = { title: "New proposal" };
const iso = (d: Date) => d.toISOString().slice(0, 16);

export default async function NewProposal() {
  await requireAdmin();
  const [props, s] = await Promise.all([prisma.property.findMany({ where: { status: { in: ["FUNDED", "TRADING", "EXIT_VOTE"] } }, orderBy: { sequence: "asc" } }), getSettings()]);
  const now = Date.now();
  return (
    <>
      <PageHeader back={{ href: "/admin/proposals", label: "Proposals" }} title="New proposal" lede={`Saved as a draft. Rules are fixed when it is created: quorum ${formatBps(s.proposalQuorumBps, { decimals: 0 })}, passes above ${formatBps(s.proposalPassThresholdBps, { decimals: 0 })}, voting capped at ${formatBps(s.votingCapBps, { decimals: 0 })} per holder.`} />
      <ActionForm action={createProposalAction} className="space-y-12 pt-8">
        <fieldset className="space-y-5">
          <SectionHeading>The decision</SectionHeading>
          <div className="grid gap-5 md:grid-cols-2">
            <Select label="Property" name="propertyId" required>{props.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>
            <Select label="Type" name="type" required>{Object.entries(PROPOSAL_TYPE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>
          </div>
          <Input label="Title" name="title" required hint="State the decision, e.g. “Replace the roof for $14,200”." />
          <Textarea label="Plain-English summary" name="summary" rows={3} required hint="One or two sentences a first-time investor understands." />
          <Textarea label="Full details" name="details" rows={8} required hint="Paragraphs, “- ” lists and **bold** are supported." />
          <div className="grid gap-5 md:grid-cols-2">
            <Textarea label="Arguments for (manager)" name="pros" rows={4} hint="One “- ” point per line." />
            <Textarea label="Arguments against (manager)" name="cons" rows={4} hint="One “- ” point per line." />
          </div>
          <Textarea label="Financial impact" name="impact" rows={4} hint="One row per line: Label | Today | If it passes" />
          <Input label="Extend exit by (years)" name="extendYears" inputMode="numeric" hint="Only for “Extend exit date”: 1 or 2." className="max-w-form" />
        </fieldset>
        <fieldset className="space-y-5">
          <SectionHeading aside="All times UTC">Dates</SectionHeading>
          <div className="grid gap-5 md:grid-cols-3">
            <Input label="Record date" name="recordDate" type="datetime-local" defaultValue={iso(new Date(now))} required hint="Holdings at this moment decide who votes and how much." />
            <Input label="Voting opens" name="opensAt" type="datetime-local" defaultValue={iso(new Date(now + 3_600_000))} required />
            <Input label="Voting closes" name="closesAt" type="datetime-local" defaultValue={iso(new Date(now + 14 * 86_400_000))} required />
          </div>
        </fieldset>
        <Submit size="lg" className="w-full sm:w-auto" pendingLabel="Saving…">Save draft</Submit>
      </ActionForm>
    </>
  );
}
