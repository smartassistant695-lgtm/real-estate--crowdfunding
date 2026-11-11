"use client";

import { createContext, useActionState, useContext, useEffect, useId, useRef, type ComponentProps, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { cn } from "@/lib/cn";
import { Button } from "./button";
import { useToast } from "./toast";

/** What every server action returns. */
export type ActionState = { ok: boolean; message?: string; fieldErrors?: Record<string, string> } | null;
export type FormAction = (prev: ActionState, formData: FormData) => Promise<ActionState>;

const FormCtx = createContext<ActionState>(null);

/**
 * Wraps a server action: shows field errors, a form-level message, and a toast on success.
 * With `idempotent`, attaches a key that stays the same across retries of one submission
 * and changes only after the server confirms success.
 */
export function ActionForm({
  action,
  children,
  className,
  idempotent,
  toastOnSuccess = true,
  ...rest
}: {
  action: FormAction;
  children: ReactNode;
  className?: string;
  idempotent?: boolean;
  toastOnSuccess?: boolean;
} & Omit<ComponentProps<"form">, "action">) {
  const keyRef = useRef<string | null>(null);
  const toast = useToast();
  const [state, formAction] = useActionState<ActionState, FormData>(async (prev, formData) => {
    if (idempotent) {
      keyRef.current ??= crypto.randomUUID();
      formData.set("idempotencyKey", keyRef.current);
    }
    const result = await action(prev, formData);
    if (result?.ok) keyRef.current = null;
    return result;
  }, null);

  useEffect(() => {
    if (state?.ok && state.message && toastOnSuccess) toast(state.message);
  }, [state, toast, toastOnSuccess]);

  return (
    <FormCtx.Provider value={state}>
      <form action={formAction} className={className} noValidate={false} {...rest}>
        {children}
        {state && !state.ok && state.message ? (
          <p role="alert" className="mt-4 border-l-2 border-loss bg-loss-wash px-3 py-2 text-sm text-loss">
            {state.message}
          </p>
        ) : null}
        {state?.ok && state.message && !toastOnSuccess ? (
          <p role="status" className="mt-4 border-l-2 border-accent bg-accent-wash px-3 py-2 text-sm text-accent-deep">
            {state.message}
          </p>
        ) : null}
      </form>
    </FormCtx.Provider>
  );
}

const control =
  "block w-full rounded-sm border border-rule bg-card px-3 h-10 text-sm text-ink placeholder:text-stone " +
  "hover:border-stone focus:border-accent focus:outline-2 focus:outline-accent focus:outline-offset-0 " +
  "aria-[invalid=true]:border-loss disabled:bg-paper-deep disabled:text-stone";

type FieldShell = { label: string; hint?: ReactNode; error?: string; className?: string; prefix?: string; suffix?: string };

function useFieldError(name: string | undefined, explicit?: string): string | undefined {
  const state = useContext(FormCtx);
  return explicit ?? (name ? state?.fieldErrors?.[name] : undefined);
}

function Shell({
  id,
  label,
  hint,
  error,
  className,
  children,
}: FieldShell & { id: string; children: ReactNode }) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={id} className="label block text-ink-soft!">
        {label}
      </label>
      {children}
      {hint && !error ? (
        <p id={`${id}-hint`} className="text-xs text-stone">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-xs text-loss">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function Input({ label, hint, error, className, prefix, suffix, ...rest }: FieldShell & Omit<ComponentProps<"input">, "prefix">) {
  const auto = useId();
  const id = rest.id ?? auto;
  const err = useFieldError(rest.name, error);
  const describedBy = err ? `${id}-error` : hint ? `${id}-hint` : undefined;
  const input = (
    <input
      id={id}
      aria-invalid={err ? true : undefined}
      aria-describedby={describedBy}
      className={cn(control, "num", prefix && "pl-7", suffix && "pr-12")}
      {...rest}
    />
  );
  return (
    <Shell id={id} label={label} hint={hint} error={err} className={className}>
      {prefix || suffix ? (
        <div className="relative">
          {prefix ? <span aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-stone">{prefix}</span> : null}
          {input}
          {suffix ? <span aria-hidden className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-stone">{suffix}</span> : null}
        </div>
      ) : (
        input
      )}
    </Shell>
  );
}

export function Textarea({ label, hint, error, className, ...rest }: FieldShell & ComponentProps<"textarea">) {
  const auto = useId();
  const id = rest.id ?? auto;
  const err = useFieldError(rest.name, error);
  return (
    <Shell id={id} label={label} hint={hint} error={err} className={className}>
      <textarea
        id={id}
        aria-invalid={err ? true : undefined}
        aria-describedby={err ? `${id}-error` : hint ? `${id}-hint` : undefined}
        className={cn(control, "h-auto min-h-24 py-2 leading-relaxed")}
        {...rest}
      />
    </Shell>
  );
}

export function Select({ label, hint, error, className, children, ...rest }: FieldShell & ComponentProps<"select">) {
  const auto = useId();
  const id = rest.id ?? auto;
  const err = useFieldError(rest.name, error);
  return (
    <Shell id={id} label={label} hint={hint} error={err} className={className}>
      <div className="relative">
        <select
          id={id}
          aria-invalid={err ? true : undefined}
          aria-describedby={err ? `${id}-error` : hint ? `${id}-hint` : undefined}
          className={cn(control, "appearance-none pr-9")}
          {...rest}
        >
          {children}
        </select>
        <svg aria-hidden viewBox="0 0 12 12" className="pointer-events-none absolute right-3 top-1/2 size-3 -translate-y-1/2 text-stone">
          <path d="M2 4.5 6 8.5 10 4.5" fill="none" stroke="currentColor" strokeWidth="1.25" />
        </svg>
      </div>
    </Shell>
  );
}

export function Checkbox({ label, className, ...rest }: { label: ReactNode; className?: string } & ComponentProps<"input">) {
  const auto = useId();
  const id = rest.id ?? auto;
  return (
    <div className={cn("flex items-start gap-3", className)}>
      <input id={id} type="checkbox" className="mt-1 size-4 shrink-0 rounded-xs border border-stone accent-accent" {...rest} />
      <label htmlFor={id} className="text-sm text-ink">
        {label}
      </label>
    </div>
  );
}

/** Submit button that disables itself and says so while the action runs. */
export function Submit({
  children,
  pendingLabel = "Working…",
  ...rest
}: ComponentProps<typeof Button> & { pendingLabel?: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" aria-disabled={pending || rest.disabled} disabled={pending || rest.disabled} {...rest}>
      {pending ? pendingLabel : children}
    </Button>
  );
}
