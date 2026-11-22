import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage } from "@/components/marketing/legal";
import { Badge, Empty, Note, SectionHeading, Table, Td, Th } from "@/components/ui/primitives";
import { prisma } from "@/lib/db";
import { DOCUMENT_CATEGORY, fmtDate, PROPERTY_STATUS } from "@/lib/labels";

export const metadata: Metadata = { title: "Offering documents (draft)" };
export const dynamic = "force-dynamic";

export default async function OfferingDocuments() {
  const [properties, general] = await Promise.all([
    prisma.property.findMany({
      where: { documents: { some: {} } },
      orderBy: { sequence: "asc" },
      select: { id: true, slug: true, name: true, city: true, state: true, entityName: true, status: true, documents: { orderBy: [{ category: "asc" }, { publishedAt: "desc" }] } },
    }),
    prisma.document.findMany({ where: { propertyId: null }, orderBy: { publishedAt: "desc" } }),
  ]);

  const docTable = (caption: string, docs: { id: string; title: string; url: string; category: keyof typeof DOCUMENT_CATEGORY; publishedAt: Date }[]) => (
    <Table caption={caption}>
      <thead>
        <tr>
          <Th>Document</Th>
          <Th>Type</Th>
          <Th num>Published</Th>
        </tr>
      </thead>
      <tbody>
        {docs.map((d) => (
          <tr key={d.id}>
            <Td><Link className="link" href={d.url}>{d.title}</Link></Td>
            <Td className="text-ink-soft">{DOCUMENT_CATEGORY[d.category]}</Td>
            <Td num className="text-ink-soft">{fmtDate(d.publishedAt)}</Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );

  return (
    <LegalPage current="/legal/offering-documents" title="Offering documents" lede="Every document published for each property, in one place." updated="November 2026">
      <Note className="mb-10 max-w-prose">
        These are placeholders. In this demo, document storage is a mock and each link opens a page saying so. In a live product each would be a signed PDF: the offering circular, the company’s operating agreement, the inspection report, appraisals, annual financial statements and tax forms.
      </Note>

      {properties.length === 0 && general.length === 0 ? (
        <Empty title="No documents are published yet.">Documents are posted before an offering opens.</Empty>
      ) : null}

      <div className="grid grid-cols-1 gap-14">
        {properties.map((p) => (
          <section key={p.id} aria-labelledby={`docs-${p.slug}`}>
            <SectionHeading id={`docs-${p.slug}`} aside={<Badge tone={PROPERTY_STATUS[p.status].tone}>{PROPERTY_STATUS[p.status].label}</Badge>}>
              <Link href={`/properties/${p.slug}`} className="underline-offset-4 hover:underline">{p.name}</Link>
            </SectionHeading>
            <p className="-mt-2 mb-3 text-sm text-stone">{p.city}, {p.state} · issued by {p.entityName}</p>
            {docTable(`Documents for ${p.name}`, p.documents)}
          </section>
        ))}
        {general.length ? (
          <section aria-labelledby="docs-platform">
            <SectionHeading id="docs-platform">Platform documents</SectionHeading>
            {docTable("Platform documents", general)}
          </section>
        ) : null}
      </div>
    </LegalPage>
  );
}
