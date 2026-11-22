import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/form";
import { PageHeader, Table, Td, Th } from "@/components/ui/primitives";
import { prisma } from "@/lib/db";
import { fmtDateTime } from "@/lib/labels";
import { requireAdmin } from "@/lib/session";

export const metadata = { title: "Audit log" };
const PAGE = 50;

export default async function AdminAudit({ searchParams }: { searchParams: Promise<{ action?: string; entity?: string; actor?: string; page?: string }> }) {
  await requireAdmin();
  const sp = await searchParams;
  const action = (sp.action ?? "").trim().slice(0, 60);
  const entity = (sp.entity ?? "").trim().slice(0, 60);
  const actor = (sp.actor ?? "").trim().slice(0, 120);
  const page = Math.max(1, Math.min(10_000, Number.parseInt(sp.page ?? "1", 10) || 1));
  const actorIds = actor ? (await prisma.user.findMany({ where: { email: { contains: actor, mode: "insensitive" } }, select: { id: true } })).map((u) => u.id) : null;
  const where = {
    ...(action ? { action: { startsWith: action } } : {}),
    ...(entity ? { OR: [{ entityType: { equals: entity, mode: "insensitive" as const } }, { entityId: entity }] } : {}),
    ...(actorIds ? { actorId: { in: actor === "system" ? [] : actorIds } } : {}),
  };
  const [rows, total] = await Promise.all([prisma.auditLog.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * PAGE, take: PAGE }), prisma.auditLog.count({ where })]);
  const actors = new Map((await prisma.user.findMany({ where: { id: { in: rows.map((r) => r.actorId).filter((x): x is string => !!x) } }, select: { id: true, email: true } })).map((u) => [u.id, u.email]));
  const qs = (p: number) => `/admin/audit?action=${encodeURIComponent(action)}&entity=${encodeURIComponent(entity)}&actor=${encodeURIComponent(actor)}&page=${p}`;
  return (
    <>
      <PageHeader title="Audit log" lede={`${total.toLocaleString("en-US")} entries. Append-only: the database rejects edits and deletions.`} />
      <form method="get" className="flex flex-wrap items-end gap-4 border-b border-rule py-5">
        <Input label="Action starts with" name="action" defaultValue={action} placeholder="dividend." />
        <Input label="Entity type or ID" name="entity" defaultValue={entity} placeholder="Order" />
        <Input label="Actor email" name="actor" defaultValue={actor} />
        <Button type="submit" variant="secondary">Filter</Button>
      </form>
      <Table caption="Audit entries" className="mt-4 text-xs">
        <thead><tr><Th>When</Th><Th>Actor</Th><Th>Action</Th><Th>Entity</Th><Th>Change</Th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="align-top hover:bg-paper-deep">
              <Td className="num py-1 whitespace-nowrap">{fmtDateTime(r.createdAt)}</Td>
              <Td className="py-1">{r.actorId ? actors.get(r.actorId) ?? r.actorId : <span className="text-stone">system</span>}{r.ipAddress ? <span className="block text-stone">{r.ipAddress}</span> : null}</Td>
              <Td className="py-1 font-medium">{r.action}</Td>
              <Td className="py-1">{r.entityType}<span className="block text-stone">{r.entityId}</span></Td>
              <Td className="py-1">
                <details>
                  <summary className="cursor-pointer text-stone underline decoration-edge underline-offset-4">Details</summary>
                  <pre className="mt-2 max-w-md overflow-x-auto whitespace-pre-wrap break-all bg-paper-deep p-2 text-xs">{JSON.stringify({ before: r.before, after: r.after }, null, 2)}</pre>
                </details>
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
      <nav aria-label="Pages" className="mt-6 flex justify-between text-sm">
        {page > 1 ? <Link className="link" href={qs(page - 1)}>Newer</Link> : <span />}
        <span className="num text-stone">Page {page} of {Math.max(1, Math.ceil(total / PAGE))}</span>
        {page * PAGE < total ? <Link className="link" href={qs(page + 1)}>Older</Link> : <span />}
      </nav>
    </>
  );
}
