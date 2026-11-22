"use server";

import type { ActionState } from "@/components/ui/form";
import { parseDollarsToCents } from "@/lib/domain/money";

/**
 * A no-op action for the /design review page. It stores nothing; it only shows how field
 * errors, the form-level Problem note and the success toast look.
 */
export async function demoAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const amount = String(formData.get("amount") ?? "");
  const cents = parseDollarsToCents(amount);
  if (cents === null || cents < 2600n) {
    return { ok: false, message: "Check the amount and try again.", fieldErrors: { amount: "Enter at least $26.00, for example 26 or 120.50." } };
  }
  return { ok: true, message: "Saved. (Demo form: nothing was stored.)" };
}
