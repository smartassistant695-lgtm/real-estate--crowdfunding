import type { ReactNode } from "react";

/**
 * Every chart sits in this frame: a title, a one-line reading of the chart, direct series
 * labels, and the same data as a table for people who cannot or would rather not read a chart.
 */
export function ChartFrame({
  title,
  summary,
  keys,
  children,
  table,
}: {
  title: string;
  summary: ReactNode;
  keys?: { label: string; style: "accent" | "ink-dashed" | "ink-dots" }[];
  children: ReactNode;
  table: { head: string[]; rows: (string | number)[][] };
}) {
  return (
    <figure>
      <figcaption className="mb-3">
        <p className="label">{title}</p>
        <p className="mt-1 max-w-prose text-sm text-ink-soft">{summary}</p>
        {keys ? (
          <ul className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-ink-soft">
            {keys.map((k) => (
              <li key={k.label} className="flex items-center gap-2">
                <svg aria-hidden width="22" height="8" viewBox="0 0 22 8">
                  {k.style === "accent" ? <line x1="0" y1="4" x2="22" y2="4" stroke="var(--color-accent)" strokeWidth="2" /> : null}
                  {k.style === "ink-dashed" ? <line x1="0" y1="4" x2="22" y2="4" stroke="var(--color-ink)" strokeWidth="1" strokeDasharray="3 3" /> : null}
                  {k.style === "ink-dots" ? (<><circle cx="11" cy="4" r="2.5" fill="var(--color-paper)" stroke="var(--color-ink)" strokeWidth="1.25" /></>) : null}
                </svg>
                {k.label}
              </li>
            ))}
          </ul>
        ) : null}
      </figcaption>
      {children}
      <details className="mt-2 text-xs">
        <summary className="cursor-pointer text-stone underline decoration-rule underline-offset-4 hover:text-ink">View this chart as a table</summary>
        <div className="mt-2 max-h-64 overflow-auto border-y border-rule">
          <table className="w-full text-xs">
            <thead>
              <tr>{table.head.map((h, i) => <th key={h} scope="col" className={`label py-1.5 pr-4 font-medium ${i ? "text-right" : "text-left"}`}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {table.rows.map((r, i) => (
                <tr key={i} className="border-t border-rule">
                  {r.map((c, j) => <td key={j} className={`num py-1.5 pr-4 ${j ? "text-right" : ""}`}>{c}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
