"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionState } from "@/components/ui/form";
import { formObject, guard } from "@/lib/action";
import { DomainError } from "@/lib/db";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { castVote } from "@/lib/services/governance";
import { requireInvestor } from "@/lib/session";

const LABEL = { FOR: "for", AGAINST: "against", ABSTAIN: "to abstain" } as const;

export async function castVoteAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireInvestor();
  const parsed = z.object({ proposalId: z.string().min(1).max(40), choice: z.enum(["FOR", "AGAINST", "ABSTAIN"], "Choose how you want to vote.") }).safeParse(formObject(fd));
  if (!parsed.success) return { ok: false, message: "Choose For, Against or Abstain." };
  return guard(async () => {
    if (!(await rateLimit(`vote:${user.id}`, 30, 600))) throw new DomainError("Too many changes in a short time. Wait a few minutes.");
    await castVote({ userId: user.id, proposalId: parsed.data.proposalId, choice: parsed.data.choice, ipAddress: await clientIp() });
    revalidatePath(`/proposals/${parsed.data.proposalId}`);
    revalidatePath("/governance");
    return { ok: true, message: `Your vote ${LABEL[parsed.data.choice]} is recorded. You can change it until voting closes.` };
  });
}
