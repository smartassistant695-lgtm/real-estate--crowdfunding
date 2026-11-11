import type { Metadata } from "next";
import Link from "next/link";
import type { Prisma, PropertyStatus, PropertyType } from "@prisma/client";
import { InvestingDisclosure } from "@/components/site/footer";
import { PropertyCard } from "@/components/site/property-card";
import { Button, ButtonLink } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/form";
import { Empty, Page, PageHeader } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import { prisma } from "@/lib/db";
import { parseDollarsToCents, parsePercentToBps, ratioBps } from "@/lib/domain/money";
import { PROPERTY_STATUS, PROPERTY_TYPE } from "@/lib/labels";
import { listPropertyCards } from "@/lib/queries";
import { currentUser } from "@/lib/session";
import { US_STATES } from "@/lib/us-states";

export const metadata: Metadata = { title: "Properties" };

const VISIBLE: PropertyStatus[] = ["FUNDING", "TRADING", "FUNDED", "EXIT_VOTE", "COMING_SOON", "SOLD"];
const SORTS = { newest: "Newest", yield: "Highest yield", funded: "Most funded", closing: "Closing soonest" } as const;

type SP = { city?: string; state?: string; type?: string; status?: string; minYield?: string; maxYield?: string; maxPrice?: string; sort?: string; view?: string };

export default async function PropertiesPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const user = await currentUser();
  const where: Prisma.PropertyWhereInput = { status: { in: VISIBLE } };
  if (sp.state && sp.state in US_STATES) where.state = sp.state;
  if (sp.city) where.city = { equals: sp.city.slice(0, 60), mode: "insensitive" };
  if (sp.type && sp.type in PROPERTY_TYPE) where.propertyType = sp.type as PropertyType;
  if (sp.status && VISIBLE.includes(sp.status as PropertyStatus)) where.status = sp.status as PropertyStatus;
  const minY = sp.minYield ? parsePercentToBps(sp.minYield) : null;
  const maxY = sp.maxYield ? parsePercentToBps(sp.maxYield) : null;
  if (minY !== null || maxY !== null) where.projectedAnnualYieldBps = { ...(minY !== null ? { gte: minY } : {}), ...(maxY !== null ? { lte: maxY } : {}) };

  const [all, places] = await Promise.all([
    listPropertyCards(where),
    prisma_places(),
  ]);
  const maxPrice = sp.maxPrice ? parseDollarsToCents(sp.maxPrice) : null;
  let items = maxPrice !== null ? all.filter((x) => x.card.pricePerShareCents <= maxPrice) : all;

  const sort = sp.sort && sp.sort in SORTS ? (sp.sort as keyof typeof SORTS) : "newest";
  const order = (s: PropertyStatus) => VISIBLE.indexOf(s);
  items = [...items].sort((a, b) => {
    if (sort === "yield") return b.card.projectedAnnualYieldBps - a.card.projectedAnnualYieldBps;
    if (sort === "funded") return ratioBps(b.card.soldUnits, b.card.totalUnits) - ratioBps(a.card.soldUnits, a.card.totalUnits);
    if (sort === "closing") {
      const t = (x: typeof a) => (x.card.status === "FUNDING" && x.card.fundingDeadline ? x.card.fundingDeadline.getTime() : Number.MAX_SAFE_INTEGER);
      return t(a) - t(b);
    }
    return order(a.card.status) - order(b.card.status) || b.row.createdAt.getTime() - a.row.createdAt.getTime();
  });

  const view = sp.view === "list" ? "list" : "grid";
  const qs = (patch: Record<string, string>) => {
    const p = new URLSearchParams(Object.entries({ ...sp, ...patch }).filter(([, v]) => v) as [string, string][]);
    return `/properties?${p.toString()}`;
  };
  const filtered = Object.entries(sp).some(([k, v]) => v && !["view", "sort"].includes(k));

  return (
    <Page className="pb-8">
      <PageHeader
        eyebrow={`${items.length} ${items.length === 1 ? "property" : "properties"}`}
        title="Properties"
        lede="Each home is owned by its own company. You buy shares of that company, from $26, and receive your share of the rent each month."
        actions={!user ? <ButtonLink href="/signup">Open an account to invest</ButtonLink> : undefined}
      />

      <form method="get" className="grid grid-cols-2 items-end gap-x-4 gap-y-4 border-b border-rule py-5 md:grid-cols-4 lg:grid-cols-8" aria-label="Filter properties">
        <input type="hidden" name="view" value={view} />
        <Select label="State" name="state" defaultValue={sp.state ?? ""}>
          <option value="">Any</option>
          {places.states.map((s) => <option key={s} value={s}>{US_STATES[s] ?? s}</option>)}
        </Select>
        <Select label="City" name="city" defaultValue={sp.city ?? ""}>
          <option value="">Any</option>
          {places.cities.map((c) => <option key={c} value={c}>{c}</option>)}
        </Select>
        <Select label="Type" name="type" defaultValue={sp.type ?? ""}>
          <option value="">Any</option>
          {Object.entries(PROPERTY_TYPE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
        <Select label="Status" name="status" defaultValue={sp.status ?? ""}>
          <option value="">Any</option>
          {VISIBLE.map((s) => <option key={s} value={s}>{PROPERTY_STATUS[s].label}</option>)}
        </Select>
        <Input label="Min yield" name="minYield" inputMode="decimal" suffix="%" defaultValue={sp.minYield ?? ""} placeholder="0" />
        <Input label="Max yield" name="maxYield" inputMode="decimal" suffix="%" defaultValue={sp.maxYield ?? ""} placeholder="10" />
        <Input label="Max share price" name="maxPrice" inputMode="decimal" prefix="$" defaultValue={sp.maxPrice ?? ""} placeholder="50" />
        <Select label="Sort" name="sort" defaultValue={sort}>
          {Object.entries(SORTS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
        <div className="col-span-2 flex items-center gap-4 md:col-span-4 lg:col-span-8">
          <Button type="submit" variant="secondary" size="sm">Apply</Button>
          {filtered ? <Link href={`/properties?view=${view}`} className="link text-sm">Clear filters</Link> : null}
          <div className="ml-auto flex text-xs" role="group" aria-label="Layout">
            {(["grid", "list"] as const).map((v) => (
              <Link key={v} href={qs({ view: v })} aria-current={view === v ? "true" : undefined} className={cn("border border-ink px-3 py-1.5 capitalize first:rounded-l-sm last:-ml-px last:rounded-r-sm", view === v ? "bg-ink text-paper" : "hover:bg-paper-deep")}>
                {v}
              </Link>
            ))}
          </div>
        </div>
      </form>

      {items.length === 0 ? (
        <Empty title="No properties match those filters." action={<ButtonLink href="/properties" variant="secondary">Show all properties</ButtonLink>}>
          There are only a handful of homes on the platform at a time. Try widening the yield range or clearing the state.
        </Empty>
      ) : view === "grid" ? (
        <div className="grid gap-x-8 gap-y-12 pt-8 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((x, i) => <PropertyCard key={x.card.slug} p={x.card} priority={i < 3} />)}
        </div>
      ) : (
        <div className="pt-3">{items.map((x, i) => <PropertyCard key={x.card.slug} p={x.card} layout="list" priority={i < 2} />)}</div>
      )}

      <p className="mt-10 max-w-prose text-xs text-stone">
        “Projected yield” is the manager’s estimate of a year of dividends as a share of the offering price, after expenses and the reserve allocation. It is an estimate, not a promise.
      </p>
      <InvestingDisclosure />
    </Page>
  );
}

async function prisma_places() {

  const rows = await prisma.property.findMany({ where: { status: { in: VISIBLE } }, select: { city: true, state: true }, distinct: ["city", "state"], orderBy: { city: "asc" } });
  return { cities: rows.map((r) => r.city), states: [...new Set(rows.map((r) => r.state))].sort() };
}
