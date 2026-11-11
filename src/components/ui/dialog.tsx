"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Button } from "./button";

/**
 * Modal built on the native <dialog>: focus trapping, Escape to close and the inert
 * background come from the browser. `trigger` is the button label.
 */
export function Dialog({
  trigger,
  title,
  children,
  triggerVariant = "secondary",
  triggerSize = "md",
}: {
  trigger: ReactNode;
  title: string;
  children: ReactNode | ((close: () => void) => ReactNode);
  triggerVariant?: "primary" | "secondary" | "quiet" | "danger";
  triggerSize?: "sm" | "md" | "lg";
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const titleId = useId();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  const close = () => setOpen(false);

  return (
    <>
      <Button variant={triggerVariant} size={triggerSize} onClick={() => setOpen(true)} aria-haspopup="dialog">
        {trigger}
      </Button>
      <dialog
        ref={ref}
        aria-labelledby={titleId}
        onClose={close}
        onClick={(e) => {
          if (e.target === ref.current) close();
        }}
        className="w-[min(32rem,calc(100vw-2rem))] rounded-md border border-ink bg-paper p-0 text-ink shadow-pop"
      >
        <div className="flex items-baseline justify-between border-b border-rule px-6 py-4">
          <h2 id={titleId} className="text-lg">
            {title}
          </h2>
          <button type="button" onClick={close} className="label hover:text-ink">
            Close
          </button>
        </div>
        <div className="px-6 py-5">{open ? (typeof children === "function" ? children(close) : children) : null}</div>
      </dialog>
    </>
  );
}
