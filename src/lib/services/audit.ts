import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma, toJson, type Tx } from "@/lib/db";

export type AuditInput = {
  actorId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
  ipAddress?: string | null;
};

/** Append one entry to the audit log. Pass the transaction so it commits or fails with the change it describes. */
export async function audit(tx: Tx | typeof prisma, e: AuditInput): Promise<void> {
  await tx.auditLog.create({
    data: {
      actorId: e.actorId,
      action: e.action,
      entityType: e.entityType,
      entityId: e.entityId,
      before: e.before === undefined ? undefined : (toJson(e.before) as Prisma.InputJsonValue),
      after: e.after === undefined ? undefined : (toJson(e.after) as Prisma.InputJsonValue),
      ipAddress: e.ipAddress ?? null,
    },
  });
}
