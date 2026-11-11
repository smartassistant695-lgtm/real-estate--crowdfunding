import Link from "next/link";
import { BRAND } from "@/config/brand";
import { cn } from "@/lib/cn";

/**
 * The wordmark is typeset, not drawn: the brand name in the display serif under a single
 * heavy rule — a lintel, the beam that spans a doorway. No icon.
 */
export function Wordmark({ className, size = "md", href = "/" }: { className?: string; size?: "md" | "lg"; href?: string | null }) {
  const mark = (
    <span className={cn("inline-flex flex-col leading-none", className)}>
      <span aria-hidden className={cn("mb-[3px] block bg-current", size === "lg" ? "h-[3px]" : "h-[2px]")} />
      <span className={cn("font-serif tracking-[-0.02em]", size === "lg" ? "text-2xl" : "text-lg")} style={{ fontVariationSettings: '"opsz" 144, "SOFT" 0' }}>
        {BRAND.name}
      </span>
    </span>
  );
  if (!href) return mark;
  return (
    <Link href={href} aria-label={`${BRAND.name} home`} className="text-ink hover:text-accent">
      {mark}
    </Link>
  );
}
