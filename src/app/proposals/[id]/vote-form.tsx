"use client";

import { useState } from "react";
import { ActionForm, Submit, type FormAction } from "@/components/ui/form";
import { cn } from "@/lib/cn";

const OPTIONS = [
  { value: "FOR", label: "For", hint: "Approve the proposal" },
  { value: "AGAINST", label: "Against", hint: "Reject it" },
  { value: "ABSTAIN", label: "Abstain", hint: "Counts toward quorum, not the result" },
] as const;

export function VoteForm({ action, proposalId, current }: { action: FormAction; proposalId: string; current: string | null }) {
  const [choice, setChoice] = useState<string | null>(current);
  return (
    <ActionForm action={action}>
      <input type="hidden" name="proposalId" value={proposalId} />
      <fieldset>
        <legend className="label mb-2">{current ? "Change your vote" : "Your vote"}</legend>
        <div className="grid gap-2">
          {OPTIONS.map((o) => (
            <label key={o.value} className={cn("flex min-h-11 cursor-pointer items-center gap-3 rounded-sm border px-4 py-2", choice === o.value ? "border-ink bg-paper-deep" : "border-edge hover:bg-paper-deep")}>
              <input type="radio" name="choice" value={o.value} checked={choice === o.value} onChange={() => setChoice(o.value)} className="size-4 accent-accent" />
              <span className="font-medium">{o.label}</span>
              <span className="ml-auto text-xs text-stone">{o.hint}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <Submit size="lg" className="mt-4 w-full" disabled={!choice || choice === current} pendingLabel="Recording…">
        {current ? "Change vote" : "Cast vote"}
      </Submit>
      {!choice ? <p className="mt-2 text-xs text-stone">Choose For, Against or Abstain.</p> : choice === current ? <p className="mt-2 text-xs text-stone">This is your current vote. Choose another option to change it.</p> : null}
    </ActionForm>
  );
}
