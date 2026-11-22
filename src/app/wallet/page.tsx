import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm, Input, Submit } from "@/components/ui/form";
import { Empty, Money, Note, Page, PageHeader, SectionHeading, Stat, Table, Td, Th } from "@/components/ui/primitives";
import { prisma } from "@/lib/db";
import { formatCents } from "@/lib/domain/money";
import { fmtDate, LEDGER_TYPE } from "@/lib/labels";
import { investedThisYear } from "@/lib/services/wallet";
import { requireInvestor } from "@/lib/session";
import { fundWalletAction } from "../onboarding/actions";
import { FundForm } from "../onboarding/client";
import { withdrawAction } from "./actions";

export const metadata: Metadata = { title: "Wallet" };

export default async function WalletPage() {
  const user = await requireInvestor();
  const wallet = user.wallet!;
  const [entries, invested] = await Promise.all([
    prisma.ledgerEntry.findMany({ where: { userId: user.id, account: "USER_WALLET", type: { in: ["DEPOSIT", "WITHDRAWAL", "DIVIDEND", "REFUND", "ADJUSTMENT", "EXIT_PROCEEDS"] } }, orderBy: { seq: "desc" }, take: 15 }),
    investedThisYear(prisma, user.id),
  ]);
  return (
    <Page className="pb-8">
      <PageHeader title="Wallet" lede="Cash waiting to be invested. Dividends and sale proceeds arrive here." />
      <dl className="grid grid-cols-2 gap-8 border-b border-rule py-8 md:grid-cols-4">
        <Stat label="Available" value={formatCents(wallet.availableCents)} size="lg" className="col-span-2" />
        <Stat label="Held for open buy orders" value={formatCents(wallet.heldCents)} note="Released if an order is cancelled or expires" />
        <Stat label="Invested this year" value={formatCents(invested)} note={`Annual limit ${formatCents(user.annualInvestmentLimitCents, { whole: true })}`} />
      </dl>
      <div className="grid gap-12 pt-10 md:grid-cols-2">
        <section>
          <SectionHeading>Add funds</SectionHeading>
          <FundForm action={fundWalletAction} />
        </section>
        <section>
          <SectionHeading>Withdraw</SectionHeading>
          <ActionForm action={withdrawAction} idempotent className="max-w-form">
            <Input label="Amount" name="amount" inputMode="decimal" prefix="$" required hint={`Up to ${formatCents(wallet.availableCents)}`} />
            <p className="mt-3 text-xs text-stone">Simulated transfer to “Demo Checking ••0000”.</p>
            <Submit variant="secondary" size="lg" className="mt-5" pendingLabel="Withdrawing…">Withdraw</Submit>
          </ActionForm>
          <Note className="mt-6">Only cash can be withdrawn. To turn shares into cash you need to sell them during a trading window.</Note>
        </section>
      </div>
      <section className="pt-14">
        <SectionHeading aside={<Link href="/portfolio/activity" className="link">All activity</Link>}>Recent cash movements</SectionHeading>
        {entries.length === 0 ? (
          <Empty title="No cash has moved yet.">Add funds above to make your first investment.</Empty>
        ) : (
          <Table caption="Recent cash movements">
            <thead><tr><Th>Date</Th><Th>Type</Th><Th>Details</Th><Th num>Amount</Th></tr></thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id}>
                  <Td className="num text-ink-soft whitespace-nowrap">{fmtDate(e.createdAt)}</Td>
                  <Td>{LEDGER_TYPE[e.type]}</Td>
                  <Td className="text-ink-soft">{e.memo}</Td>
                  <Td num><Money cents={e.amountCents} sign /></Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </section>
    </Page>
  );
}
