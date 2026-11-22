import Link from "next/link";
import { ButtonLink } from "@/components/ui/button";
import { Badge, PageHeader, Table, Td, Th } from "@/components/ui/primitives";
import { prisma } from "@/lib/db";
import { formatBps, formatCentsWhole, ratioBps } from "@/lib/domain/money";
import { PROPERTY_STATUS } from "@/lib/labels";
import { requireAdmin } from "@/lib/session";

export const metadata = { title: "Properties" };

export default async function AdminProperties() {
  await requireAdmin();
  const props = await prisma.property.findMany({ orderBy: { sequence: "asc" }, include: { _count: { select: { holdings: { where: { shareUnits: { gt: 0n } } } } } } });
  return (
    <>
      <PageHeader title="Properties" actions={<ButtonLink href="/admin/properties/new">Add a property</ButtonLink>} />
      <Table caption="Properties" className="mt-6">
        <thead><tr><Th>No.</Th><Th>Property</Th><Th>Status</Th><Th num>Purchase price</Th><Th num>Sold</Th><Th num>Holders</Th></tr></thead>
        <tbody>
          {props.map((p) => (
            <tr key={p.id} className="hover:bg-paper-deep">
              <Td className="num py-1">{String(p.sequence).padStart(3, "0")}</Td>
              <Td className="py-1"><Link href={`/admin/properties/${p.id}`} className="link">{p.name}</Link><span className="block text-xs text-stone">{p.city}, {p.state}</span></Td>
              <Td className="py-1"><Badge tone={PROPERTY_STATUS[p.status].tone}>{PROPERTY_STATUS[p.status].label}</Badge></Td>
              <Td num className="py-1">{formatCentsWhole(p.purchasePriceCents)}</Td>
              <Td num className="py-1">{formatBps(ratioBps(p.soldUnits, p.totalUnits), { decimals: 0 })}</Td>
              <Td num className="py-1">{p._count.holdings}</Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </>
  );
}
