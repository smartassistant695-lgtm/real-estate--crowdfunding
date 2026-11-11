import "server-only";
import { BRAND } from "@/config/brand";
import { prisma, type Tx } from "@/lib/db";
import { providers } from "@/lib/providers";

export type NotificationType =
  | "PURCHASE_CONFIRMED"
  | "PROPERTY_FUNDED"
  | "OFFERING_REFUNDED"
  | "DIVIDEND_PAID"
  | "WINDOW_OPENED"
  | "WINDOW_CLOSED"
  | "ORDER_FILLED"
  | "ORDER_EXPIRED"
  | "PROPOSAL_OPENED"
  | "PROPOSAL_CLOSING"
  | "PROPOSAL_RESULT"
  | "SALE_COMPLETED"
  | "KYC_DECISION";

export type Notice = { userId: string; type: NotificationType; title: string; body: string; href?: string };

/**
 * Create in-app notifications inside the caller's transaction, and return a function that
 * sends the matching emails. Call that function AFTER the transaction commits, so nobody is
 * emailed about something that was rolled back.
 */
export async function notify(tx: Tx | typeof prisma, notices: readonly Notice[]): Promise<() => Promise<void>> {
  if (notices.length === 0) return async () => {};
  await tx.notification.createMany({
    data: notices.map((n) => ({ userId: n.userId, type: n.type, title: n.title, body: n.body, href: n.href ?? null })),
  });
  return async () => {
    try {
      const users = await prisma.user.findMany({ where: { id: { in: [...new Set(notices.map((n) => n.userId))] } }, select: { id: true, email: true } });
      const emails = new Map(users.map((u) => [u.id, u.email]));
      for (const n of notices) {
        const to = emails.get(n.userId);
        if (to) await providers.email.send({ to, subject: `${n.title} — ${BRAND.name}`, text: n.body });
      }
    } catch (e) {
      console.error("[email] failed to send", e);
    }
  };
}
