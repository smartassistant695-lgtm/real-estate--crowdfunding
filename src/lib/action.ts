import "server-only";
import { isRedirectError } from "next/dist/client/components/redirect-error";
import { z } from "zod";
import type { ActionState } from "@/components/ui/form";
import { DomainError } from "@/lib/db";

/**
 * Wrap the body of a server action: validation and business-rule errors become messages for
 * the form; anything unexpected is logged and reported without leaking details.
 */
export async function guard(fn: () => Promise<ActionState | void>): Promise<ActionState> {
  try {
    return (await fn()) ?? { ok: true };
  } catch (e) {
    if (isRedirectError(e)) throw e;
    if (e && typeof e === "object" && "digest" in e && typeof e.digest === "string" && e.digest.startsWith("NEXT_")) throw e;
    if (e instanceof DomainError) return { ok: false, message: e.message, fieldErrors: e.field ? { [e.field]: e.message } : undefined };
    if (e instanceof z.ZodError) return zodFailure(e);
    console.error("[action] unexpected error", e);
    return { ok: false, message: "Something went wrong on our side. Nothing was changed. Please try again." };
  }
}

export function zodFailure(e: z.ZodError): ActionState {
  const fieldErrors: Record<string, string> = {};
  for (const issue of e.issues) {
    const key = issue.path.join(".");
    if (key && !fieldErrors[key]) fieldErrors[key] = issue.message;
  }
  return { ok: false, message: Object.keys(fieldErrors).length ? "Please check the highlighted fields." : (e.issues[0]?.message ?? "Invalid input."), fieldErrors };
}

/** FormData → plain object of strings (files and repeated keys are ignored). */
export function formObject(fd: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of fd.entries()) if (typeof v === "string") out[k] = v;
  return out;
}

export const idempotencyKeySchema = z.string().min(16).max(64).regex(/^[A-Za-z0-9-]+$/);

/** Zod helpers that turn form strings into integer cents / units / bps without floats. */
import { parseDollarsToCents, parsePercentToBps, parseSharesToUnits } from "@/lib/domain/money";

export const dollars = (msg = "Enter a dollar amount, like 26 or 26.50.") =>
  z.string().transform((s, ctx) => {
    const v = parseDollarsToCents(s);
    if (v === null) {
      ctx.addIssue({ code: "custom", message: msg });
      return z.NEVER;
    }
    return v;
  });

export const optionalDollars = () =>
  z.string().optional().transform((s, ctx) => {
    if (!s || s.trim() === "") return 0n;
    const v = parseDollarsToCents(s);
    if (v === null) {
      ctx.addIssue({ code: "custom", message: "Enter a dollar amount." });
      return z.NEVER;
    }
    return v;
  });

export const shares = (msg = "Enter a number of shares, like 2 or 2.5.") =>
  z.string().transform((s, ctx) => {
    const v = parseSharesToUnits(s);
    if (v === null) {
      ctx.addIssue({ code: "custom", message: msg });
      return z.NEVER;
    }
    return v;
  });

export const percent = (msg = "Enter a percentage, like 5 or 5.25.") =>
  z.string().transform((s, ctx) => {
    const v = parsePercentToBps(s);
    if (v === null) {
      ctx.addIssue({ code: "custom", message: msg });
      return z.NEVER;
    }
    return v;
  });
