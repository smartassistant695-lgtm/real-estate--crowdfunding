"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ActionForm, Checkbox, Input, Submit, type FormAction } from "@/components/ui/form";
import { cn } from "@/lib/cn";

/** Polls the identity check until it is decided, then refreshes the page. */
export function KycPoller({ check }: { check: () => Promise<string> }) {
  const router = useRouter();
  useEffect(() => {
    let stop = false;
    const tick = async () => {
      if (stop) return;
      const status = await check().catch(() => "PENDING");
      if (stop) return;
      if (status === "PENDING") timer = setTimeout(tick, 1200);
      else router.refresh();
    };
    let timer = setTimeout(tick, 800);
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [check, router]);
  return (
    <div role="status" className="flex items-center gap-4 border-y border-rule py-6">
      <span aria-hidden className="size-2.5 animate-pulse rounded-full bg-accent" />
      <p className="text-sm text-ink-soft">Checking your details. This usually takes a few seconds; you can stay on this page.</p>
    </div>
  );
}

/** The disclosure must be scrolled to the end before the checkbox can be ticked. */
export function DisclosureGate({ action, children }: { action: FormAction; children: ReactNode }) {
  const [read, setRead] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const end = endRef.current;
    const root = boxRef.current;
    if (!end || !root) return;
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && setRead(true), { root, threshold: 1 });
    io.observe(end);
    return () => io.disconnect();
  }, []);

  return (
    <ActionForm action={action}>
      <div ref={boxRef} tabIndex={0} role="region" aria-label="Risk disclosure" className="max-h-[26rem] overflow-y-auto border border-rule bg-card px-5 py-5 md:px-8 md:py-7">
        {children}
        <div ref={endRef} className="h-px" />
      </div>
      <p className={cn("mt-3 text-xs", read ? "text-stone" : "text-notice")} aria-live="polite">
        {read ? "You have reached the end of the disclosure." : "Scroll to the end of the disclosure to continue."}
      </p>
      <Checkbox className="mt-5" name="accept" disabled={!read} required label="I have read this disclosure. I understand I can lose money, that my shares may be hard or impossible to sell, and that dividends are not guaranteed." />
      <Submit size="lg" className="mt-6" disabled={!read}>Accept and continue</Submit>
    </ActionForm>
  );
}

const PRESETS = ["26", "100", "500"];

export function FundForm({ action, cta = "Add funds" }: { action: FormAction; cta?: string }) {
  const [amount, setAmount] = useState("100");
  return (
    <ActionForm action={action} idempotent className="max-w-sm">
      <fieldset>
        <legend className="label mb-2">Amount</legend>
        <div className="mb-3 flex gap-2">
          {PRESETS.map((p) => (
            <button
              key={p}
              type="button"
              aria-pressed={amount === p}
              onClick={() => setAmount(p)}
              className={cn("num h-10 flex-1 rounded-sm border text-sm", amount === p ? "border-ink bg-ink text-paper" : "border-rule bg-card hover:border-stone")}
            >
              ${p}
            </button>
          ))}
        </div>
        <Input label="Or enter an amount" name="amount" inputMode="decimal" prefix="$" value={amount} onChange={(e) => setAmount(e.target.value)} required />
      </fieldset>
      <p className="mt-3 text-xs text-stone">Simulated transfer from “Demo Checking ••0000”. No real money moves.</p>
      <Submit size="lg" className="mt-5" pendingLabel="Adding…">{cta}</Submit>
    </ActionForm>
  );
}
