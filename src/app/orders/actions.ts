"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionState } from "@/components/ui/form";
import { dollars, formObject, guard, idempotencyKeySchema, shares, zodFailure } from "@/lib/action";
import { DomainError, prisma } from "@/lib/db";
import { formatCents, formatUnits } from "@/lib/domain/money";
import { tradingVenue } from "@/lib/providers";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { audit } from "@/lib/services/audit";
import { sellToReserve } from "@/lib/services/trading";
import { requireInvestor } from "@/lib/session";

const orderSchema = z.object({
  propertyId: z.string().min(1).max(40),
  side: z.enum(["BUY", "SELL"]),
  price: dollars("Enter a price per share, like 10.25."),
  shares: shares(),
  idempotencyKey: idempotencyKeySchema,
});

export async function placeOrderAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireInvestor();
  const parsed = orderSchema.safeParse(formObject(fd));
  if (!parsed.success) return zodFailure(parsed.error);
  const d = parsed.data;
  return guard(async () => {
    if (!(await rateLimit(`order:${user.id}`, 30, 60))) throw new DomainError("You are placing orders too quickly. Wait a minute and try again.");
    const venue = await tradingVenue();
    const r = await venue.submitOrder({ userId: user.id, propertyId: d.propertyId, side: d.side, limitPriceCents: d.price, units: d.shares, idempotencyKey: d.idempotencyKey });
    revalidatePath("/", "layout");
    const verb = d.side === "BUY" ? "buy" : "sell";
    if (r.status === "FILLED") return { ok: true, message: `Filled: your order to ${verb} ${formatUnits(d.shares)} shares matched in full.` };
    if (r.filledUnits > 0n) return { ok: true, message: `Partly filled: ${formatUnits(r.filledUnits)} of ${formatUnits(d.shares)} shares matched. The rest stays open until the window closes.` };
    return { ok: true, message: `Order placed. It stays open at ${formatCents(d.price)} until it matches or the window closes.` };
  });
}

export async function cancelOrderAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireInvestor();
  const parsed = z.object({ orderId: z.string().min(1).max(40) }).safeParse(formObject(fd));
  if (!parsed.success) return zodFailure(parsed.error);
  return guard(async () => {
    const venue = await tradingVenue();
    await venue.cancelOrder({ userId: user.id, orderId: parsed.data.orderId });
    revalidatePath("/", "layout");
    return { ok: true, message: "Order cancelled. Anything set aside for it has been released." };
  });
}

export async function sellToReserveAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireInvestor();
  const parsed = z.object({ propertyId: z.string().min(1).max(40), shares: shares(), idempotencyKey: idempotencyKeySchema }).safeParse(formObject(fd));
  if (!parsed.success) return zodFailure(parsed.error);
  return guard(async () => {
    if (!(await rateLimit(`order:${user.id}`, 30, 60))) throw new DomainError("You are placing orders too quickly. Wait a minute and try again.");
    const r = await sellToReserve({ userId: user.id, propertyId: parsed.data.propertyId, units: parsed.data.shares, idempotencyKey: parsed.data.idempotencyKey, ipAddress: await clientIp() });
    revalidatePath("/", "layout");
    return { ok: true, message: `Sold ${formatUnits(parsed.data.shares)} shares to the reserve for ${formatCents(r.proceedsCents)}.` };
  });
}

export async function acceptTradingDisclosureAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireInvestor();
  return guard(async () => {
    if (fd.get("accept") !== "on") throw new DomainError("Tick the box to confirm you have read how trading works.", "accept");
    if (!user.tradingDisclosureAcceptedAt) {
      const at = new Date();
      await prisma.user.update({ where: { id: user.id }, data: { tradingDisclosureAcceptedAt: at } });
      await audit(prisma, { actorId: user.id, action: "disclosure.trading_accepted", entityType: "User", entityId: user.id, after: { acceptedAt: at, version: "demo-1" }, ipAddress: await clientIp() });
    }
    revalidatePath("/", "layout");
  });
}
