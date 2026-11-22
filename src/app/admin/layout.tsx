import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { requireAdmin } from "@/lib/session";

export const metadata: Metadata = { title: { default: "Admin", template: "%s — Admin" } };

const NAV = [
  ["/admin", "Overview"],
  ["/admin/properties", "Properties"],
  ["/admin/financials", "Financials & dividends"],
  ["/admin/trading", "Trading windows"],
  ["/admin/reserves", "Liquidity reserves"],
  ["/admin/proposals", "Proposals"],
  ["/admin/users", "Users"],
  ["/admin/settings", "Settings"],
  ["/admin/audit", "Audit log"],
] as const;

/** Role is checked here AND inside every admin page and action: the layout alone is not a security boundary. */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  await requireAdmin();
  return (
    <div className="mx-auto grid w-full max-w-page gap-8 px-4 pb-8 md:grid-cols-[13rem_1fr] md:px-8">
      <nav aria-label="Admin" className="border-b border-rule pt-6 md:border-b-0 md:border-r md:pr-6 md:pt-14">
        <p className="label mb-3">Admin</p>
        <ul className="-mx-2 flex gap-1 overflow-x-auto pb-4 text-sm md:mx-0 md:flex-col md:pb-0">
          {NAV.map(([href, label]) => (
            <li key={href}><Link href={href} className="flex h-11 items-center whitespace-nowrap px-2 text-ink-soft hover:bg-paper-deep hover:text-ink md:h-9">{label}</Link></li>
          ))}
        </ul>
      </nav>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
