import Image from "next/image";
import Link from "next/link";
import type { PropertyStatus } from "@prisma/client";
import { Badge } from "@/components/ui/primitives";
import { formatBps, formatCents, ratioBps } from "@/lib/domain/money";
import { daysUntil, PROPERTY_STATUS, PROPERTY_TYPE } from "@/lib/labels";
import type { PropertyType } from "@prisma/client";

export type PropertyCardData = {
  slug: string;
  name: string;
  city: string;
  state: string;
  propertyType: PropertyType;
  bedrooms: number;
  bathrooms: number;
  status: PropertyStatus;
  photo: { url: string; alt: string } | null;
  projectedAnnualYieldBps: number;
  pricePerShareCents: bigint; // offering price while funding, otherwise appraised value per share
  priceLabel: string;
  soldUnits: bigint;
  totalUnits: bigint;
  fundingDeadline: Date | null;
};

function FundingBar({ bps, label }: { bps: number; label: string }) {
  return (
    <div role="img" aria-label={label} className="h-1 w-full bg-rule">
      <div className="h-full bg-accent" style={{ width: `${Math.min(100, bps / 100)}%` }} />
    </div>
  );
}

/** A listing, not a tile: photo, address line, three figures on a ruled row. */
export function PropertyCard({ p, layout = "grid", priority }: { p: PropertyCardData; layout?: "grid" | "list"; priority?: boolean }) {
  const status = PROPERTY_STATUS[p.status];
  const fundedBps = ratioBps(p.soldUnits, p.totalUnits);
  const funding = p.status === "FUNDING";
  const figures = [
    { label: "Projected yield", value: formatBps(p.projectedAnnualYieldBps, { decimals: 1 }) },
    { label: p.priceLabel, value: formatCents(p.pricePerShareCents) },
    funding ? { label: "Funded", value: formatBps(fundedBps, { decimals: 0 }) } : { label: "Type", value: p.propertyType === "SINGLE_FAMILY" ? "House" : PROPERTY_TYPE[p.propertyType].replace("Small multifamily", "4 units") },
  ];
  const list = layout === "list";
  return (
    <article className={list ? "group grid gap-5 border-b border-rule py-5 sm:grid-cols-[14rem_1fr]" : "group flex flex-col"}>
      <Link href={`/properties/${p.slug}`} tabIndex={-1} aria-hidden className={`relative block overflow-hidden bg-paper-deep ${list ? "aspect-[4/3]" : "aspect-[4/3]"}`}>
        {p.photo ? (
          <Image src={p.photo.url} alt="" fill sizes={list ? "224px" : "(min-width: 1024px) 400px, (min-width: 640px) 50vw, 100vw"} priority={priority} className="object-cover transition-transform duration-500 group-hover:scale-[1.02]" />
        ) : null}
      </Link>
      <div className={list ? "flex flex-col justify-between" : "flex flex-1 flex-col pt-4"}>
        <div>
          <div className="flex items-center justify-between gap-3">
            <p className="label">{p.city}, {p.state}</p>
            <Badge tone={status.tone}>{status.label}</Badge>
          </div>
          <h3 className="mt-1.5 text-lg leading-snug">
            <Link href={`/properties/${p.slug}`} className="underline-offset-4 hover:underline">{p.name}</Link>
          </h3>
          <p className="mt-0.5 text-sm text-ink-soft">
            {PROPERTY_TYPE[p.propertyType]} · {p.bedrooms} bed · {p.bathrooms} bath
          </p>
        </div>
        <div className="mt-4">
          <dl className="grid grid-cols-3 border-t border-ink">
            {figures.map((f) => (
              <div key={f.label} className="border-b border-rule py-2 pr-2">
                <dt className="label">{f.label}</dt>
                <dd className="num mt-0.5 text-md">{f.value}</dd>
              </div>
            ))}
          </dl>
          {funding ? (
            <div className="mt-3">
              <FundingBar bps={fundedBps} label={`${formatBps(fundedBps, { decimals: 0 })} funded`} />
              {p.fundingDeadline ? <p className="mt-1.5 text-xs text-stone">Offering closes {daysUntil(p.fundingDeadline)}</p> : null}
            </div>
          ) : null}
        </div>
      </div>
    </article>
  );
}
