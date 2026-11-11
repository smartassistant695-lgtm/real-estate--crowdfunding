import "server-only";
import { prisma, type Tx } from "@/lib/db";

/** The single settings row. Created with the Section 3 defaults on first read. */
export async function getSettings(tx: Tx | typeof prisma = prisma) {
  const existing = await tx.platformSettings.findUnique({ where: { id: 1 } });
  if (existing) return existing;
  return tx.platformSettings.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
}
export type Settings = Awaited<ReturnType<typeof getSettings>>;
