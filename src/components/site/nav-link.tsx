"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/** A navigation link that marks the current section (aria-current + a 2px ink underline). */
export function NavLink({ href, children, className, activeClassName, exact }: { href: string; children: ReactNode; className?: string; activeClassName?: string; exact?: boolean }) {
  const pathname = usePathname() ?? "";
  const active = exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
  return (
    <Link href={href} aria-current={active ? "page" : undefined} className={cn(className, active && (activeClassName ?? "text-ink underline decoration-ink decoration-2 underline-offset-[6px]"))}>
      {children}
    </Link>
  );
}
