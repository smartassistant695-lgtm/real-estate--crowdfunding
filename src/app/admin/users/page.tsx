import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/form";
import { Badge, Empty, PageHeader, Table, Td, Th } from "@/components/ui/primitives";
import { prisma } from "@/lib/db";
import { formatCents } from "@/lib/domain/money";
import { fmtDate } from "@/lib/labels";
import { requireAdmin } from "@/lib/session";

export const metadata = { title: "Users" };
const KYC_TONE = { NOT_STARTED: "neutral", PENDING: "notice", APPROVED: "accent", REJECTED: "loss" } as const;
const PAGE = 50;

export default async function AdminUsers({ searchParams }: { searchParams: Promise<{ q?: string; kyc?: string; page?: string }> }) {
  await requireAdmin();
  const sp = await searchParams;
  const q = (sp.q ?? "").trim().slice(0, 80);
  const kyc = sp.kyc && Object.hasOwn(KYC_TONE, sp.kyc) ? (sp.kyc as keyof typeof KYC_TONE) : undefined;
  const page = Math.max(1, Math.min(10_000, Number.parseInt(sp.page ?? "1", 10) || 1));
  const where = { role: "INVESTOR" as const, ...(kyc ? { kycStatus: kyc } : {}), ...(q ? { OR: [{ email: { contains: q, mode: "insensitive" as const } }, { name: { contains: q, mode: "insensitive" as const } }] } : {}) };
  const [users, total] = await Promise.all([
    prisma.user.findMany({ where, include: { wallet: true, _count: { select: { holdings: { where: { shareUnits: { gt: 0n } } } } } }, orderBy: { createdAt: "desc" }, skip: (page - 1) * PAGE, take: PAGE }),
    prisma.user.count({ where }),
  ]);
  return (
    <>
      <PageHeader title="Users" lede={`${total} investor account${total === 1 ? "" : "s"}.`} />
      <form method="get" className="flex flex-wrap items-end gap-4 border-b border-rule py-5">
        <Input label="Search name or email" name="q" defaultValue={q} className="min-w-64" />
        <Select label="Identity check" name="kyc" defaultValue={kyc ?? ""}>
          <option value="">Any</option>
          {Object.keys(KYC_TONE).map((k) => <option key={k} value={k}>{k.replace("_", " ").toLowerCase()}</option>)}
        </Select>
        <Button type="submit" variant="secondary">Filter</Button>
      </form>
      {users.length === 0 ? <Empty title="No investors match." action={<Link className="link" href="/admin/users">Clear the search</Link>}>Search looks at names and email addresses.</Empty> : null}
      <Table caption="Investors" className={users.length === 0 ? "hidden" : "mt-4"}>
        <thead><tr><Th>Investor</Th><Th>Identity</Th><Th num>Cash</Th><Th num>Properties</Th><Th num>Annual limit</Th><Th>Joined</Th></tr></thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id} className="hover:bg-paper-deep">
              <Td className="py-1"><Link className="link" href={`/admin/users/${u.id}`}>{u.name || "(no name yet)"}</Link><span className="block text-xs text-stone">{u.email}</span></Td>
              <Td className="py-1"><Badge tone={KYC_TONE[u.kycStatus]}>{u.kycStatus.replace("_", " ").toLowerCase()}</Badge></Td>
              <Td num className="py-1">{formatCents((u.wallet?.availableCents ?? 0n) + (u.wallet?.heldCents ?? 0n))}</Td>
              <Td num className="py-1">{u._count.holdings}</Td>
              <Td num className="py-1">{formatCents(u.annualInvestmentLimitCents, { whole: true })}</Td>
              <Td className="num py-1 text-ink-soft">{fmtDate(u.createdAt)}</Td>
            </tr>
          ))}
        </tbody>
      </Table>
      {total > PAGE ? (
        <nav aria-label="Pages" className="mt-6 flex justify-between text-sm">
          {page > 1 ? <Link className="link" href={`/admin/users?q=${encodeURIComponent(q)}&kyc=${kyc ?? ""}&page=${page - 1}`}>Previous</Link> : <span />}
          <span className="num text-stone">Page {page} of {Math.ceil(total / PAGE)}</span>
          {page * PAGE < total ? <Link className="link" href={`/admin/users?q=${encodeURIComponent(q)}&kyc=${kyc ?? ""}&page=${page + 1}`}>Next</Link> : <span />}
        </nav>
      ) : null}
    </>
  );
}
