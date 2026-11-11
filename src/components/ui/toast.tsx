"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

type Toast = { id: number; message: string };
const Ctx = createContext<(message: string) => void>(() => {});

export function useToast() {
  return useContext(Ctx);
}

/** Plain confirmation messages, bottom-left, announced politely to screen readers. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const next = useRef(1);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    setToasts((t) => t.filter((x) => x.id !== id));
    const timer = timers.current.get(id);
    if (timer) clearTimeout(timer);
    timers.current.delete(id);
  }, []);

  const push = useCallback(
    (message: string) => {
      const id = next.current++;
      setToasts((t) => [...t.slice(-2), { id, message }]);
      timers.current.set(id, setTimeout(() => dismiss(id), 6000));
    },
    [dismiss],
  );

  useEffect(() => {
    const map = timers.current;
    return () => map.forEach((t) => clearTimeout(t));
  }, []);

  return (
    <Ctx.Provider value={push}>
      {children}
      <div aria-live="polite" role="status" className="no-print fixed bottom-4 left-4 z-50 flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2">
        {toasts.map((t) => (
          <div key={t.id} className="flex animate-rise items-start gap-3 rounded-sm border border-ink bg-ink px-4 py-3 text-sm text-paper shadow-pop">
            <span className="flex-1">{t.message}</span>
            <button type="button" onClick={() => dismiss(t.id)} className="label text-paper! opacity-70 hover:opacity-100" aria-label="Dismiss message">
              Close
            </button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
