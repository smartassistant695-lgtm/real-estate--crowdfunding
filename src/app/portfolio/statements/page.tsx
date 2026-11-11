import type { Metadata } from "next";
import Link from "next/link";
import { Empty, Page, PageHeader, Table, Td, Th } from "@/components/ui/primitives";
import { prisma } from "@/lib/db";
import { monthKey, monthLabel } from "@/lib/domain/trading-rules";
import { requireInvestor } from "@/lib/session";

export const metadata: Metadata = { title: "Statements" };

export default async function StatementsPage() {
  const user = await requireInvestor();
  const rows = await prisma.$queryRaw<{ month: string; entries: bigint }[]>`
    SELECT to_char("createdAt" AT TIME ZONE 'UTC', 'YYYY-MM') AS month, count(*) AS entries
    FROM "LedgerEntry" WHERE "userId" = ${user.id} AND "account" = 'USER_WALLET'
    GROUP BY 1 ORDER BY 1 DESC`;
  const current = monthKey(new Date());
  const complete = rows.filter((r) => r.month < current);
  return (
    <Page narrow className="pb-8">
      <PageHeader eyebrow={<Link href="/portfolio" className="hover:text-ink">Portfolio</Link>} title="Monthly statements" lede="One statement for each month your account had activity. A statement is produced once the month has ended." />
      {complete.length === 0 ? (
        <Empty title="Your first statement arrives next month.">Statements cover a full calendar month and are generated from the ledger after it ends.</Empty>
      ) : (
        <Table caption="Statements" className="mt-4">
          <thead><tr><Th>Period</Th><Th num>Entries</Th><Th num>&nbsp;</Th></tr></thead>
          <tbody>
            {complete.map((r) => (
              <tr key={r.month}>
                <Td className="font-serif text-md">{monthLabel(r.month)}</Td>
                <Td num className="text-ink-soft">{r.entries.toString()}</Td>
                <Td num><Link className="link" href={`/portfolio/statements/${r.month}`}>View statement</Link></Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Page>
  );
}
