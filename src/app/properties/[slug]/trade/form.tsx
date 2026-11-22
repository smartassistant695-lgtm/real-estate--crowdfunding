"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ActionForm, Input, Submit, type FormAction } from "@/components/ui/form";
import { Facts, Note } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import { buyOrderHold, formatCents, formatUnits, ORDER_LOT_UNITS, parseDollarsToCents, parseSharesToUnits, tradeNotional } from "@/lib/domain/money";

type Props = {
  action: FormAction;
  propertyId: string;
  propertyName: string;
  navCents: string;
  bandMinCents: string;
  bandMaxCents: string;
  availableCents: string;
  sellableUnits: string;
  windowCloses: string; // already formatted, e.g. "November 22"
  holdingMonths: number;
  bestAskCents: string | null;
  bestBidCents: string | null;
};

/** Limit-order ticket. Figures here are previews; the server validates and recomputes everything. */
export function OrderForm(p: Props) {
  const nav = BigInt(p.navCents), lo = BigInt(p.bandMinCents), hi = BigInt(p.bandMaxCents);
  const available = BigInt(p.availableCents), sellable = BigInt(p.sellableUnits);
  const [side, setSide] = useState<"BUY" | "SELL">("BUY");
  const [price, setPrice] = useState((Number(nav) / 100).toFixed(2));
  const [qty, setQty] = useState("");
  const [review, setReview] = useState(false);

  const priceCents = parseDollarsToCents(price);
  const units = parseSharesToUnits(qty);
  const total = priceCents !== null && units !== null ? (side === "BUY" ? buyOrderHold(units, priceCents) : tradeNotional(units, priceCents)) : null;

  let problem: string | null = null;
  if (priceCents === null) problem = "Enter a price per share, like 10.25.";
  else if (priceCents < lo || priceCents > hi) problem = `Price must be between ${formatCents(lo)} and ${formatCents(hi)}.`;
  else if (units === null || units <= 0n) problem = "Enter how many shares.";
  else if (units % ORDER_LOT_UNITS !== 0n) problem = "Quantity must be in steps of 0.01 share.";
  else if (side === "BUY" && total !== null && total > available) problem = `This needs ${formatCents(total)} set aside; you have ${formatCents(available)} available.`;
  else if (side === "SELL" && units > sellable) problem = `You can sell up to ${formatUnits(sellable)} shares right now.`;

  const wouldMatch =
    priceCents !== null && ((side === "BUY" && p.bestAskCents && priceCents >= BigInt(p.bestAskCents)) || (side === "SELL" && p.bestBidCents && priceCents <= BigInt(p.bestBidCents)));

  return (
    <ActionForm action={p.action} idempotent onSubmit={() => setTimeout(() => setReview(false), 0)}>
      <input type="hidden" name="propertyId" value={p.propertyId} />
      <input type="hidden" name="side" value={side} />
      <div className={cn(review && "hidden")}>
        <div className="mb-5 grid grid-cols-2 text-sm" role="group" aria-label="Order side">
          {(["BUY", "SELL"] as const).map((s) => (
            <button key={s} type="button" aria-pressed={side === s} onClick={() => setSide(s)} className={cn("h-10 border border-ink first:rounded-l-sm last:-ml-px last:rounded-r-sm", side === s ? "bg-ink text-paper" : "hover:bg-paper-deep")}>
              {s === "BUY" ? "Buy" : "Sell"}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Input label="Your price per share" name="price" inputMode="decimal" prefix="$" value={price} onChange={(e) => setPrice(e.target.value)} hint={`Appraised ${formatCents(nav)}`} />
          <Input label="Shares" name="shares" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} hint={side === "SELL" ? `${formatUnits(sellable)} sellable` : "Steps of 0.01"} />
        </div>
        <p className="num mt-4 text-sm" aria-live="polite">
          {total !== null && units !== null && units > 0n ? (side === "BUY" ? <>Up to <strong className="font-medium">{formatCents(total)}</strong> will be set aside from your cash.</> : <>You would receive about <strong className="font-medium">{formatCents(total)}</strong> if it all sells at your price.</>) : <span className="text-stone">Enter a price and quantity.</span>}
        </p>
        {problem && qty ? <p className="mt-2 text-sm text-loss" role="alert">{problem}</p> : null}
        <Button size="lg" className="mt-5 w-full" disabled={!!problem} onClick={() => setReview(true)}>Review order</Button>
      </div>

      {review && priceCents !== null && units !== null && total !== null ? (
        <div>
          <p className="label mb-2">Review your order</p>
          <Facts rows={[
            { label: "Order", value: `${side === "BUY" ? "Buy" : "Sell"} ${formatUnits(units)} shares` },
            { label: "Property", value: p.propertyName },
            { label: side === "BUY" ? "Highest price you will pay" : "Lowest price you will accept", value: formatCents(priceCents) },
            { label: "Fees", value: "$0.00" },
            { label: side === "BUY" ? "Cash set aside" : "Proceeds if fully sold", value: formatCents(total), strong: true },
          ]} />
          <Note className="mt-4" title="What happens next">
            {wouldMatch ? "There is an order in the book at this price or better, so some or all of this is likely to trade straight away, at that order’s price. " : ""}
            {side === "SELL"
              ? `If no buyer matches by ${p.windowCloses}, your order will expire and your shares stay in your account. Part of the order may sell and the rest expire.`
              : `If no seller matches by ${p.windowCloses}, your order will expire and the cash set aside is released. If you pay less than your limit, the difference is released at once. Shares you buy cannot be sold for ${p.holdingMonths} months.`}{" "}
            You can cancel any unfilled part before then.
          </Note>
          <div className="mt-5 flex gap-3">
            <Submit size="lg" pendingLabel="Placing…">Place order</Submit>
            <Button size="lg" variant="secondary" onClick={() => setReview(false)}>Change</Button>
          </div>
        </div>
      ) : null}
    </ActionForm>
  );
}

export function ReserveForm({ action, propertyId, priceCents, maxUnits, sellableUnits }: { action: FormAction; propertyId: string; priceCents: string; maxUnits: string; sellableUnits: string }) {
  const price = BigInt(priceCents), max = BigInt(maxUnits), sellable = BigInt(sellableUnits);
  const cap = max < sellable ? max : sellable;
  const [qty, setQty] = useState("");
  const units = parseSharesToUnits(qty);
  const proceeds = units !== null ? tradeNotional(units, price) : null;
  const tooMany = units !== null && units > cap;
  return (
    <ActionForm action={action} idempotent className="max-w-form">
      <input type="hidden" name="propertyId" value={propertyId} />
      <Input label="Shares to sell to the reserve" name="shares" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} hint={`Up to ${formatUnits(cap, 2)} shares at ${formatCents(price)} each, while the reserve’s budget for this month lasts`} />
      <p className="num mt-3 text-sm" aria-live="polite">
        {proceeds !== null && units !== null && units > 0n && !tooMany ? <>You would receive <strong className="font-medium">{formatCents(proceeds)}</strong> immediately. The shares are retired.</> : tooMany ? <span className="text-loss">That is more than the reserve can buy from you right now.</span> : null}
      </p>
      <Submit variant="secondary" className="mt-4" disabled={!units || units <= 0n || tooMany} pendingLabel="Selling…">Sell to reserve</Submit>
    </ActionForm>
  );
}

export function CancelOrderButton({ action, orderId }: { action: FormAction; orderId: string }) {
  return (
    <ActionForm action={action} className="inline">
      <input type="hidden" name="orderId" value={orderId} />
      <Submit variant="quiet" size="sm" pendingLabel="Cancelling…">Cancel</Submit>
    </ActionForm>
  );
}
