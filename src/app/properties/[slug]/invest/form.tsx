"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ActionForm, Input, Submit, type FormAction } from "@/components/ui/form";
import { Facts, Note } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import { formatCents, formatUnits, parseDollarsToCents, parseSharesToUnits, primaryCost, unitsForAmount } from "@/lib/domain/money";

type Props = {
  action: FormAction;
  propertyId: string;
  propertyName: string;
  priceCents: string;
  minCents: string;
  availableCents: string;
  remainingUnits: string;
  annualRoomCents: string;
};

/**
 * Amount ↔ shares conversion happens here for feedback only, using the same pure functions the
 * server uses. The server ignores these figures and recomputes everything.
 */
export function InvestForm(props: Props) {
  const price = BigInt(props.priceCents), min = BigInt(props.minCents), available = BigInt(props.availableCents);
  const remaining = BigInt(props.remainingUnits), room = BigInt(props.annualRoomCents);
  const [mode, setMode] = useState<"dollars" | "shares">("dollars");
  const [amount, setAmount] = useState("100");
  const [sharesText, setSharesText] = useState("");
  const [review, setReview] = useState(false);

  const typedCents = mode === "dollars" ? parseDollarsToCents(amount) : null;
  const typedUnits = mode === "shares" ? parseSharesToUnits(sharesText) : null;
  let units = mode === "dollars" ? (typedCents !== null ? unitsForAmount(typedCents, price) : null) : typedUnits;
  const capped = units !== null && units > remaining;
  if (capped && mode === "dollars") units = remaining;
  const cost = units !== null ? primaryCost(units, price) : null;

  let problem: string | null = null;
  if (units === null || cost === null) problem = mode === "dollars" ? "Enter a dollar amount, like 26 or 100.50." : "Enter a number of shares, like 2 or 2.5.";
  else if (units <= 0n) problem = "That is too small to buy any shares.";
  else if (capped && mode === "shares") problem = `Only ${formatUnits(remaining)} shares are left in this offering.`;
  else if (cost < min && units !== remaining) problem = `The minimum investment is ${formatCents(min, { whole: true })}.`;
  else if (cost > available) problem = `You have ${formatCents(available)} available. Add funds to invest this much.`;
  else if (cost > room) problem = `This would take you over your annual investment limit. You can invest ${formatCents(room)} more this year.`;

  // Only complain about what the person has typed in the current mode.
  const typed = mode === "dollars" ? amount.trim() !== "" : sharesText.trim() !== "";
  const showProblem = typed && !!problem;
  const shareWord = (u: bigint) => (u === 1_000_000n ? "share" : "shares");
  // Keyboard users keep their place when the form swaps between entry and review.
  const reviewHeading = useRef<HTMLHeadingElement>(null);
  const reviewBtn = useRef<HTMLButtonElement>(null);
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return; }
    (review ? reviewHeading.current : reviewBtn.current)?.focus();
  }, [review]);

  return (
    <ActionForm action={props.action} idempotent>
      <input type="hidden" name="propertyId" value={props.propertyId} />
      <input type="hidden" name="mode" value={mode} />
      <div className={cn(review && "hidden")}>
        <div className="mb-5 inline-flex text-sm" role="group" aria-label="Enter as">
          {(["dollars", "shares"] as const).map((m) => (
            <button key={m} type="button" aria-pressed={mode === m} onClick={() => setMode(m)} className={cn("h-10 border border-ink px-4 first:rounded-l-sm last:-ml-px last:rounded-r-sm", mode === m ? "bg-ink text-paper" : "hover:bg-paper-deep")}>
              {m === "dollars" ? "Dollar amount" : "Number of shares"}
            </button>
          ))}
        </div>
        {mode === "dollars" ? (
          <Input label="Amount to invest" name="amount" inputMode="decimal" prefix="$" value={amount} onChange={(e) => setAmount(e.target.value)} hint={`Minimum ${formatCents(min, { whole: true })}. You have ${formatCents(available)} available.`} error={showProblem ? problem ?? undefined : undefined} className="max-w-form" />
        ) : (
          <Input label="Shares to buy" name="shares" inputMode="decimal" suffix="shares" value={sharesText} onChange={(e) => setSharesText(e.target.value)} hint={`${formatUnits(remaining)} shares left at ${formatCents(price)} each.`} error={showProblem ? problem ?? undefined : undefined} className="max-w-form" />
        )}
        <p className="num mt-5 font-serif text-xl" aria-live="polite">
          {units !== null && cost !== null && units > 0n ? (
            mode === "dollars" ? <>{formatUnits(units)} {shareWord(units)} <span className="text-md text-stone">for {formatCents(cost)}</span></> : <>{formatCents(cost)} <span className="text-md text-stone">for {formatUnits(units)} {shareWord(units)}</span></>
          ) : (
            <span className="text-stone">—</span>
          )}
        </p>
        {capped && mode === "dollars" && !problem ? <p className="mt-2 text-sm text-notice">Only {formatUnits(remaining)} shares are left, so this buys all of them for {formatCents(cost!)}.</p> : null}
        {!problem ? null : !showProblem ? <p className="mt-2 text-xs text-stone">{mode === "dollars" ? "Enter an amount to continue." : "Enter a number of shares to continue."}</p> : null}
        <Button ref={reviewBtn} size="lg" className="mt-6 w-full sm:w-auto" disabled={!!problem} onClick={() => setReview(true)}>Review order</Button>
      </div>

      {review && units !== null && cost !== null ? (
        <div className="max-w-form">
          <h2 ref={reviewHeading} tabIndex={-1} className="mb-3 text-lg focus:outline-none">Review your order</h2>
          <Facts rows={[
            { label: "Property", value: props.propertyName },
            { label: "Shares", value: formatUnits(units, 6) },
            { label: "Price per share", value: formatCents(price) },
            { label: "Fees", value: "$0.00" },
            { label: "Total", value: formatCents(cost), strong: true },
            { label: "Wallet balance after", value: formatCents(available - cost) },
          ]} />
          <Note className="mt-5">
            Your money is held in escrow until every share is sold. If the offering does not sell out by its deadline, you are refunded in full. Once it closes, you cannot sell these shares for six months, and after that only if another investor wants to buy them.
          </Note>
          <div className="mt-6 flex flex-wrap gap-3">
            <Submit size="lg" pendingLabel="Placing order…">Confirm purchase</Submit>
            <Button size="lg" variant="secondary" className="w-full sm:w-auto" onClick={() => setReview(false)}>Change</Button>
          </div>
        </div>
      ) : null}
    </ActionForm>
  );
}
