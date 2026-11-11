"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { ActionState } from "@/components/ui/form";
import { dollars, formObject, guard, idempotencyKeySchema, shares, zodFailure } from "@/lib/action";
import { DomainError } from "@/lib/db";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { buyPrimary } from "@/lib/services/purchase";
import { requireInvestor } from "@/lib/session";

const schema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("dollars"), amount: dollars(), propertyId: z.string().min(1).max(40), idempotencyKey: idempotencyKeySchema }),
  z.object({ mode: z.literal("shares"), shares: shares(), propertyId: z.string().min(1).max(40), idempotencyKey: idempotencyKeySchema }),
]);

export async function buyAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireInvestor();
  const parsed = schema.safeParse(formObject(fd));
  if (!parsed.success) return zodFailure(parsed.error);
  const d = parsed.data;
  const result = await guard(async () => {
    if (!(await rateLimit(`order:${user.id}`, 30, 60))) throw new DomainError("You are placing orders too quickly. Wait a minute and try again.");
    // Price, share count and cost are all recomputed on the server from the property's own record.
    await buyPrimary({
      userId: user.id,
      propertyId: d.propertyId,
      ...(d.mode === "dollars" ? { amountCents: d.amount } : { units: d.shares }),
      idempotencyKey: d.idempotencyKey,
      ipAddress: await clientIp(),
    });
    revalidatePath("/", "layout");
  });
  if (!result?.ok) return result;
  redirect("/portfolio?bought=1");
}
