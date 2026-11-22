import Link from "next/link";
import { notFound } from "next/navigation";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { ActionForm, Input, Select, Submit, Textarea } from "@/components/ui/form";
import { Badge, Note, PageHeader, SectionHeading, Table, Td, Th } from "@/components/ui/primitives";
import { prisma } from "@/lib/db";
import { formatCents, formatCentsWhole, formatUnits } from "@/lib/domain/money";
import { DOCUMENT_CATEGORY, fmtDate, PROPERTY_STATUS } from "@/lib/labels";
import { requireAdmin } from "@/lib/session";
import { addAppraisalAction, cancelOfferingAction, changeStatusAction, setPhotosAction, updatePropertyAction, uploadDocumentAction } from "../../actions";
import { PropertyForm } from "../property-form";

export const metadata = { title: "Edit property" };

const NEXT: Record<string, { to: string; label: string; body: string }[]> = {
  COMING_SOON: [{ to: "FUNDING", label: "Open the offering", body: "Investors will be able to buy shares at the offering price until the deadline. Needs a future deadline, the offering circular and an appraisal." }],
  FUNDING: [{ to: "COMING_SOON", label: "Move back to Coming soon", body: "Only possible while no shares have been sold." }],
  FUNDED: [{ to: "TRADING", label: "Start trading", body: "Investors will be able to place orders on this property during trading windows." }],
  TRADING: [{ to: "FUNDED", label: "Pause trading", body: "No new orders can be placed. Existing orders stay until the window closes." }],
};

export default async function EditProperty({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ created?: string }> }) {
  await requireAdmin();
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const p = await prisma.property.findUnique({ where: { id }, include: { photos: { orderBy: { position: "asc" } }, documents: { orderBy: { publishedAt: "desc" } }, appraisals: { orderBy: [{ effectiveDate: "desc" }, { createdAt: "desc" }] } } });
  if (!p) notFound();
  const locked = p.status !== "COMING_SOON" || p.soldUnits > 0n;
  return (
    <>
      <PageHeader back={{ href: "/admin/properties", label: "Properties" }} title={p.name} lede={`${p.street}, ${p.city}, ${p.state} · ${p.entityName}`} actions={<Link href={`/properties/${p.slug}`} className="link text-sm">View listing</Link>} />
      {sp.created ? <Note className="mt-6">Created as Coming soon. Next: photos, documents and an appraisal.</Note> : null}

      <section className="pt-10" aria-labelledby="status">
        <SectionHeading id="status">Status</SectionHeading>
        <div className="flex flex-wrap items-center gap-4">
          <Badge tone={PROPERTY_STATUS[p.status].tone}>{PROPERTY_STATUS[p.status].label}</Badge>
          <p className="text-sm text-ink-soft">{PROPERTY_STATUS[p.status].explain}</p>
        </div>
        <div className="mt-4 flex flex-wrap gap-3">
          {(NEXT[p.status] ?? []).map((n) => (
            <ConfirmAction key={n.to} action={changeStatusAction} fields={{ id: p.id, to: n.to }} trigger={n.label} title={`${n.label}?`} body={n.body} confirm={n.label} triggerVariant="secondary" />
          ))}
          {p.status === "FUNDING" ? (
            <ConfirmAction action={cancelOfferingAction} fields={{ id: p.id }} trigger="Cancel offering and refund" triggerVariant="danger" danger title={`Cancel the offering and refund ${formatUnits(p.soldUnits, 0)} shares?`} body="Every investor gets back exactly what they paid. This cannot be undone." confirm="Cancel and refund" />
          ) : null}
          {p.status === "EXIT_VOTE" ? <Link href="/admin/proposals" className="link text-sm">Record the sale from the passed proposal</Link> : null}
        </div>
      </section>

      <section className="pt-14" aria-labelledby="appraisals">
        <SectionHeading id="appraisals" aside="Orders priced outside the new range are closed automatically">Appraisals</SectionHeading>
        <div className="grid gap-10 xl:grid-cols-[1fr_20rem]">
          {p.appraisals.length ? (
            <Table caption="Appraisal history">
              <thead><tr><Th>Effective</Th><Th num>Value</Th><Th num>Per share</Th><Th>Source</Th></tr></thead>
              <tbody>{p.appraisals.map((a) => <tr key={a.id}><Td className="num py-1">{fmtDate(a.effectiveDate)}</Td><Td num className="py-1">{formatCentsWhole(a.valueCents)}</Td><Td num className="py-1">{formatCents(a.navPerShareCents)}</Td><Td className="py-1 text-ink-soft">{a.source}</Td></tr>)}</tbody>
            </Table>
          ) : <p className="text-sm text-stone">No appraisals yet.</p>}
          <ActionForm action={addAppraisalAction} className="max-w-form space-y-4">
            <input type="hidden" name="id" value={p.id} />
            <Input label="Appraised value" name="value" prefix="$" inputMode="decimal" required />
            <Input label="Effective date" name="effectiveDate" type="date" required />
            <Input label="Source" name="source" required placeholder="Independent appraisal — firm name" />
            <Textarea label="Notes" name="notes" rows={2} />
            <Submit variant="secondary" pendingLabel="Saving…">Add appraisal</Submit>
          </ActionForm>
        </div>
      </section>

      <section className="pt-14" aria-labelledby="photos">
        <SectionHeading id="photos" aside="Top line is the main photo">Photos</SectionHeading>
        <ActionForm action={setPhotosAction} className="space-y-4">
          <input type="hidden" name="id" value={p.id} />
          <Textarea label="One per line: image URL | description | credit | credit link" name="photos" rows={Math.max(3, p.photos.length + 1)} defaultValue={p.photos.map((ph) => [ph.url, ph.alt, ph.credit, ph.creditUrl].join(" | ")).join("\n")} hint="Reorder by moving lines. images.unsplash.com links only in this demo." />
          <Submit variant="secondary" pendingLabel="Saving…">Save photos</Submit>
        </ActionForm>
      </section>

      <section className="pt-14" aria-labelledby="docs">
        <SectionHeading id="docs" aside="Stored by the mock storage adapter">Documents</SectionHeading>
        <div className="grid gap-10 xl:grid-cols-[1fr_20rem]">
          {p.documents.length ? (
            <Table caption="Documents">
              <thead><tr><Th>Title</Th><Th>Type</Th><Th>Published</Th></tr></thead>
              <tbody>{p.documents.map((d) => <tr key={d.id}><Td className="py-1"><Link href={d.url} className="link">{d.title}</Link></Td><Td className="py-1 text-ink-soft">{DOCUMENT_CATEGORY[d.category]}</Td><Td className="num py-1 text-ink-soft">{fmtDate(d.publishedAt)}</Td></tr>)}</tbody>
            </Table>
          ) : <p className="text-sm text-stone">Nothing published yet.</p>}
          <ActionForm action={uploadDocumentAction} className="max-w-form space-y-4" encType="multipart/form-data">
            <input type="hidden" name="id" value={p.id} />
            <Input label="Title" name="title" required />
            <Select label="Type" name="category" defaultValue="OFFERING_CIRCULAR">
              {Object.entries(DOCUMENT_CATEGORY).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </Select>
            <Input label="PDF file" name="file" type="file" accept="application/pdf" required />
            <Submit variant="secondary" pendingLabel="Uploading…">Publish document</Submit>
          </ActionForm>
        </div>
      </section>

      <section className="pt-14" aria-labelledby="details">
        <h2 id="details" className="sr-only">Details</h2>
        <PropertyForm action={updatePropertyAction} p={p} locked={locked} />
      </section>
    </>
  );
}
