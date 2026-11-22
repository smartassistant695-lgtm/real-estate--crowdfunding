import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { InvestingDisclosure } from "@/components/site/footer";
import { OrderBook, RecentTrades, loadBook } from "@/components/site/order-book";
import { TradingDisclosureText } from "@/components/site/risk-text";
import { ButtonLink } from "@/components/ui/button";
import { ActionForm, Checkbox, Submit } from "@/components/ui/form";
import { Badge, Empty, Facts, Note, Page, SectionHeading, Table, Td, Th } from "@/components/ui/primitives";
import { prisma } from "@/lib/db";
import { sellableUnits } from "@/lib/domain/holding";
import { formatCents, formatUnits } from "@/lib/domain/money";
import { circuitBreakerBand } from "@/lib/domain/trading-rules";
import { daysUntil, fmtDateTime, fmtDay, ORDER_STATUS } from "@/lib/labels";
import { buybackQuoteFor, latestAppraisal, nextWindowFor, openWindowFor } from "@/lib/services/trading";
import { requireInvestor } from "@/lib/session";
import { getSettings } from "@/lib/settings";
import { acceptTradingDisclosureAction, cancelOrderAction, placeOrderAction, sellToReserveAction } from "@/app/orders/actions";
import { CancelOrderButton, OrderForm, ReserveForm } from "./form";

export const metadata: Metadata = { title: "Trade" };

export default async function TradePage({ params }: { params: Promise<{ slug: string }> }) {
  const user = await requireInvestor();
  const { slug } = await params;
  const p = await prisma.property.findUnique({ where: { slug } });
  if (!p) notFound();
  const now = new Date();
  const [settings, appraisal, open, next, holding, lots, myOrders, book] = await Promise.all([
    getSettings(),
    latestAppraisal(prisma, p.id),
    openWindowFor(prisma, p.id, now),
    nextWindowFor(prisma, p.id, now),
    prisma.holding.findUnique({ where: { userId_propertyId: { userId: user.id, propertyId: p.id } } }),
    prisma.holdingLot.findMany({ where: { userId: user.id, propertyId: p.id, remainingUnits: { gt: 0n } } }),
    prisma.order.findMany({ where: { userId: user.id, propertyId: p.id, status: { in: ["OPEN", "PARTIALLY_FILLED"] } }, orderBy: { seq: "desc" } }),
    loadBook(p.id),
  ]);
  const sellable = (() => {
    const v = sellableUnits(lots, now, settings.holdingPeriodMonths) - (holding?.reservedUnits ?? 0n);
    return v > 0n ? v : 0n;
  })();
  const reserve = await buybackQuoteFor(prisma, p.id, 0n, now);
  const header = (
    <header className="border-b border-ink pb-6 pt-10 md:pt-14">
      <nav aria-label="Breadcrumb" className="mb-4 text-sm text-stone"><Link href={`/properties/${p.slug}`} className="hover:text-ink">{p.name}</Link> <span aria-hidden>/</span> Trade</nav>
      <h1 className="text-2xl md:text-3xl">Buy or sell shares of {p.name}</h1>
      <p className="mt-2 text-ink-soft">{p.city}, {p.state}</p>
    </header>
  );

  if (p.status !== "TRADING" || !appraisal) {
    return (
      <Page className="pb-8">
        {header}
        <Empty title="Shares of this home are not trading." action={<ButtonLink href={`/properties/${p.slug}`} variant="secondary">Back to the property</ButtonLink>}>
          {p.status === "EXIT_VOTE" ? "Holders are deciding whether to sell the home, so trading is paused until that is settled." : p.status === "FUNDING" ? "The offering is still open. You can buy at the offering price instead." : "Trading starts once a home is fully funded and has been appraised."}
        </Empty>
      </Page>
    );
  }

  if (!user.tradingDisclosureAcceptedAt) {
    return (
      <Page narrow className="pb-8">
        {header}
        <section className="pt-8">
          <h2 className="mb-4 text-lg">Before your first trade</h2>
          <ActionForm action={acceptTradingDisclosureAction}>
            <div className="border border-rule bg-card px-5 py-5 md:px-8 md:py-6"><TradingDisclosureText /></div>
            <Checkbox className="mt-5" name="accept" required label="I understand that orders can only be placed during trading windows, may not be filled, and expire when the window closes." />
            <Submit size="lg" className="mt-6 w-full sm:w-auto">Accept and continue</Submit>
          </ActionForm>
        </section>
      </Page>
    );
  }

  const band = circuitBreakerBand(appraisal.navPerShareCents, settings.circuitBreakerBps);
  const closes = open ? fmtDay(new Date(open.closesAt.getTime() - 1)) : "";

  return (
    <Page className="pb-8">
      {header}
      <Note tone={open ? "neutral" : "notice"} className="mt-8" title={open ? `The trading window is open until ${closes} (${daysUntil(open.closesAt)})` : "The trading window is closed"}>
        {open ? `${open.period ? "" : "This is a demo window opened outside the usual first-of-the-month days. "}Orders not matched by then expire; shares and cash set aside for them are released.` : next ? `The next window runs ${fmtDay(next.opensAt)} to ${fmtDay(new Date(next.closesAt.getTime() - 1))}. You can read the order book in the meantime.` : "No window is scheduled yet."}
      </Note>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-12 pt-10 lg:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="min-w-0 space-y-14">
          <section aria-labelledby="book">
            <SectionHeading id="book" aside={`Appraised value ${formatCents(appraisal.navPerShareCents)} per share`}>Order book</SectionHeading>
            <OrderBook propertyId={p.id} />
          </section>
          <section aria-labelledby="mine">
            <SectionHeading id="mine" aside={<Link href="/orders" className="link">All your orders</Link>}>Your open orders</SectionHeading>
            {myOrders.length === 0 ? <p className="text-sm text-stone">You have no open orders for this property.</p> : (
              <Table caption="Your open orders">
                <thead><tr><Th>Placed</Th><Th>Side</Th><Th num>Price</Th><Th num>Filled</Th><Th>Status</Th><Th num><span className="sr-only">Actions</span></Th></tr></thead>
                <tbody>
                  {myOrders.map((o) => (
                    <tr key={o.id}>
                      <Td className="text-ink-soft">{fmtDateTime(o.createdAt)}</Td>
                      <Td>{o.side === "BUY" ? "Buy" : "Sell"}</Td>
                      <Td num>{formatCents(o.limitPriceCents)}</Td>
                      <Td num>{formatUnits(o.filledUnits, 2)} of {formatUnits(o.shareUnits, 2)}</Td>
                      <Td><Badge tone={ORDER_STATUS[o.status].tone}>{ORDER_STATUS[o.status].label}</Badge></Td>
                      <Td num><CancelOrderButton action={cancelOrderAction} orderId={o.id} /></Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </section>
          <section aria-labelledby="trades">
            <SectionHeading id="trades">Recent trades</SectionHeading>
            <RecentTrades propertyId={p.id} />
          </section>
        </div>

        <aside className="space-y-12 lg:border-l lg:border-rule lg:pl-8">
          <section aria-labelledby="ticket">
            <h2 id="ticket" className="mb-4 text-lg">Place an order</h2>
            {open ? (
              <OrderForm
                action={placeOrderAction}
                propertyId={p.id}
                propertyName={p.name}
                navCents={appraisal.navPerShareCents.toString()}
                bandMinCents={band.minCents.toString()}
                bandMaxCents={band.maxCents.toString()}
                availableCents={(user.wallet?.availableCents ?? 0n).toString()}
                sellableUnits={sellable.toString()}
                windowCloses={closes}
                holdingMonths={settings.holdingPeriodMonths}
                bestAskCents={book.asks[0]?.priceCents.toString() ?? null}
                bestBidCents={book.bids[0]?.priceCents.toString() ?? null}
              />
            ) : <p className="text-sm text-ink-soft">Orders can be placed while a trading window is open.</p>}
            <Facts className="mt-6" rows={[
              { label: "You own", value: `${formatUnits(holding?.shareUnits ?? 0n)} shares` },
              { label: "Sellable now", value: `${formatUnits(sellable)} shares` },
              { label: "Cash available", value: formatCents(user.wallet?.availableCents ?? 0n) },
              { label: "Allowed price range", value: `${formatCents(band.minCents)} – ${formatCents(band.maxCents)}` },
            ]} />
          </section>

          {reserve ? (
            <section aria-labelledby="reserve">
              <h2 id="reserve" className="mb-2 text-lg">Sell to the reserve</h2>
              <p className="mb-4 text-sm text-ink-soft">
                Part of each month’s rent builds a reserve that buys shares back at {formatCents(reserve.quote.priceCents)}, which is {reserve.reserve.discountBps / 100}% below the appraised value, up to {formatCents(reserve.reserve.monthlyCapCents, { whole: true })} a month. It is a way out, not a good price. Shares bought back are retired.
              </p>
              {!open ? <p className="text-sm text-stone">Available while a trading window is open.</p> : reserve.quote.budgetCents <= 0n ? (
                <Note tone="notice">The reserve has no budget left this month ({formatCents(reserve.usedThisMonthCents)} used). Try a market order, or come back next month.</Note>
              ) : sellable === 0n ? (
                <p className="text-sm text-stone">You have no shares past the {settings.holdingPeriodMonths}-month holding period yet.</p>
              ) : (
                <ReserveForm action={sellToReserveAction} propertyId={p.id} priceCents={reserve.quote.priceCents.toString()} maxUnits={reserve.quote.maxUnits.toString()} sellableUnits={sellable.toString()} />
              )}
            </section>
          ) : null}
        </aside>
      </div>
      <InvestingDisclosure />
    </Page>
  );
}
