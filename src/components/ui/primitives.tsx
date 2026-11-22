import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/cn";

/* ---------- Stat: a labelled figure. The label is small caps, the figure tabular. ---------- */
export function Stat({
  label,
  value,
  note,
  size = "md",
  tone,
  className,
}: {
  label: string;
  value: ReactNode;
  note?: ReactNode;
  size?: "sm" | "md" | "lg";
  tone?: "gain" | "loss";
  className?: string;
}) {
  const sizes = { sm: "text-md", md: "text-xl", lg: "text-3xl md:text-4xl" } as const;
  return (
    <div className={cn("min-w-0", className)}>
      <dt className="label">{label}</dt>
      <dd className={cn("num mt-1 font-serif tracking-figure", sizes[size], tone === "gain" && "text-gain", tone === "loss" && "text-loss")}>
        {value}
      </dd>
      {note ? <dd className="mt-1 text-xs text-stone">{note}</dd> : null}
    </div>
  );
}

/* ---------- Badge: status in small caps with a rule, not a pill. ---------- */
type BadgeTone = "neutral" | "accent" | "notice" | "loss" | "solid";
const badgeTones: Record<BadgeTone, string> = {
  neutral: "border-stone text-ink-soft",
  accent: "border-accent text-accent",
  notice: "border-notice text-notice",
  loss: "border-loss text-loss",
  solid: "border-accent bg-accent text-on-accent",
};
export function Badge({ children, tone = "neutral", className }: { children: ReactNode; tone?: BadgeTone; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center rounded-xs border px-2 text-xs font-medium uppercase tracking-caps whitespace-nowrap",
        badgeTones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/* ---------- Table: dense, ruled, right-aligned numbers. ---------- */
export function Table({ className, children, caption, ...rest }: ComponentProps<"table"> & { caption?: string }) {
  return (
    <div className="-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0">
      <table className={cn("w-full min-w-max text-sm md:min-w-0", className)} {...rest}>
        {caption ? <caption className="sr-only">{caption}</caption> : null}
        {children}
      </table>
    </div>
  );
}
export function Th({ className, num, ...rest }: ComponentProps<"th"> & { num?: boolean }) {
  return (
    <th
      scope="col"
      className={cn("label border-b border-ink py-2 pr-4 align-bottom font-medium last:pr-0", num ? "text-right" : "text-left", className)}
      {...rest}
    />
  );
}
export function Td({ className, num, ...rest }: ComponentProps<"td"> & { num?: boolean }) {
  return <td className={cn("border-b border-rule py-2 pr-4 align-top last:pr-0", num && "num text-right", className)} {...rest} />;
}

/* ---------- Tabs: links, so every tab has a URL and works without JavaScript. ---------- */
export function Tabs({
  tabs,
  current,
  label,
  className,
}: {
  tabs: { key: string; label: string; href: string; count?: number }[];
  current: string;
  label: string;
  className?: string;
}) {
  return (
    <nav aria-label={label} className={cn("-mx-4 overflow-x-auto border-b border-rule px-4 md:mx-0 md:px-0", className)}>
      <ul className="flex gap-6">
        {tabs.map((t) => {
          const active = t.key === current;
          return (
            <li key={t.key}>
              <Link
                href={t.href}
                scroll={false}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "-mb-px inline-flex h-10 items-center gap-2 border-b-2 text-sm whitespace-nowrap",
                  active ? "border-ink font-medium text-ink" : "border-transparent text-stone hover:text-ink",
                )}
              >
                {t.label}
                {t.count !== undefined ? <span className="num text-xs text-stone">{t.count}</span> : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/* ---------- Layout helpers ---------- */
export function Page({ children, className, narrow }: { children: ReactNode; className?: string; narrow?: boolean }) {
  return <div className={cn("mx-auto w-full px-4 md:px-8", narrow ? "max-w-narrow" : "max-w-page", className)}>{children}</div>;
}

/** A heading carries its own weight: no kicker above it. `back` is navigation, not decoration. */
export function PageHeader({ back, title, lede, actions }: { back?: { href: string; label: string }; title: ReactNode; lede?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="flex flex-col gap-4 border-b border-ink pb-6 pt-10 md:flex-row md:items-end md:justify-between md:pt-14">
      <div className="max-w-prose">
        {back ? (
          <Link href={back.href} className="mb-4 inline-flex items-center gap-1 text-sm text-stone hover:text-ink">
            <ArrowLeft aria-hidden className="size-4" strokeWidth={1.5} />
            {back.label}
          </Link>
        ) : null}
        <h1 className="text-2xl md:text-3xl">{title}</h1>
        {lede ? <p className="mt-3 text-md text-ink-soft">{lede}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap gap-3">{actions}</div> : null}
    </header>
  );
}

export function SectionHeading({ children, aside, id }: { children: ReactNode; aside?: ReactNode; id?: string }) {
  return (
    <div className="mb-4 flex items-baseline justify-between gap-4 border-b border-ink pb-2">
      <h2 id={id} className="text-lg">
        {children}
      </h2>
      {aside ? <div className="text-xs text-stone">{aside}</div> : null}
    </div>
  );
}

/** An empty state is a sentence and, if useful, one next step. No illustration. */
export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="border-y border-rule py-10">
      <p className="font-serif text-md">{title}</p>
      {children ? <p className="mt-2 max-w-prose text-sm text-ink-soft">{children}</p> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

/**
 * Plain-language explanations and warnings. Neutral: a 2px ink rule on the left, no fill.
 * Caution / problem: ruled top and bottom in the tone colour over its wash, led by a tone word,
 * so the meaning never rests on colour alone.
 */
export function Note({ children, tone = "neutral", title, className }: { children: ReactNode; tone?: "neutral" | "notice" | "loss"; title?: string; className?: string }) {
  if (tone === "neutral") {
    return (
      <div className={cn("border-l-2 border-ink py-2 pl-4 pr-3 text-sm text-ink-soft", className)}>
        {title ? <p className="mb-1 font-medium text-ink">{title}</p> : null}
        {children}
      </div>
    );
  }
  const t = tone === "notice" ? { box: "border-notice bg-notice-wash", word: "Caution", text: "text-notice" } : { box: "border-loss bg-loss-wash", word: "Problem", text: "text-loss" };
  return (
    <div className={cn("border-y px-4 py-3 text-sm text-ink-soft", t.box, className)}>
      <p className="mb-1">
        <span className={cn("label mr-2", t.text)}>{t.word}</span>
        {title ? <span className="font-medium text-ink">{title}</span> : null}
      </p>
      {children}
    </div>
  );
}

/** "Step 2 of 5" over a ruled row; the current step has a 2px ink top rule. */
export function Stepper({ steps, current, label = "Progress" }: { steps: string[]; current: number; label?: string }) {
  return (
    <div className="mb-10">
      <p className="label mb-2">Step <span className="num">{current + 1}</span> of <span className="num">{steps.length}</span></p>
      <ol aria-label={label} className="grid gap-2" style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}>
        {steps.map((s, i) => (
          <li key={s} aria-current={i === current ? "step" : undefined} className={cn("border-t-2 pt-2 text-xs", i <= current ? "border-ink" : "border-rule", i === current ? "text-ink" : "text-stone")}>
            <span className="hidden sm:inline">{s}</span>
            {i < current ? <span className="sr-only"> (done)</span> : null}
          </li>
        ))}
      </ol>
    </div>
  );
}

/**
 * A measured quantity on a track: funding progress, quorum, a tally. 8px track in paper-deep,
 * accent fill. Optional threshold ticks (2px ink) with their own text label. The figure is always
 * printed as text next to it; the bar is never the only carrier of the number.
 */
export function Meter({
  segments,
  max,
  thresholds = [],
  label,
  className,
}: {
  segments: { value: number; tone: "accent" | "ink" | "stone"; label: string }[];
  max: number;
  thresholds?: { at: number; label: string }[];
  label: string;
  className?: string;
}) {
  const pct = (v: number) => `${Math.max(0, Math.min(100, (v / (max || 1)) * 100))}%`;
  const fill = { accent: "bg-accent", ink: "bg-ink", stone: "bg-stone" } as const;
  return (
    <div className={className}>
      <div role="img" aria-label={label} className="relative h-2 bg-paper-deep">
        <div className="absolute inset-0 flex gap-px">
          {segments.filter((s) => s.value > 0).map((s) => (
            <div key={s.label} className={fill[s.tone]} style={{ width: pct(s.value) }} />
          ))}
        </div>
        {thresholds.map((t) => (
          <div key={t.label} aria-hidden className="absolute -inset-y-1 w-0.5 bg-ink" style={{ left: pct(t.at) }} />
        ))}
      </div>
      {thresholds.length ? (
        <div className="relative mt-1 h-4 text-xs text-stone">
          {thresholds.map((t) => (
            <span key={t.label} className="absolute -translate-x-1/2 whitespace-nowrap" style={{ left: pct(t.at) }}>{t.label}</span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** Key–value rows for fact sheets and order reviews. */
export function Facts({ rows, className }: { rows: { label: ReactNode; value: ReactNode; strong?: boolean }[]; className?: string }) {
  return (
    <dl className={cn("text-sm", className)}>
      {rows.map((r, i) => (
        <div key={i} className={cn("flex items-baseline justify-between gap-6 border-b border-rule py-2", r.strong && "border-ink font-medium")}>
          <dt className="text-ink-soft">{r.label}</dt>
          <dd className="num text-right">{r.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * `sign` shows + / −. `gainLoss` also colours it, and is ONLY for gains and losses: money simply
 * entering or leaving an account (a purchase, a deposit) is not a loss and stays in ink.
 */
export function Money({ cents, sign, gainLoss, className }: { cents: bigint; sign?: boolean; gainLoss?: boolean; className?: string }) {
  const tone = gainLoss ? (cents > 0n ? "text-gain" : cents < 0n ? "text-loss" : "") : "";
  const neg = cents < 0n;
  const abs = neg ? -cents : cents;
  const dollars = (abs / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const c = (abs % 100n).toString().padStart(2, "0");
  return (
    <span className={cn("num", tone, className)}>
      {neg ? "−" : (sign || gainLoss) && cents > 0n ? "+" : ""}${dollars}.{c}
    </span>
  );
}
