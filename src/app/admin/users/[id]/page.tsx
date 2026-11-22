import Link from "next/link";
import { notFound } from "next/navigation";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { ActionForm, Input, Select, Submit } from "@/components/ui/form";
import { Facts, Money, PageHeader, SectionHeading, Table, Td, Th } from "@/components/ui/primitives";
import { prisma } from "@/lib/db";
import { centsToInput, formatCents, formatUnits } from "@/lib/domain/money";
import { fmtDate, fmtDateTime, LEDGER_TYPE } from "@/lib/labels";
import { investedThisYear } from "@/lib/services/wallet";
import { requireAdmin } from "@/lib/session";
import { US_STATES } from "@/lib/us-states";
import { adjustWalletAction, setKycAction, setLimitAction } from "../../actions";

export const metadata = { title: "User" };

export default async function AdminUser({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const u = await prisma.user.findUnique({ where: { id }, include: { wallet: true, holdings: { where: { shareUnits: { gt: 0n } }, include: { property: { select: { name: true, slug: true } } } } } });
  if (!u || u.role !== "INVESTOR") notFound();
  const [invested, ledger] = await Promise.all([
    investedThisYear(prisma, u.id),
    prisma.ledgerEntry.findMany({ where: { userId: u.id, account: "USER_WALLET" }, orderBy: { seq: "desc" }, take: 20 }),
  ]);
  return (
    <>
      <PageHeader back={{ href: "/admin/users", label: "Users" }} title={u.name || u.email} lede={u.email} />
      <div className="grid grid-cols-[minmax(0,1fr)] gap-12 pt-10 xl:grid-cols-[22rem_1fr]">
        <div className="space-y-12">
          <section aria-labelledby="profile">
            <SectionHeading id="profile">Account</SectionHeading>
            <Facts rows={[
              { label: "State", value: u.state ? US_STATES[u.state] ?? u.state : "—" },
              { label: "Date of birth", value: u.dateOfBirth ? fmtDate(u.dateOfBirth) : "—" },
              { label: "Identity check", value: u.kycStatus.replace("_", " ").toLowerCase() },
              { label: "Risk disclosure", value: u.riskDisclosureAcceptedAt ? fmtDateTime(u.riskDisclosureAcceptedAt) : "not accepted" },
              { label: "Trading disclosure", value: u.tradingDisclosureAcceptedAt ? fmtDateTime(u.tradingDisclosureAcceptedAt) : "not accepted" },
              { label: "Cash available", value: formatCents(u.wallet?.availableCents ?? 0n) },
              { label: "Held for orders", value: formatCents(u.wallet?.heldCents ?? 0n) },
              { label: "Invested this year", value: formatCents(invested) },
            ]} />
            {u.kycStatus !== "APPROVED" ? <div className="mt-4"><ConfirmAction action={setKycAction} fields={{ id: u.id, status: "APPROVED" }} trigger="Approve identity manually" triggerVariant="secondary" title="Approve this identity check by hand?" body="Use only after reviewing documents outside the automated check. This is logged." confirm="Approve" /></div> : null}
          </section>
          <section aria-labelledby="limit">
            <SectionHeading id="limit">Annual investment limit</SectionHeading>
            <ActionForm action={setLimitAction} className="space-y-4">
              <input type="hidden" name="id" value={u.id} />
              <Input label="Limit per calendar year" name="limit" prefix="$" inputMode="decimal" defaultValue={centsToInput(u.annualInvestmentLimitCents)} required />
              <Submit variant="secondary" pendingLabel="Saving…">Save limit</Submit>
            </ActionForm>
          </section>
          <section aria-labelledby="adjust">
            <SectionHeading id="adjust">Adjust wallet</SectionHeading>
            <ActionForm action={adjustWalletAction} idempotent className="space-y-4">
              <input type="hidden" name="id" value={u.id} />
              <Select label="Direction" name="direction" defaultValue="credit"><option value="credit">Credit (add)</option><option value="debit">Debit (remove)</option></Select>
              <Input label="Amount" name="amount" prefix="$" inputMode="decimal" required />
              <Input label="Reason" name="memo" required hint="Shown to the investor and kept in the audit log." />
              <Submit variant="secondary" pendingLabel="Adjusting…">Record adjustment</Submit>
            </ActionForm>
          </section>
        </div>
        <div className="space-y-12">
          <section aria-labelledby="holdings">
            <SectionHeading id="holdings">Holdings</SectionHeading>
            {u.holdings.length ? (
              <Table caption="Holdings"><thead><tr><Th>Property</Th><Th num>Shares</Th><Th num>In open sell orders</Th><Th num>Cost basis</Th></tr></thead>
                <tbody>{u.holdings.map((h) => <tr key={h.id}><Td className="py-1"><Link className="link" href={`/properties/${h.property.slug}`}>{h.property.name}</Link></Td><Td num className="py-1">{formatUnits(h.shareUnits)}</Td><Td num className="py-1">{formatUnits(h.reservedUnits)}</Td><Td num className="py-1">{formatCents(h.costBasisCents)}</Td></tr>)}</tbody>
              </Table>
            ) : <p className="text-sm text-stone">No shares held.</p>}
          </section>
          <section aria-labelledby="ledger">
            <SectionHeading id="ledger" aside="Last 20 entries">Ledger</SectionHeading>
            <Table caption="Ledger"><thead><tr><Th>When</Th><Th>Type</Th><Th>Memo</Th><Th num>Amount</Th></tr></thead>
              <tbody>{ledger.map((e) => <tr key={e.id}><Td className="num py-1 whitespace-nowrap text-ink-soft">{fmtDate(e.createdAt)}</Td><Td className="py-1">{LEDGER_TYPE[e.type]}</Td><Td className="py-1 text-ink-soft">{e.memo}</Td><Td num className="py-1"><Money cents={e.amountCents} sign /></Td></tr>)}</tbody>
            </Table>
          </section>
        </div>
      </div>
    </>
  );
}
