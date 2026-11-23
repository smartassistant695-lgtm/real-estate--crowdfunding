import Link from "next/link";
import { Bell } from "lucide-react";
import { BRAND } from "@/config/brand";
import { ButtonLink } from "@/components/ui/button";
import { prisma } from "@/lib/db";
import { formatCents } from "@/lib/domain/money";
import { currentUser } from "@/lib/session";
import { signOutAction } from "@/app/(auth)/actions";
import { MenuCloser } from "./menu-closer";
import { NavLink } from "./nav-link";
import { Wordmark } from "./wordmark";

export function DemoBanner() {
  return (
    <div className="no-print bg-ink text-paper">
      <p className="mx-auto max-w-page px-4 py-2 text-center text-xs font-medium uppercase tracking-caps md:px-8">
        {BRAND.demoBanner}
      </p>
    </div>
  );
}

const linkCls = "text-sm text-ink-soft hover:text-ink";

export async function SiteHeader() {
  const user = await currentUser();
  const unread = user ? await prisma.notification.count({ where: { userId: user.id, readAt: null } }) : 0;
  const isAdmin = user?.role === "ADMIN";
  const onboarded = !!user?.onboardingCompletedAt;

  const nav = isAdmin
    ? [
        { href: "/admin", label: "Admin" },
        { href: "/properties", label: "Properties" },
      ]
    : user
      ? onboarded
        ? [
            { href: "/properties", label: "Properties" },
            { href: "/portfolio", label: "Portfolio" },
            { href: "/orders", label: "Orders" },
            { href: "/governance", label: "Votes" },
          ]
        : [{ href: "/properties", label: "Properties" }]
      : [
          { href: "/properties", label: "Properties" },
          { href: "/how-it-works", label: "How it works" },
        ];

  return (
    <header className="no-print border-b border-rule bg-paper">
      <MenuCloser />
      <a href="#main" className="on-ink sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-10 focus:z-50 focus:bg-ink focus:px-3 focus:py-2 focus:text-sm focus:text-paper">
        Skip to content
      </a>
      <div className="mx-auto flex h-16 max-w-page items-center gap-4 px-4 md:gap-6 md:px-8">
        <Wordmark />
        <nav aria-label="Main" className="ml-4 hidden items-center gap-6 md:flex">
          {nav.map((n) => (
            <NavLink key={n.href} href={n.href} className={linkCls} exact={n.href === "/admin"}>
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-3 md:gap-4">
          {user ? (
            <>
              {!isAdmin && user.wallet ? (
                <Link href="/wallet" className="hidden text-sm text-ink-soft hover:text-ink sm:block" aria-label={`Wallet: ${formatCents(user.wallet.availableCents)} available`}>
                  <span className="label mr-2">Cash</span>
                  <span className="num text-ink">{formatCents(user.wallet.availableCents)}</span>
                </Link>
              ) : null}
              <Link href="/notifications" className="relative flex size-11 items-center justify-center text-ink-soft hover:text-ink" aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}>
                <Bell aria-hidden className="size-5" strokeWidth={1.5} />
                {unread ? <span aria-hidden className="absolute right-2 top-2 size-2 rounded-full bg-accent ring-2 ring-paper" /> : null}
              </Link>
              <details data-menu className="group relative">
                <summary className="flex h-11 cursor-pointer list-none items-center gap-2 text-sm text-ink-soft hover:text-ink [&::-webkit-details-marker]:hidden">
                  <span className="max-w-32 truncate">{user.name || "Account"}</span>
                  <svg aria-hidden viewBox="0 0 12 12" className="size-3 transition-transform group-open:rotate-180">
                    <path d="M2 4.5 6 8.5 10 4.5" fill="none" stroke="currentColor" strokeWidth="1.25" />
                  </svg>
                </summary>
                <div className="absolute right-0 z-40 mt-3 w-56 rounded-md border border-ink bg-paper py-2 shadow-pop">
                  <p className="truncate border-b border-rule px-4 pb-2 text-xs text-stone">{user.email}</p>
                  <ul className="py-1 text-sm">
                    {nav.map((n) => (
                      <li key={n.href} className="md:hidden">
                        <Link href={n.href} className="flex h-11 items-center px-4 hover:bg-paper-deep">{n.label}</Link>
                      </li>
                    ))}
                    {!isAdmin && onboarded ? (
                      <>
                        <li><Link href="/wallet" className="flex h-11 items-center px-4 hover:bg-paper-deep">Wallet</Link></li>
                        <li><Link href="/portfolio/statements" className="flex h-11 items-center px-4 hover:bg-paper-deep">Statements</Link></li>
                        <li><Link href="/portfolio/activity" className="flex h-11 items-center px-4 hover:bg-paper-deep">Activity</Link></li>
                      </>
                    ) : null}
                    {!isAdmin && !onboarded ? <li><Link href="/onboarding" className="flex h-11 items-center px-4 hover:bg-paper-deep">Finish setting up</Link></li> : null}
                  </ul>
                  <form action={signOutAction} className="border-t border-rule px-4 pt-2">
                    <button type="submit" className="h-11 text-sm text-ink-soft underline decoration-edge underline-offset-4 hover:text-ink">Sign out</button>
                  </form>
                </div>
              </details>
            </>
          ) : (
            <>
              {/* Below md the nav links move into a menu so the bar fits a 375px screen. */}
              <details data-menu className="group relative md:hidden">
                <summary className="flex h-11 cursor-pointer list-none items-center text-sm text-ink-soft hover:text-ink [&::-webkit-details-marker]:hidden">Menu</summary>
                <ul className="absolute right-0 z-40 mt-2 w-48 rounded-md border border-ink bg-paper py-2 text-sm shadow-pop">
                  {nav.map((n) => (
                    <li key={n.href}><Link href={n.href} className="flex h-11 items-center px-4 hover:bg-paper-deep">{n.label}</Link></li>
                  ))}
                </ul>
              </details>
              <Link href="/login" className={`${linkCls} flex h-11 items-center`}>Log in</Link>
              <ButtonLink href="/signup" size="md"><span className="sm:hidden">Sign up</span><span className="hidden sm:inline">Open an account</span></ButtonLink>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
