import Link from "next/link";
import { PageHeader, Table, Td, Th } from "@/components/ui/primitives";
import { prisma } from "@/lib/db";
import { formatBps, formatCents, formatUnits } from "@/lib/domain/money";
import { monthKey } from "@/lib/domain/trading-rules";
import { requireAdmin } from "@/lib/session";

export const metadata = { title: "Liquidity reserves" };

export default async function AdminReserves() {
  await requireAdmin();
  const period = monthKey(new Date());
  const [reserves, buybacks] = await Promise.all([
    prisma.liquidityReserve.findMany({ include: { property: true }, orderBy: { property: { sequence: "asc" } } }),
    prisma.trade.groupBy({ by: ["propertyId"], where: { isBuyback: true }, _sum: { shareUnits: true, notionalCents: true }, _count: true }),
  ]);
  const bb = new Map(buybacks.map((b) => [b.propertyId, b]));
  return (
    <>
      <PageHeader title="Liquidity reserves" lede="Each funded property keeps a reserve, filled from its monthly income, that buys shares back at a discount up to a monthly cap. Bought-back shares are retired." />
      <Table caption="Liquidity reserves" className="mt-6">
        <thead><tr><Th>Property</Th><Th num>Balance</Th><Th num>Monthly cap</Th><Th num>Used this month</Th><Th num>Discount</Th><Th num>Bought back to date</Th><Th num>Shares retired</Th></tr></thead>
        <tbody>
          {reserves.map((r) => {
            const used = r.usagePeriod === period ? r.usedThisMonthCents : 0n;
            const b = bb.get(r.propertyId);
            return (
              <tr key={r.id} className="hover:bg-paper-deep">
                <Td className="py-1"><Link className="link" href={`/admin/properties/${r.propertyId}`}>{r.property.name}</Link></Td>
                <Td num className="py-1">{formatCents(r.balanceCents)}</Td>
                <Td num className="py-1">{formatCents(r.monthlyCapCents, { whole: true })}</Td>
                <Td num className="py-1">{formatCents(used)}</Td>
                <Td num className="py-1">{formatBps(r.discountBps, { decimals: 1 })}</Td>
                <Td num className="py-1">{formatCents(b?._sum.notionalCents ?? 0n)}<span className="block text-xs text-stone">{b?._count ?? 0} sale(s)</span></Td>
                <Td num className="py-1">{formatUnits(r.property.retiredUnits, 2)}</Td>
              </tr>
            );
          })}
        </tbody>
      </Table>
      <p className="mt-3 text-xs text-stone">The cap and discount follow the platform settings. The usable budget each month is the smaller of the cap left and the reserve balance.</p>
    </>
  );
}
