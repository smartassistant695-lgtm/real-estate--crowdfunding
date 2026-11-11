"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionState } from "@/components/ui/form";
import { dollars, formObject, guard, idempotencyKeySchema, zodFailure } from "@/lib/action";
import { DomainError } from "@/lib/db";
import { formatCents } from "@/lib/domain/money";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { withdraw } from "@/lib/services/wallet";
import { requireInvestor } from "@/lib/session";

export async function withdrawAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireInvestor();
  const parsed = z.object({ amount: dollars(), idempotencyKey: idempotencyKeySchema }).safeParse(formObject(fd));
  if (!parsed.success) return zodFailure(parsed.error);
  return guard(async () => {
    if (!(await rateLimit(`withdraw:${user.id}`, 10, 3600))) throw new DomainError("Too many withdrawals in the last hour. Please try again later.");
    await withdraw({ userId: user.id, amountCents: parsed.data.amount, idempotencyKey: parsed.data.idempotencyKey, ipAddress: await clientIp() });
    revalidatePath("/", "layout");
    return { ok: true, message: `${formatCents(parsed.data.amount)} withdrawn to your linked bank (simulated).` };
  });
}
