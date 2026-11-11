import type { Metadata } from "next";
import Link from "next/link";
import type { LedgerType } from "@prisma/client";
import { ButtonLink } from "@/components/ui/button";
import { Empty, Money, Page, PageHeader, Table, Tabs, Td, Th } from "@/components/ui/primitives";
import { prisma } from "@/lib/db";
import { formatUnits } from "@/lib/domain/money";
import { fmtDateTime, LEDGER_TYPE } from "@/lib/labels";
import { requireInvestor } from "@/lib/session";

export const metadata: Metadata = { title: "Activity" };
const PAGE = 40;
const FILTERS: Record<string, { label: string; types?: LedgerType[] }> = {
  all: { label: "Everything" },
  cash: { label: "Deposits & withdrawals", types: ["DEPOSIT", "WITHDRAWAL", "ADJUSTMENT", "REFUND"] },
  shares: { label: "Purchases & trades", types: ["PRIMARY_PURCHASE", "TRADE_BUY", "TRADE_SELL", "BUYBACK_SALE", "EXIT_PROCEEDS"] },
  dividends: { label: "Dividends", types: ["DIVIDEND"] },
};

export default async function ActivityPage({ searchParams }: { searchParams: Promise<{ show?: string; page?: string }> }) {
  const user = await requireInvestor();
  const sp = await searchParams;
  const show = sp.show && sp.show in FILTERS ? sp.show : "all";
  const page = Math.max(1, Math.min(500, Number.parseInt(sp.page ?? "1", 10) || 1));
  const where = { userId: user.id, account: "USER_WALLET" as const, ...(FILTERS[show]!.types ? { type: { in: FILTERS[show]!.types } } : {}) };
  const [entries, total] = await Promise.all([
    prisma.ledgerEntry.findMany({ where, orderBy: { seq: "desc" }, skip: (page - 1) * PAGE, take: PAGE, include: { property: { select: { name: true, slug: true } } } }),
    prisma.ledgerEntry.count({ where }),
  ]);
  const pages = Math.max(1, Math.ceil(total / PAGE));
  return (
    <Page className="pb-8">
      <PageHeader eyebrow={<Link href="/portfolio" className="hover:text-ink">Portfolio</Link>} title="Activity" lede="Every movement of cash and shares in your account, straight from the ledger. Entries are never edited or deleted." actions={<ButtonLink href="/portfolio/statements" variant="secondary">Monthly statements</ButtonLink>} />
      <Tabs className="mt-6" label="Filter activity" current={show} tabs={Object.entries(FILTERS).map(([key, f]) => ({ key, label: f.label, href: `/portfolio/activity${key === "all" ? "" : `?show=${key}`}` }))} />
      {entries.length === 0 ? <Empty title="Nothing here yet." /> : (
        <Table caption="Account activity" className="mt-4">
          <thead><tr><Th>When</Th><Th>Type</Th><Th>Details</Th><Th num>Shares</Th><Th num>Cash</Th></tr></thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id}>
                <Td className="num text-ink-soft whitespace-nowrap">{fmtDateTime(e.createdAt)}</Td>
                <Td className="whitespace-nowrap">{LEDGER_TYPE[e.type]}</Td>
                <Td className="text-ink-soft">{e.memo}</Td>
                <Td num>{e.shareUnits ? `${e.shareUnits > 0n ? "+" : ""}${formatUnits(e.shareUnits)}` : ""}</Td>
                <Td num><Money cents={e.amountCents} sign /></Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      {pages > 1 ? (
        <nav aria-label="Pages" className="mt-6 flex items-center justify-between text-sm">
          {page > 1 ? <Link className="link" href={`/portfolio/activity?show=${show}&page=${page - 1}`}>Newer</Link> : <span />}
          <span className="num text-stone">Page {page} of {pages}</span>
          {page < pages ? <Link className="link" href={`/portfolio/activity?show=${show}&page=${page + 1}`}>Older</Link> : <span />}
        </nav>
      ) : null}
    </Page>
  );
}
