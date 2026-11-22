"use client";

import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

/**
 * Charts receive plain numbers (dollars) prepared on the server. They never feed back into
 * money math. Styling: one accent series, hairline horizontal grid, direct labels, no legend box.
 */

const axis = { fontSize: 12, fill: "var(--color-stone)", fontFamily: "var(--font-sans)", fontVariantNumeric: "tabular-nums" } as const;

/** Round axis steps (1, 2, 2.5, 5 × 10^n) so ticks read like a person chose them. */
function niceTicks(min: number, max: number, count = 5): number[] {
  const span = max - min || Math.abs(max) || 1;
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = ([1, 2, 2.5, 5, 10].find((m) => m * mag >= raw) ?? 10) * mag;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const out: number[] = [];
  for (let v = lo; v <= hi + step / 2; v += step) out.push(Number(v.toFixed(6)));
  return out;
}
const usd = (v: number, digits = 0) => `$${v.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
const day = (t: number) => new Date(t).toLocaleDateString("en-US", { month: "short", year: "2-digit", timeZone: "UTC" });
const fullDay = (t: number) => new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

function Tip({ active, payload, label, digits, names }: { active?: boolean; payload?: { dataKey?: string | number; value?: number; color?: string }[]; label?: number | string; digits: number; names: Record<string, string> }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-sm border border-ink bg-paper px-3 py-2 text-xs shadow-pop">
      <p className="label mb-1">{typeof label === "number" ? fullDay(label) : label}</p>
      {payload.filter((p) => p.value != null).map((p) => (
        <p key={String(p.dataKey)} className="num flex justify-between gap-4">
          <span style={{ color: p.color }}>{names[String(p.dataKey)] ?? String(p.dataKey)}</span>
          <span>{usd(Number(p.value), digits)}</span>
        </p>
      ))}
    </div>
  );
}

export type SeriesPoint = { t: number; a?: number | null; b?: number | null };

/** Time series with up to two lines. `a` is the accent series; `b` is ink, dashed or dotted. */
export function TimeSeriesChart({
  data,
  names,
  digits = 0,
  height = 260,
  stepA = false,
  dotsB = false,
}: {
  data: SeriesPoint[];
  names: { a: string; b?: string };
  digits?: number;
  height?: number;
  stepA?: boolean;
  dotsB?: boolean;
}) {
  const values = data.flatMap((d) => [d.a, d.b]).filter((v): v is number => typeof v === "number");
  const ticks = niceTicks(Math.min(...values), Math.max(...values), 4);
  return (
    <div style={{ height }} aria-hidden>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--color-rule)" strokeWidth={1} />
          <XAxis dataKey="t" type="number" scale="time" domain={["dataMin", "dataMax"]} tickFormatter={day} tick={axis} tickLine={false} axisLine={{ stroke: "var(--color-ink)" }} minTickGap={48} />
          <YAxis domain={[ticks[0] ?? 0, ticks[ticks.length - 1] ?? 1]} ticks={ticks} tickFormatter={(v: number) => usd(v, digits)} tick={axis} tickLine={false} axisLine={false} width={digits ? 52 : 64} />
          <Tooltip content={<Tip digits={digits} names={{ a: names.a, b: names.b ?? "" }} />} cursor={{ stroke: "var(--color-stone)", strokeWidth: 1 }} />
          <Line dataKey="a" type={stepA ? "stepAfter" : "monotone"} stroke="var(--color-accent)" strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
          {names.b ? (
            <Line dataKey="b" type="linear" stroke={dotsB ? "none" : "var(--color-ink)"} strokeWidth={1} strokeDasharray={dotsB ? "0" : "3 3"} dot={dotsB ? { r: 2.5, fill: "var(--color-paper)", stroke: "var(--color-ink)", strokeWidth: 1.25 } : false} connectNulls isAnimationActive={false} />
          ) : null}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function MonthlyBars({ data, name, digits = 2, height = 200 }: { data: { label: string; v: number }[]; name: string; digits?: number; height?: number }) {
  return (
    <div style={{ height }} aria-hidden>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barCategoryGap="28%">
          <CartesianGrid vertical={false} stroke="var(--color-rule)" />
          <XAxis dataKey="label" tick={axis} tickLine={false} axisLine={{ stroke: "var(--color-ink)" }} interval="preserveStartEnd" />
          <YAxis domain={[0, "auto"]} tickFormatter={(v: number) => usd(v, digits)} tick={axis} tickLine={false} axisLine={false} width={56} tickCount={4} allowDecimals />
          <Tooltip content={<Tip digits={digits > 2 ? digits : 2} names={{ v: name }} />} cursor={{ fill: "var(--color-paper-deep)" }} />
          <Bar dataKey="v" fill="var(--color-accent)" isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
