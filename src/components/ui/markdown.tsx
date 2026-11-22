import { Fragment, type ReactNode } from "react";

/**
 * A deliberately tiny markdown subset for proposal text written by managers: paragraphs,
 * "- " bullet lists and **bold**. Everything is rendered as React text, never as HTML, so
 * nothing in the text can inject markup.
 */
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") ? <strong key={i}>{part.slice(2, -2)}</strong> : <Fragment key={i}>{part}</Fragment>,
  );
}

export function Markdown({ source, className }: { source: string; className?: string }) {
  const blocks = source.trim().split(/\n{2,}/);
  return (
    <div className={`prose-plain ${className ?? ""}`}>
      {blocks.map((b, i) => {
        const lines = b.split("\n");
        if (lines.every((l) => l.trim().startsWith("- "))) {
          return <ul key={i}>{lines.map((l, j) => <li key={j}>{inline(l.trim().slice(2))}</li>)}</ul>;
        }
        return <p key={i}>{inline(lines.join(" "))}</p>;
      })}
    </div>
  );
}
