import type { Metadata } from "next";
import type { ReactNode } from "react";
import { MonthlyBars, TimeSeriesChart } from "@/components/charts/charts";
import { ChartFrame } from "@/components/charts/frame";
import { DemoActionForm, ToastDemo } from "@/components/marketing/design-demos";
import { PropertyCard } from "@/components/site/property-card";
import { Wordmark } from "@/components/site/wordmark";
import { Button, ButtonLink } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Checkbox, Input, Select, Textarea } from "@/components/ui/form";
import { Badge, Empty, Facts, Meter, Money, Note, Page, PageHeader, SectionHeading, Stat, Stepper, Table, Tabs, Td, Th } from "@/components/ui/primitives";
import { listPropertyCards } from "@/lib/queries";
import { demoAction } from "./actions";

export const metadata: Metadata = {
  title: "Design system",
  robots: { index: false, follow: false, nocache: true },
};

export const dynamic = "force-dynamic";

/* Values copied from DESIGN.md §2, the binding source. Class names are literal so Tailwind sees them. */
const COLOURS = [
  { token: "paper", hex: "#F6F3EE", role: "Page background", contrast: "—", cls: "bg-paper" },
  { token: "paper-deep", hex: "#ECE7DE", role: "Sunk areas, active row, table header fill", contrast: "—", cls: "bg-paper-deep" },
  { token: "card", hex: "#FBFAF7", role: "Input fills, raised surfaces", contrast: "—", cls: "bg-card" },
  { token: "white", hex: "#FFFFFF", role: "The printed statement sheet only", contrast: "—", cls: "bg-white" },
  { token: "ink", hex: "#1C1B19", role: "Text, heavy rules, dark buttons", contrast: "15.5:1 on paper", cls: "bg-ink" },
  { token: "ink-soft", hex: "#45423D", role: "Secondary text", contrast: "9.0:1 on paper", cls: "bg-ink-soft" },
  { token: "stone", hex: "#6A655C", role: "Labels, captions, tertiary text", contrast: "5.2:1 paper · 4.7:1 paper-deep · 5.5:1 card", cls: "bg-stone" },
  { token: "rule", hex: "#D8D2C6", role: "Hairline dividers (decorative only)", contrast: "not for controls", cls: "bg-rule" },
  { token: "edge", hex: "#878074", role: "Borders that identify a control", contrast: "3.8:1 card · 3.5:1 paper · 3.2:1 paper-deep", cls: "bg-edge" },
  { token: "accent", hex: "#1F4D3A", role: "Primary buttons, chart series, focus ring, active state", contrast: "8.7:1 on paper", cls: "bg-accent" },
  { token: "accent-deep", hex: "#163A2B", role: "Primary hover, text on accent-wash", contrast: "10.2:1 on accent-wash", cls: "bg-accent-deep" },
  { token: "accent-wash", hex: "#E2EAE4", role: "Success notes, bid depth bars", contrast: "—", cls: "bg-accent-wash" },
  { token: "on-accent", hex: "#F6F3EE", role: "Text on accent", contrast: "8.7:1", cls: "bg-on-accent" },
  { token: "gain", hex: "#2C6548", role: "Gains only", contrast: "6.2:1 on paper", cls: "bg-gain" },
  { token: "loss", hex: "#9A3B26", role: "Losses and errors only", contrast: "6.3:1 paper · 5.6:1 loss-wash", cls: "bg-loss" },
  { token: "loss-wash", hex: "#F4E4DE", role: "Error note background", contrast: "—", cls: "bg-loss-wash" },
  { token: "notice", hex: "#7A5A12", role: "Drafts, caution", contrast: "5.8:1 paper · 5.3:1 notice-wash", cls: "bg-notice" },
  { token: "notice-wash", hex: "#F3EAD0", role: "Caution note background", contrast: "—", cls: "bg-notice-wash" },
];

const TYPE = [
  { token: "text-xs", spec: "12 / 16 sans", use: "Labels, captions, hints, badges", el: <p className="text-xs">Offering closes in 9 days</p> },
  { token: "text-sm", spec: "14 / 20 sans", use: "UI text, tables, form controls", el: <p className="text-sm">Orders can be placed during the first seven days of each month.</p> },
  { token: "text-base", spec: "16 / 24 sans", use: "Body copy", el: <p className="text-base">Rent is paid out monthly, after expenses.</p> },
  { token: "text-md", spec: "20 / 28 serif or sans", use: "Small figures, list titles, leads", el: <p className="font-serif text-md">Kenwood Bungalow</p> },
  { token: "text-lg", spec: "24 / 32 serif", use: "Section headings (h2)", el: <p className="font-serif text-lg tracking-figure">Monthly income</p> },
  { token: "text-xl", spec: "30 / 36 serif", use: "Stats, sub-page titles", el: <p className="num font-serif text-xl tracking-figure">$1,285.20</p> },
  { token: "text-2xl", spec: "36 / 40 serif", use: "Page titles on mobile", el: <p className="font-serif text-2xl tracking-figure">Your portfolio</p> },
  { token: "text-3xl", spec: "48 / 52 serif", use: "Page titles, headline figures", el: <p className="num font-serif text-3xl tracking-figure">$4,213.50</p> },
  { token: "text-4xl", spec: "64 / 64 serif", use: "Property masthead, account value", el: <p className="font-serif text-3xl tracking-figure sm:text-4xl">Holmes Street</p> },
  { token: "text-5xl", spec: "88 / 88 serif", use: "Marketing headline only", el: <p className="font-serif text-3xl tracking-figure sm:text-5xl">From $26.</p> },
];

const SPACING = [
  { n: 1, cls: "w-1" }, { n: 2, cls: "w-2" }, { n: 3, cls: "w-3" }, { n: 4, cls: "w-4" }, { n: 5, cls: "w-5" }, { n: 6, cls: "w-6" },
  { n: 8, cls: "w-8" }, { n: 10, cls: "w-10" }, { n: 12, cls: "w-12" }, { n: 14, cls: "w-14" }, { n: 16, cls: "w-16" }, { n: 20, cls: "w-20" }, { n: 24, cls: "w-24" },
];

const SECTIONS = [
  ["colour", "Colour"], ["type", "Type scale"], ["spacing", "Spacing and shape"], ["buttons", "Buttons"], ["forms", "Form controls"],
  ["data", "Table, Stat, Facts"], ["status", "Badges and tabs"], ["notes", "Notes and empty states"], ["meters", "Meters and stepper"],
  ["overlays", "Dialog and toast"], ["charts", "Charts"], ["card", "Property card and wordmark"],
] as const;

function Block({ id, title, aside, children }: { id: string; title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="scroll-mt-8 pt-14">
      <SectionHeading id={id} aside={aside}>{title}</SectionHeading>
      {children}
    </section>
  );
}

const sampleSeries = [
  { t: Date.UTC(2025, 10, 14), a: 9.83, b: null },
  { t: Date.UTC(2026, 1, 11), a: 9.77, b: 9.9 },
  { t: Date.UTC(2026, 4, 10), a: 10.03, b: 10.12 },
  { t: Date.UTC(2026, 7, 6), a: 10.24, b: 10.3 },
  { t: Date.UTC(2026, 10, 2), a: 10.4, b: 10.56 },
];
const sampleBars = [
  { label: "Jul", v: 0.0501 }, { label: "Aug", v: 0.0267 }, { label: "Sep", v: 0.0475 }, { label: "Oct", v: 0.0491 },
];

export default async function DesignPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const sp = await searchParams;
  const tab = sp.tab === "documents" || sp.tab === "votes" ? sp.tab : "overview";
  const cards = await listPropertyCards({ status: { in: ["FUNDING", "TRADING"] } }, [{ sequence: "asc" }]);
  const card = cards.find((c) => c.card.status === "FUNDING")?.card ?? cards[0]?.card ?? null;

  return (
    <Page>
      <PageHeader title="Design system" lede="Every token and component in one place, for review. The rules behind them are in DESIGN.md." />
      <Note tone="notice" className="mt-8 max-w-narrow" title="Internal review page">
        <p>Not part of the product and not indexed by search engines. Sample figures here are illustrative; the property card uses real seeded data.</p>
      </Note>

      <div className="grid grid-cols-1 gap-10 lg:grid-cols-[12rem_minmax(0,1fr)] lg:gap-16">
        <nav aria-label="Design system sections" className="pt-14 lg:sticky lg:top-0 lg:max-h-dvh lg:self-start lg:overflow-y-auto">
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm lg:block lg:space-y-1">
            {SECTIONS.map(([id, label]) => (
              <li key={id}><a href={`#${id}`} className="flex h-11 items-center text-ink-soft hover:text-ink lg:h-8">{label}</a></li>
            ))}
          </ul>
        </nav>

        <div className="min-w-0">
          <Block id="colour" title="Colour" aside="DESIGN.md §2">
            <Table caption="Colour tokens">
              <thead><tr><Th>Swatch</Th><Th>Token</Th><Th>Hex</Th><Th>Role</Th><Th>Contrast</Th></tr></thead>
              <tbody>
                {COLOURS.map((c) => (
                  <tr key={c.token}>
                    <Td><span aria-hidden className={`block h-8 w-12 rounded-xs border border-rule ${c.cls}`} /></Td>
                    <Td className="font-medium">{c.token}</Td>
                    <Td className="num text-ink-soft">{c.hex}</Td>
                    <Td className="text-ink-soft">{c.role}</Td>
                    <Td className="num text-ink-soft">{c.contrast}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <p className="mt-4 max-w-prose text-sm text-ink-soft">
              Gain and loss colour only a change in value, and always with a sign: <Money cents={4120n} gainLoss /> and <Money cents={-1875n} gainLoss />. Money that simply moves stays ink: <Money cents={2600n} />.
            </p>
          </Block>

          <Block id="type" title="Type scale" aside="Fraunces and IBM Plex Sans">
            <ul className="border-t border-ink">
              {TYPE.map((t) => (
                <li key={t.token} className="grid gap-2 border-b border-rule py-4 md:grid-cols-[16rem_minmax(0,1fr)] md:items-baseline md:gap-8">
                  <div>
                    <p className="text-sm font-medium">{t.token}</p>
                    <p className="text-xs text-stone">{t.spec} · {t.use}</p>
                  </div>
                  <div className="min-w-0 break-words">{t.el}</div>
                </li>
              ))}
            </ul>
            <div className="mt-6 grid gap-6 sm:grid-cols-2">
              <div>
                <p className="label">Label: data labels only</p>
                <p className="mt-2 text-sm text-ink-soft">12px, weight 500, uppercase, tracking-caps, stone. Never a kicker above a heading.</p>
              </div>
              <div>
                <p className="num font-serif text-xl tracking-figure">1,234.5678 · $10.56</p>
                <p className="mt-2 text-sm text-ink-soft">.num: tabular, lining figures for every financial number.</p>
              </div>
            </div>
          </Block>

          <Block id="spacing" title="Spacing and shape" aside="4px grid">
            <div className="grid grid-cols-[minmax(0,1fr)] gap-10 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <ul className="space-y-2">
                {SPACING.map((s) => (
                  <li key={s.n} className="grid grid-cols-[4rem_1fr] items-center gap-4 text-xs">
                    <span className="num text-stone">{s.n} · {s.n * 4}px</span>
                    <span aria-hidden className={`block h-3 bg-accent ${s.cls}`} />
                  </li>
                ))}
              </ul>
              <div className="space-y-6">
                <div className="flex flex-wrap gap-6">
                  {[
                    { name: "rounded-xs", px: "2px", cls: "rounded-xs" },
                    { name: "rounded-sm", px: "4px", cls: "rounded-sm" },
                    { name: "rounded-md", px: "6px", cls: "rounded-md" },
                  ].map((r) => (
                    <div key={r.name} className="text-xs">
                      <span aria-hidden className={`block size-16 border border-ink bg-card ${r.cls}`} />
                      <p className="mt-2 font-medium">{r.name}</p>
                      <p className="num text-stone">{r.px}</p>
                    </div>
                  ))}
                  <div className="text-xs">
                    <span aria-hidden className="flex size-16 items-center justify-center"><span className="size-2 rounded-full bg-accent" /></span>
                    <p className="mt-2 font-medium">rounded-full</p>
                    <p className="text-stone">Unread dot only</p>
                  </div>
                </div>
                <div className="rounded-md border border-ink bg-paper px-4 py-3 text-sm shadow-pop">shadow-pop: menus, dialogs, toasts, chart tooltips. Nothing else.</div>
                <Facts
                  rows={[
                    { label: "Widths", value: "form 384 · auth 448 · prose 640 · narrow 768 · page 1248" },
                    { label: "Page gutter", value: "16 mobile · 32 desktop" },
                    { label: "Section gap", value: "56px" },
                    { label: "Form field gap", value: "20px" },
                  ]}
                />
              </div>
            </div>
          </Block>

          <Block id="buttons" title="Buttons">
            <Table caption="Button variants and sizes">
              <thead><tr><Th>Variant</Th><Th>Small · 32px</Th><Th>Medium · 40px</Th><Th>Large · 48px</Th><Th>Disabled</Th></tr></thead>
              <tbody>
                {(["primary", "secondary", "quiet", "danger"] as const).map((v) => (
                  <tr key={v}>
                    <Td className="align-middle font-medium">{v}</Td>
                    <Td className="align-middle"><Button variant={v} size="sm">Place order</Button></Td>
                    <Td className="align-middle"><Button variant={v}>Place order</Button></Td>
                    <Td className="align-middle"><Button variant={v} size="lg">Place order</Button></Td>
                    <Td className="align-middle"><Button variant={v} disabled>Place order</Button></Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <div className="mt-6 flex flex-wrap items-center gap-4">
              <Button disabled aria-describedby="disabled-why">Sell shares</Button>
              <p id="disabled-why" className="text-sm text-stone">Disabled always says why: trading opens December 1.</p>
            </div>
            <div className="mt-4"><ButtonLink href="/properties" variant="secondary">ButtonLink to properties</ButtonLink></div>
          </Block>

          <Block id="forms" title="Form controls">
            <div className="grid grid-cols-[minmax(0,1fr)] gap-12 md:grid-cols-2">
              <div className="max-w-form space-y-5">
                <Input label="Amount" name="d-amount" prefix="$" defaultValue="250.00" hint="From $26 to $10,000 a year." />
                <Input label="Shares" name="d-shares" suffix="shares" defaultValue="0.5" error="You can sell up to 2.4 shares." />
                <Select label="State" name="d-state" defaultValue="OH">
                  <option value="OH">Ohio</option>
                  <option value="MO">Missouri</option>
                </Select>
                <Textarea label="Notes" name="d-notes" defaultValue="New tenants signed a two-year lease." />
                <Input label="Disabled" name="d-disabled" disabled defaultValue="Locked while the window is closed" />
                <Checkbox label="I have read the risk disclosure." name="d-check" />
              </div>
              <div>
                <p className="mb-4 text-sm text-ink-soft">ActionForm with a server action that returns a field error and a Problem note. Submitting $26 or more shows the success toast.</p>
                <DemoActionForm action={demoAction} />
              </div>
            </div>
          </Block>

          <Block id="data" title="Table, Stat, Facts">
            <Table caption="Recent dividends (sample)">
              <thead><tr><Th>Month</Th><Th>Property</Th><Th num>Shares</Th><Th num>Per share</Th><Th num>Paid</Th></tr></thead>
              <tbody>
                <tr><Td>Oct 2026</Td><Td>Kenwood Bungalow</Td><Td num>2.6</Td><Td num>$0.0491</Td><Td num>$0.12</Td></tr>
                <tr><Td>Sep 2026</Td><Td>Kenwood Bungalow</Td><Td num>2.6</Td><Td num>$0.0475</Td><Td num>$0.12</Td></tr>
                <tr className="font-semibold"><Td className="border-ink">Total</Td><Td className="border-ink" /><Td num className="border-ink" /><Td num className="border-ink" /><Td num className="border-ink">$0.24</Td></tr>
              </tbody>
            </Table>
            <dl className="mt-8 grid grid-cols-2 gap-6 border-t border-ink pt-4 md:grid-cols-4">
              <Stat label="Account value" value="$1,412.08" size="md" />
              <Stat label="Change" value="+$41.20" tone="gain" note="Since you joined" />
              <Stat label="Change" value="−$18.75" tone="loss" note="This month" />
              <Stat label="Dividends" value="$12.40" size="sm" />
            </dl>
            <Facts
              className="mt-8 max-w-form"
              rows={[
                { label: "Shares", value: "2.5" },
                { label: "Price a share", value: "$10.40" },
                { label: "Fee", value: "$0.00" },
                { label: "Total", value: "$26.00", strong: true },
              ]}
            />
          </Block>

          <Block id="status" title="Badges and tabs">
            <div className="flex flex-wrap gap-3">
              <Badge>Neutral</Badge>
              <Badge tone="accent">Trading</Badge>
              <Badge tone="notice">Exit vote</Badge>
              <Badge tone="loss">Cancelled</Badge>
              <Badge tone="solid">Open for investment</Badge>
            </div>
            <Tabs
              className="mt-8"
              label="Sample tabs"
              current={tab}
              tabs={[
                { key: "overview", label: "Overview", href: "/design?tab=overview#status" },
                { key: "documents", label: "Documents", href: "/design?tab=documents#status", count: 6 },
                { key: "votes", label: "Votes", href: "/design?tab=votes#status", count: 2 },
              ]}
            />
            <p className="mt-3 text-sm text-ink-soft">Tabs are links with URLs. Current tab: {tab}.</p>
          </Block>

          <Block id="notes" title="Notes and empty states">
            <div className="grid gap-6">
              <Note title="What happens next">Your order stays open until the window closes on December 8. If it does not fill, it expires and the cash is released.</Note>
              <Note tone="notice" title="Holding period">These shares can be sold from February 14, 2027.</Note>
              <Note tone="loss" title="Payment failed">The transfer was returned by your bank. No money moved.</Note>
              <Empty title="You have no open orders." action={<ButtonLink href="/properties" variant="secondary" size="sm">Browse properties</ButtonLink>}>
                Orders can be placed during the first seven days of each month.
              </Empty>
            </div>
          </Block>

          <Block id="meters" title="Meters and stepper">
            <div className="grid gap-10">
              <div>
                <p className="flex justify-between text-sm"><span>Funding</span><span className="num">64% of 15,000 shares</span></p>
                <Meter className="mt-2" label="64% funded" max={100} segments={[{ value: 64, tone: "accent", label: "Funded" }]} />
              </div>
              <div>
                <p className="flex justify-between text-sm"><span>Turnout</span><span className="num">22% of shares</span></p>
                <Meter className="mt-2" label="Turnout 22%, quorum 30%" max={100} segments={[{ value: 22, tone: "accent", label: "Voted" }]} thresholds={[{ at: 30, label: "Quorum 30%" }]} />
              </div>
              <div>
                <p className="flex justify-between text-sm"><span>Tally</span><span className="num">For 58% · Against 34% · Abstain 8%</span></p>
                <Meter
                  className="mt-2"
                  label="For 58%, against 34%, abstain 8%"
                  max={100}
                  segments={[{ value: 58, tone: "accent", label: "For" }, { value: 34, tone: "ink", label: "Against" }, { value: 8, tone: "stone", label: "Abstain" }]}
                  thresholds={[{ at: 50, label: "Half" }]}
                />
              </div>
              <Stepper steps={["Profile", "Identity", "Risks", "Fund", "Tour"]} current={2} label="Onboarding progress" />
            </div>
          </Block>

          <Block id="overlays" title="Dialog and toast">
            <div className="flex flex-wrap gap-4">
              <Dialog trigger="Open a confirm dialog" title="Pay $4,213.50 to 21 investors?">
                <p className="text-sm text-ink-soft">The October dividend for Kenwood Bungalow will be paid from its operating account. This cannot be undone. (Demo: nothing happens.)</p>
              </Dialog>
              <ToastDemo />
            </div>
          </Block>

          <Block id="charts" title="Charts">
            <div className="grid grid-cols-[minmax(0,1fr)] gap-12 xl:grid-cols-2">
              <ChartFrame
                title="Value per share"
                summary="Appraised value rose from $9.83 to $10.40 over the year; trades ran slightly above it."
                keys={[{ label: "Appraised value", style: "accent" }, { label: "Last traded", style: "ink-dots" }]}
                table={{ head: ["Date", "Appraised", "Traded"], rows: sampleSeries.map((p) => [new Date(p.t).toISOString().slice(0, 10), `$${p.a.toFixed(2)}`, p.b == null ? "—" : `$${p.b.toFixed(2)}`]) }}
              >
                <TimeSeriesChart data={sampleSeries} names={{ a: "Appraised value", b: "Last traded" }} digits={2} dotsB height={220} />
              </ChartFrame>
              <ChartFrame
                title="Dividend per share"
                summary="August was lower because repair costs were higher that month."
                table={{ head: ["Month", "Per share"], rows: sampleBars.map((b) => [b.label, `$${b.v.toFixed(4)}`]) }}
              >
                <MonthlyBars data={sampleBars} name="Per share" digits={2} height={220} />
              </ChartFrame>
            </div>
          </Block>

          <Block id="card" title="Property card and wordmark" aside="Real seeded property">
            <div className="grid grid-cols-[minmax(0,1fr)] gap-12 md:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
              {card ? <PropertyCard p={card} /> : <Empty title="No seeded property found.">Run the seed to see a real card.</Empty>}
              <div className="space-y-8">
                {card && cards[1] ? <PropertyCard p={cards.find((c) => c.card.slug !== card.slug)!.card} layout="list" /> : null}
                <div className="flex flex-wrap items-end gap-10">
                  <Wordmark href={null} />
                  <Wordmark href={null} size="lg" />
                  <div className="bg-ink p-4 text-paper"><Wordmark href={null} /></div>
                </div>
              </div>
            </div>
          </Block>
        </div>
      </div>
    </Page>
  );
}
