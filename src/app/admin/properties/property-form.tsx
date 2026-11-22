import type { Property } from "@prisma/client";
import { ActionForm, Input, Select, Submit, Textarea, type FormAction } from "@/components/ui/form";
import { SectionHeading } from "@/components/ui/primitives";
import { centsToInput } from "@/lib/domain/money";
import { PROPERTY_TYPE } from "@/lib/labels";

const pct = (bps: number) => (bps / 100).toFixed(2);

/** Admin form layout (DESIGN.md §6): fieldsets under section headings; primary action first. */
export function PropertyForm({ action, p, locked }: { action: FormAction; p?: Property; locked?: boolean }) {
  const v = (cents: bigint | undefined) => (cents === undefined ? "" : centsToInput(cents));
  return (
    <ActionForm action={action} className="space-y-12">
      {p ? <input type="hidden" name="id" value={p.id} /> : null}
      <fieldset className="space-y-5">
        <SectionHeading>Listing</SectionHeading>
        <div className="grid gap-5 md:grid-cols-2">
          <Input label="Name" name="name" defaultValue={p?.name} required />
          <Input label="Web address (slug)" name="slug" defaultValue={p?.slug} required hint="e.g. kenwood-bungalow-columbus" />
          <Input label="Street" name="street" defaultValue={p?.street} required className="md:col-span-2" />
          <Input label="City" name="city" defaultValue={p?.city} required />
          <div className="grid grid-cols-2 gap-4">
            <Input label="State" name="state" defaultValue={p?.state} required maxLength={2} />
            <Input label="ZIP" name="zip" defaultValue={p?.zip} required inputMode="numeric" />
          </div>
          <Select label="Type" name="propertyType" defaultValue={p?.propertyType ?? "SINGLE_FAMILY"}>
            {Object.entries(PROPERTY_TYPE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </Select>
          <div className="grid grid-cols-2 gap-4">
            <Input label="Bedrooms" name="bedrooms" inputMode="numeric" defaultValue={p?.bedrooms} required />
            <Input label="Bathrooms" name="bathrooms" inputMode="decimal" defaultValue={p?.bathrooms} required />
          </div>
          <Input label="Living area" name="squareFeet" inputMode="numeric" suffix="sq ft" defaultValue={p?.squareFeet} required />
          <Input label="Year built" name="yearBuilt" inputMode="numeric" defaultValue={p?.yearBuilt} required />
        </div>
        <Textarea label="Description" name="description" defaultValue={p?.description} required rows={4} />
        <Textarea label="Neighborhood" name="neighborhood" defaultValue={p?.neighborhood} rows={3} />
        <div className="grid gap-5 md:grid-cols-2">
          <Input label="Schools note" name="schoolsNote" defaultValue={p?.schoolsNote} />
          <Input label="Transit note" name="transitNote" defaultValue={p?.transitNote} />
        </div>
        <Textarea label="Risks specific to this home" name="risks" defaultValue={p?.risks.join("\n")} rows={5} hint="One per line. Plain words; these appear on the listing." required />
      </fieldset>

      <fieldset className="space-y-5">
        <SectionHeading aside={locked ? "Fixed once the offering opens" : "Raise ÷ share price must be a whole number of shares"}>Offering</SectionHeading>
        <div className="grid gap-5 md:grid-cols-2">
          <Input label="Purchase price" name="purchasePrice" prefix="$" inputMode="decimal" defaultValue={v(p?.purchasePriceCents)} required readOnly={locked} />
          <Input label="Closing costs" name="closingCosts" prefix="$" inputMode="decimal" defaultValue={v(p?.closingCostsCents)} required readOnly={locked} />
          <Input label="Repair reserve" name="reserveFund" prefix="$" inputMode="decimal" defaultValue={v(p?.reserveFundCents)} required readOnly={locked} />
          <Input label="Offering price per share" name="offeringPrice" prefix="$" inputMode="decimal" defaultValue={v(p?.offeringPricePerShareCents)} required readOnly={locked} />
          <Input label="Projected monthly rent" name="projectedRent" prefix="$" inputMode="decimal" defaultValue={v(p?.projectedMonthlyRentCents)} required />
          <Input label="Projected annual yield" name="projectedYield" suffix="%" inputMode="decimal" defaultValue={p ? pct(p.projectedAnnualYieldBps) : ""} required hint="After expenses and the reserve allocation, on the offering price." />
          <Input label="Funding deadline" name="fundingDeadline" type="date" defaultValue={p?.fundingDeadline?.toISOString().slice(0, 10)} />
          <Input label="Planned exit year" name="plannedExitYear" inputMode="numeric" defaultValue={p?.plannedExitYear ?? new Date().getUTCFullYear() + 5} required />
          <Input label="Property manager" name="propertyManagerName" defaultValue={p?.propertyManagerName} required className="md:col-span-2" />
        </div>
      </fieldset>
      <Submit size="lg" className="w-full sm:w-auto" pendingLabel="Saving…">{p ? "Save property" : "Create property"}</Submit>
    </ActionForm>
  );
}
