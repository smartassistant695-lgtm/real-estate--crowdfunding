import type { Metadata } from "next";
import Link from "next/link";
import { ButtonLink } from "@/components/ui/button";
import { Badge, Empty, Money, Page, PageHeader, SectionHeading, Table, Tabs, Td, Th } from "@/components/ui/primitives";
import { prisma } from "@/lib/db";
import { formatCents, formatUnits } from "@/lib/domain/money";
import { daysUntil, fmtDate, fmtDateTime, fmtDay, ORDER_STATUS } from "@/lib/labels";
import { requireInvestor } from "@/lib/session";
import { CancelOrderButton } from "../properties/[slug]/trade/form";
import { cancelOrderAction } from "./actions";

export const metadata: Metadata = { title: "Orders" };
const PAGE = 30;

export default async function OrdersPage({ searchParams }: { searchParams: Promise<{ show?: string; page?: string }> }) {
  const user = await requireInvestor();
  const sp = await searchParams;
  const show = sp.show === "history" ? "history" : sp.show === "trades" ? "trades" : "open";
  const page = Math.max(1, Math.min(500, Number.parseInt(sp.page ?? "1", 10) || 1));
  const now = new Date();
  const [open, window, next, openCount] = await Promise.all([
    prisma.order.findMany({ where: { userId: user.id, status: { in: ["OPEN", "PARTIALLY_FILLED"] } }, orderBy: { seq: "desc" }, include: { property: { select: { name: true, slug: true } }, window: true } }),
    prisma.tradingWindow.findFirst({ where: { status: "OPEN", closesAt: { gt: now } }, orderBy: { closesAt: "asc" } }),
    prisma.tradingWindow.findFirst({ where: { status: "SCHEDULED", closesAt: { gt: now } }, orderBy: { opensAt: "asc" } }),
    prisma.order.count({ where: { userId: user.id, status: { in: ["OPEN", "PARTIALLY_FILLED"] } } }),
  ]);

  const historyWhere = { userId: user.id, status: { in: ["FILLED", "CANCELLED", "EXPIRED"] as ("FILLED" | "CANCELLED" | "EXPIRED")[] } };
  const tradeWhere = { OR: [{ buyerId: user.id }, { sellerId: user.id }] };
  const [history, historyCount, trades, tradeCount] = await Promise.all([
    show === "history" ? prisma.order.findMany({ where: historyWhere, orderBy: { seq: "desc" }, skip: (page - 1) * PAGE, take: PAGE, include: { property: { select: { name: true, slug: true } } } }) : [],
    prisma.order.count({ where: historyWhere }),
    show === "trades" ? prisma.trade.findMany({ where: tradeWhere, orderBy: { executedAt: "desc" }, skip: (page - 1) * PAGE, take: PAGE, include: { property: { select: { name: true, slug: true } } } }) : [],
    prisma.trade.count({ where: tradeWhere }),
  ]);
  const total = show === "history" ? historyCount : show === "trades" ? tradeCount : 0;
  const pages = Math.max(1, Math.ceil(total / PAGE));

  return (
    <Page className="pb-8">
      <PageHeader
        title="Orders"
        lede={window ? `The trading window is open until ${fmtDay(new Date(window.closesAt.getTime() - 1))} (${daysUntil(window.closesAt)}). Unmatched orders expire when it closes.` : next ? `Trading is closed. The next window opens ${fmtDay(next.opensAt)} (${daysUntil(next.opensAt)}).` : "Trading is closed."}
        actions={<ButtonLink href="/portfolio" variant="secondary">Your holdings</ButtonLink>}
      />
      <Tabs className="mt-6" label="Order views" current={show} tabs={[
        { key: "open", label: "Open", count: openCount, href: "/orders" },
        { key: "history", label: "Order history", count: historyCount, href: "/orders?show=history" },
        { key: "trades", label: "Your trades", count: tradeCount, href: "/orders?show=trades" },
      ]} />

      {show === "open" ? (
        open.length === 0 ? (
          <Empty title="You have no open orders." action={<ButtonLink href="/properties?status=TRADING" variant="secondary">See trading properties</ButtonLink>}>
            Orders can be placed from a property’s Trade page while a window is open. Every order is a limit order: you set the price.
          </Empty>
        ) : (
          <Table caption="Open orders" className="mt-4">
            <thead><tr><Th>Property</Th><Th>Side</Th><Th num>Limit price</Th><Th num>Filled</Th><Th num>Cash held</Th><Th>Expires</Th><Th>Status</Th><Th num><span className="sr-only">Actions</span></Th></tr></thead>
            <tbody>
              {open.map((o) => (
                <tr key={o.id}>
                  <Td><Link href={`/properties/${o.property.slug}/trade`} className="link">{o.property.name}</Link><span className="block text-xs text-stone">{fmtDateTime(o.createdAt)}</span></Td>
                  <Td>{o.side === "BUY" ? "Buy" : "Sell"}</Td>
                  <Td num>{formatCents(o.limitPriceCents)}</Td>
                  <Td num>{formatUnits(o.filledUnits, 2)} of {formatUnits(o.shareUnits, 2)}</Td>
                  <Td num>{o.side === "BUY" ? formatCents(o.heldCents) : "—"}</Td>
                  <Td className="text-ink-soft">{fmtDate(o.window.closesAt)}</Td>
                  <Td><Badge tone={ORDER_STATUS[o.status].tone}>{ORDER_STATUS[o.status].label}</Badge></Td>
                  <Td num><CancelOrderButton action={cancelOrderAction} orderId={o.id} /></Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )
      ) : null}

      {show === "history" ? (
        history.length === 0 ? <Empty title="No past orders yet." /> : (
          <Table caption="Order history" className="mt-4">
            <thead><tr><Th>Placed</Th><Th>Property</Th><Th>Side</Th><Th num>Limit price</Th><Th num>Filled</Th><Th>Outcome</Th><Th>Closed</Th></tr></thead>
            <tbody>
              {history.map((o) => (
                <tr key={o.id}>
                  <Td className="text-ink-soft whitespace-nowrap">{fmtDate(o.createdAt)}</Td>
                  <Td><Link href={`/properties/${o.property.slug}`} className="link">{o.property.name}</Link></Td>
                  <Td>{o.side === "BUY" ? "Buy" : "Sell"}</Td>
                  <Td num>{formatCents(o.limitPriceCents)}</Td>
                  <Td num>{formatUnits(o.filledUnits, 2)} of {formatUnits(o.shareUnits, 2)}</Td>
                  <Td><Badge tone={ORDER_STATUS[o.status].tone}>{o.status === "EXPIRED" && o.filledUnits > 0n ? "Partly filled, rest expired" : ORDER_STATUS[o.status].label}</Badge></Td>
                  <Td className="text-ink-soft whitespace-nowrap">{o.closedAt ? fmtDate(o.closedAt) : ""}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )
      ) : null}

      {show === "trades" ? (
        trades.length === 0 ? <Empty title="You have not traded yet." /> : (
          <section className="mt-4">
            <SectionHeading aside="Every fill, including sales to the reserve">Your trades</SectionHeading>
            <Table caption="Your trades">
              <thead><tr><Th>When</Th><Th>Property</Th><Th>You</Th><Th num>Price</Th><Th num>Shares</Th><Th num>Cash</Th></tr></thead>
              <tbody>
                {trades.map((t) => {
                  const bought = t.buyerId === user.id;
                  return (
                    <tr key={t.id}>
                      <Td className="text-ink-soft whitespace-nowrap">{fmtDateTime(t.executedAt)}</Td>
                      <Td><Link href={`/properties/${t.property.slug}`} className="link">{t.property.name}</Link></Td>
                      <Td>{bought ? "Bought" : t.isBuyback ? "Sold to reserve" : "Sold"}</Td>
                      <Td num>{formatCents(t.priceCents)}</Td>
                      <Td num>{formatUnits(t.shareUnits, 2)}</Td>
                      <Td num><Money cents={bought ? -t.notionalCents : t.notionalCents} sign /></Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </section>
        )
      ) : null}

      {show !== "open" && pages > 1 ? (
        <nav aria-label="Pages" className="mt-6 flex items-center justify-between text-sm">
          {page > 1 ? <Link className="link" href={`/orders?show=${show}&page=${page - 1}`}>Newer</Link> : <span />}
          <span className="num text-stone">Page {page} of {pages}</span>
          {page < pages ? <Link className="link" href={`/orders?show=${show}&page=${page + 1}`}>Older</Link> : <span />}
        </nav>
      ) : null}
    </Page>
  );
}
