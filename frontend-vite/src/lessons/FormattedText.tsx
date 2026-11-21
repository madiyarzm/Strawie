/** Read-only rendering of a text block's light formatting (see textFormat.ts). */

import React from "react";
import { parseLine } from "./textFormat";
import type { Span } from "./textFormat";

function inline(line: string, spans: Span[], start: number, end: number): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let pos = start;
  for (let i = 0; i < spans.length; i++) {
    const s = spans[i];
    if (s.from < pos || s.to > end) continue;
    if (s.from > pos) out.push(line.slice(pos, s.from));
    const inner = spans.filter(x => x !== s && x.from >= s.from + s.mark && x.to <= s.to - s.mark);
    const body = inline(line, inner, s.from + s.mark, s.to - s.mark);
    out.push(s.kind === "strong" ? <strong key={s.from}>{body}</strong>
      : s.kind === "em" ? <em key={s.from}>{body}</em>
      : <code key={s.from} className="nb-inline-code">{body}</code>);
    pos = s.to;
  }
  if (pos < end) out.push(line.slice(pos, end));
  return out;
}

export const FormattedText: React.FC<{ text: string; className?: string }> = ({ text, className }) => (
  <div className={className}>
    {text.split("\n").map((line, i) => {
      const p = parseLine(line);
      const content = inline(line, p.spans, p.prefix, line.length);
      if (p.block === "h1") return <div key={i} className="cm-md-h1">{content}</div>;
      if (p.block === "h2") return <div key={i} className="cm-md-h2">{content}</div>;
      if (p.block === "li") return <div key={i}><span className="cm-md-dot">•</span>{content}</div>;
      return <div key={i}>{content.length ? content : " "}</div>;
    })}
  </div>
);
