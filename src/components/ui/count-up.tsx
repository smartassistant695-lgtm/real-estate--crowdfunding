"use client";

import { useEffect, useState } from "react";

/**
 * Counts a dollar figure up once on first paint. The final text is rendered on the server, so
 * nothing depends on the animation; it is skipped entirely under prefers-reduced-motion.
 */
export function CountUpDollars({ cents, className }: { cents: string; className?: string }) {
  const target = Number(cents);
  const [shown, setShown] = useState(target);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || target <= 0) return;
    const t0 = performance.now(), dur = 700;
    let raf = 0;
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / dur);
      setShown(Math.round(target * (1 - Math.pow(1 - k, 3))));
      if (k < 1) raf = requestAnimationFrame(step);
    };
    setShown(0);
    raf = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(raf);
      setShown(target);
    };
  }, [target]);
  const neg = shown < 0, abs = Math.abs(shown);
  const text = `${neg ? "−" : ""}$${Math.floor(abs / 100).toLocaleString("en-US")}.${String(abs % 100).padStart(2, "0")}`;
  return <span className={className}>{text}</span>;
}
