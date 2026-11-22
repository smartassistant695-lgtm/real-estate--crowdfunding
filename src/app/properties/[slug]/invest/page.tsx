import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { InvestingDisclosure } from "@/components/site/footer";
import { ButtonLink } from "@/components/ui/button";
import { Empty, Facts, Page } from "@/components/ui/primitives";
import { prisma } from "@/lib/db";
import { formatBps, formatCents, formatUnits, ratioBps } from "@/lib/domain/money";
import { daysUntil, fmtDay } from "@/lib/labels";
import { investedThisYear } from "@/lib/services/wallet";
import { requireInvestor } from "@/lib/session";
import { getSettings } from "@/lib/settings";
import { buyAction } from "./actions";
import { InvestForm } from "./form";

export const metadata: Metadata = { title: "Invest" };

export default async function InvestPage({ params }: { params: Promise<{ slug: string }> }) {
  const user = await requireInvestor();
  const { slug } = await params;
  const p = await prisma.property.findUnique({ where: { slug } });
  if (!p) notFound();
  const settings = await getSettings();
  const invested = await investedThisYear(prisma, user.id);
  const room = user.annualInvestmentLimitCents > invested ? user.annualInvestmentLimitCents - invested : 0n;
  const remaining = p.totalUnits - p.soldUnits;
  const open = p.status === "FUNDING" && remaining > 0n && (!p.fundingDeadline || p.fundingDeadline.getTime() > Date.now());

  return (
    <Page className="pb-8">
      <header className="border-b border-ink pb-6 pt-10 md:pt-14">
        <nav aria-label="Breadcrumb" className="mb-4 text-sm text-stone"><Link href={`/properties/${p.slug}`} className="hover:text-ink">{p.name}</Link> <span aria-hidden>/</span> Invest</nav>
        <h1 className="text-2xl md:text-3xl">Buy shares of {p.name}</h1>
        <p className="mt-2 text-ink-soft">{p.street}, {p.city}, {p.state}</p>
      </header>
      {!open ? (
        <Empty title="This offering is not open." action={<ButtonLink href="/properties" variant="secondary">See other properties</ButtonLink>}>
          {p.status === "TRADING" ? "Every share has been sold. You can buy from other investors during a trading window." : "Shares of this home cannot be bought right now."}
        </Empty>
      ) : (
        <div className="grid gap-12 pt-10 lg:grid-cols-[1fr_22rem]">
          <InvestForm
            action={buyAction}
            propertyId={p.id}
            propertyName={p.name}
            priceCents={p.offeringPricePerShareCents.toString()}
            minCents={settings.minInvestmentCents.toString()}
            availableCents={(user.wallet?.availableCents ?? 0n).toString()}
            remainingUnits={remaining.toString()}
            annualRoomCents={room.toString()}
          />
          <aside className="lg:border-l lg:border-rule lg:pl-8">
            <p className="label mb-2">This offering</p>
            <Facts rows={[
              { label: "Price per share", value: formatCents(p.offeringPricePerShareCents) },
              { label: "Funded so far", value: formatBps(ratioBps(p.soldUnits, p.totalUnits), { decimals: 0 }) },
              { label: "Shares left", value: formatUnits(remaining, 2) },
              ...(p.fundingDeadline ? [{ label: "Closes", value: `${fmtDay(p.fundingDeadline)} (${daysUntil(p.fundingDeadline)})` }] : []),
              { label: "Projected annual yield", value: formatBps(p.projectedAnnualYieldBps, { decimals: 1 }) },
              { label: "Your wallet", value: formatCents(user.wallet?.availableCents ?? 0n) },
              { label: "Left of your annual limit", value: formatCents(room) },
            ]} />
            <p className="mt-4 text-sm"><Link href="/wallet" className="link">Add funds to your wallet</Link></p>
          </aside>
        </div>
      )}
      <InvestingDisclosure />
    </Page>
  );
}
