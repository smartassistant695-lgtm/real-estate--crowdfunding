import Link from "next/link";
import type { ReactNode } from "react";
import { InvestingDisclosure } from "@/components/site/footer";
import { Note, Page, PageHeader } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";

const LEGAL_PAGES = [
  { href: "/legal/terms", label: "Terms of Service" },
  { href: "/legal/privacy", label: "Privacy Policy" },
  { href: "/legal/risks", label: "Risk Disclosures" },
  { href: "/legal/offering-documents", label: "Offering documents" },
] as const;

export const DRAFT_NOTICE = "DRAFT – placeholder text, must be reviewed by a securities attorney before launch.";

/** Shared frame for the legal drafts: the draft banner, a side index of the other pages, the text. */
export function LegalPage({ current, title, lede, updated, children }: { current: (typeof LEGAL_PAGES)[number]["href"]; title: string; lede?: string; updated: string; children: ReactNode }) {
  return (
    <Page>
      <PageHeader title={title} lede={lede} />
      <Note tone="notice" className="mt-8 max-w-narrow">
        <p>{DRAFT_NOTICE}</p>
      </Note>
      <div className="grid grid-cols-1 gap-10 pt-10 lg:grid-cols-[minmax(0,14rem)_minmax(0,1fr)] lg:gap-20">
        <nav aria-label="Legal pages" className="lg:sticky lg:top-8 lg:self-start">
          <ul className="flex flex-wrap gap-x-6 gap-y-1 border-y border-rule py-2 text-sm lg:block lg:border-y-0 lg:border-t lg:border-ink lg:py-0">
            {LEGAL_PAGES.map((p) => (
              <li key={p.href} className="lg:border-b lg:border-rule">
                <Link
                  href={p.href}
                  aria-current={p.href === current ? "page" : undefined}
                  className={cn("flex h-11 items-center", p.href === current ? "font-medium text-ink" : "text-stone hover:text-ink")}
                >
                  {p.label}
                </Link>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-xs text-stone">Last edited {updated}. Not in force.</p>
        </nav>
        <div className="min-w-0">{children}</div>
      </div>
      <InvestingDisclosure />
    </Page>
  );
}

/** Plain-language legal prose at reading measure. */
export function LegalText({ children }: { children: ReactNode }) {
  return <div className="prose-plain max-w-prose text-ink-soft [&_h2]:text-ink">{children}</div>;
}
