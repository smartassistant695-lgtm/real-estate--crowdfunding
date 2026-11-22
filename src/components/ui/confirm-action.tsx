"use client";

import type { ReactNode } from "react";
import { Dialog } from "./dialog";
import { ActionForm, Submit, type FormAction } from "./form";

/**
 * Irreversible or money-moving admin actions go through this: the dialog title states the action
 * and the figure, the confirm button is a verb, and cancelling is always one click away.
 */
export function ConfirmAction({
  action,
  fields,
  trigger,
  title,
  body,
  confirm,
  danger,
  idempotent,
  triggerVariant = "primary",
}: {
  action: FormAction;
  fields: Record<string, string>;
  trigger: string;
  title: string;
  body?: ReactNode;
  confirm: string;
  danger?: boolean;
  idempotent?: boolean;
  triggerVariant?: "primary" | "secondary" | "quiet" | "danger";
}) {
  return (
    <Dialog trigger={trigger} title={title} triggerVariant={triggerVariant} triggerSize="md">
      {(close) => (
        <ActionForm action={action} idempotent={idempotent} toastOnSuccess={false}>
          {Object.entries(fields).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
          {body ? <div className="mb-5 text-sm text-ink-soft">{body}</div> : null}
          <div className="flex flex-wrap gap-3">
            <Submit variant={danger ? "danger" : "primary"} pendingLabel="Working…">{confirm}</Submit>
            <button type="button" onClick={close} className="h-10 px-2 text-sm text-ink-soft underline decoration-edge underline-offset-4 hover:text-ink">Cancel</button>
          </div>
        </ActionForm>
      )}
    </Dialog>
  );
}
