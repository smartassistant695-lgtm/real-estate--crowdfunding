"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

/**
 * Header menus are <details> disclosures (they work without JavaScript). With JavaScript, this
 * closes them after navigation, on Escape, and on a click outside — like any menu should.
 */
export function MenuCloser() {
  const pathname = usePathname();
  useEffect(() => {
    document.querySelectorAll<HTMLDetailsElement>("details[data-menu][open]").forEach((d) => d.removeAttribute("open"));
  }, [pathname]);
  useEffect(() => {
    const closeAll = (except?: Node | null) =>
      document.querySelectorAll<HTMLDetailsElement>("details[data-menu][open]").forEach((d) => {
        if (!except || !d.contains(except)) d.removeAttribute("open");
      });
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const open = document.querySelector<HTMLDetailsElement>("details[data-menu][open]");
      if (open) {
        open.removeAttribute("open");
        open.querySelector("summary")?.focus();
      }
    };
    const onClick = (e: MouseEvent) => {
      closeAll(e.target as Node);
      const link = (e.target as HTMLElement).closest("details[data-menu] a");
      if (link) link.closest("details")?.removeAttribute("open");
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("click", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("click", onClick);
    };
  }, []);
  return null;
}
