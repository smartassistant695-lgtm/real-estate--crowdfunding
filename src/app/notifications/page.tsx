import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Empty, Page, PageHeader } from "@/components/ui/primitives";
import { prisma } from "@/lib/db";
import { fmtDateLong } from "@/lib/labels";
import { requireUser } from "@/lib/session";
import { markAllReadAction } from "./actions";

export const metadata: Metadata = { title: "Notifications" };

export default async function NotificationsPage() {
  const user = await requireUser();
  const items = await prisma.notification.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 100 });
  const unread = items.filter((n) => !n.readAt).length;
  const groups = new Map<string, typeof items>();
  for (const n of items) {
    const k = fmtDateLong(n.createdAt);
    groups.set(k, [...(groups.get(k) ?? []), n]);
  }
  return (
    <Page narrow className="pb-8">
      <PageHeader
        title="Notifications"
        lede={unread ? `${unread} unread. We also send these by email.` : "You are up to date. We also send these by email."}
        actions={unread ? <form action={markAllReadAction}><Button type="submit" variant="secondary">Mark all as read</Button></form> : undefined}
      />
      {items.length === 0 ? (
        <Empty title="Nothing here yet.">Purchases, dividends, trading windows, order fills and votes will show up here.</Empty>
      ) : (
        [...groups.entries()].map(([day, list]) => (
          <section key={day} className="pt-8">
            <h2 className="label mb-2">{day}</h2>
            <ul className="border-t border-ink">
              {list.map((n) => (
                <li key={n.id} className="grid grid-cols-[1rem_1fr] gap-2 border-b border-rule py-4">
                  <span className="pt-2">{!n.readAt ? <span className="block size-2 rounded-full bg-accent" aria-hidden /> : null}</span>
                  <div>
                    <p className={n.readAt ? "text-ink" : "font-medium text-ink"}>
                      {!n.readAt ? <span className="sr-only">Unread: </span> : null}
                      {n.href ? <Link href={n.href} className="underline-offset-4 hover:underline">{n.title}</Link> : n.title}
                    </p>
                    <p className="mt-1 text-sm text-ink-soft">{n.body}</p>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </Page>
  );
}
