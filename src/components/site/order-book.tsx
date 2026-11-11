import { Table, Td, Th } from "@/components/ui/primitives";
import { prisma } from "@/lib/db";
import { depth, type BookOrder } from "@/lib/domain/matching";
import { formatCents, formatUnits } from "@/lib/domain/money";
import { fmtDateTime } from "@/lib/labels";

export async function loadBook(propertyId: string) {
  const orders = await prisma.order.findMany({ where: { propertyId, status: { in: ["OPEN", "PARTIALLY_FILLED"] }, window: { status: "OPEN" } } });
  const book: BookOrder[] = orders.map((o) => ({ id: o.id, userId: o.userId, side: o.side, limitPriceCents: o.limitPriceCents, remainingUnits: o.shareUnits - o.filledUnits, seq: o.seq }));
  return { bids: depth(book, "BUY"), asks: depth(book, "SELL") };
}

/** Order book depth: what buyers are offering and what sellers are asking, best prices first. */
export async function OrderBook({ propertyId }: { propertyId: string }) {
  const { bids, asks } = await loadBook(propertyId);
  const maxUnits = [...bids, ...asks].reduce((m, l) => (l.units > m ? l.units : m), 1n);
  const side = (title: string, levels: typeof bids, tone: "bid" | "ask", empty: string) => (
    <div>
      <Table caption={title}>
        <thead>
          <tr>
            <Th>{title}</Th>
            <Th num>Shares</Th>
            <Th num>Orders</Th>
          </tr>
        </thead>
        <tbody>
          {levels.slice(0, 8).map((l) => (
            <tr key={l.priceCents.toString()}>
              <Td className="num relative">
                <span aria-hidden className={`absolute inset-y-1 left-0 ${tone === "bid" ? "bg-accent-wash" : "bg-paper-deep"}`} style={{ width: `${Number((l.units * 100n) / maxUnits)}%` }} />
                <span className="relative">{formatCents(l.priceCents)}</span>
              </Td>
              <Td num>{formatUnits(l.units, 2)}</Td>
              <Td num>{l.orders}</Td>
            </tr>
          ))}
        </tbody>
      </Table>
      {levels.length === 0 ? <p className="py-4 text-sm text-stone">{empty}</p> : null}
    </div>
  );
  return (
    <div className="grid gap-8 sm:grid-cols-2">
      {side("Buyers will pay", bids, "bid", "No buy orders right now.")}
      {side("Sellers are asking", asks, "ask", "No sell orders right now.")}
    </div>
  );
}

export async function RecentTrades({ propertyId, take = 10 }: { propertyId: string; take?: number }) {
  const trades = await prisma.trade.findMany({ where: { propertyId }, orderBy: { executedAt: "desc" }, take });
  if (trades.length === 0) return <p className="border-y border-rule py-6 text-sm text-stone">No shares of this property have changed hands yet.</p>;
  return (
    <Table caption="Recent trades">
      <thead>
        <tr>
          <Th>When</Th>
          <Th>Type</Th>
          <Th num>Price</Th>
          <Th num>Shares</Th>
          <Th num>Total</Th>
        </tr>
      </thead>
      <tbody>
        {trades.map((t) => (
          <tr key={t.id}>
            <Td className="text-ink-soft">{fmtDateTime(t.executedAt)}</Td>
            <Td>{t.isBuyback ? "Reserve buyback" : "Between investors"}</Td>
            <Td num>{formatCents(t.priceCents)}</Td>
            <Td num>{formatUnits(t.shareUnits, 2)}</Td>
            <Td num>{formatCents(t.notionalCents)}</Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}
