/**
 * Minimal formatting for text blocks, written as a small Markdown subset:
 *
 *   **bold**   *italic*   `code`   # Heading   ## Smaller heading   - list item
 *
 * The text stays plain characters in the Y.Text (so live sync, undo and old
 * pages keep working). While editing, the markers are shown faintly next to
 * the styled text; read-only viewers (students looking at the task) see the
 * styled text with the markers hidden.
 */

import { EditorSelection, type Extension, type Range } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate, WidgetType, keymap } from "@codemirror/view";

export type SpanKind = "strong" | "em" | "code";
export type Span = { from: number; to: number; kind: SpanKind; mark: number };
export type ParsedLine = {
  /** Line style, or null for a plain paragraph line. */
  block: "h1" | "h2" | "li" | null;
  /** Length of the "# " / "- " prefix (0 if none). */
  prefix: number;
  /** Inline spans, positions relative to the line, markers included. */
  spans: Span[];
};

const INLINE: { kind: SpanKind; re: RegExp; mark: number }[] = [
  // Code first, so ** inside `code` stays literal.
  { kind: "code", re: /`([^`\n]+)`/g, mark: 1 },
  { kind: "strong", re: /\*\*(?=\S)(.+?)(?<=\S)\*\*/g, mark: 2 },
  { kind: "em", re: /(?<![*\w])\*(?![\s*])[^*\n]*?[^\s*]\*(?![*\w])|(?<!\w)_(?!\s)[^_\n]*?\S_(?!\w)/g, mark: 1 },
];

export function parseLine(line: string): ParsedLine {
  let block: ParsedLine["block"] = null;
  let prefix = 0;
  const h = /^(#{1,2}) /.exec(line);
  const li = /^([-*]) /.exec(line);
  if (h) { block = h[1].length === 1 ? "h1" : "h2"; prefix = h[0].length; }
  else if (li) { block = "li"; prefix = li[0].length; }

  const spans: Span[] = [];
  const taken: [number, number][] = [[0, prefix]];
  const free = (a: number, b: number) => taken.every(([x, y]) => b <= x || a >= y);
  for (const { kind, re, mark } of INLINE) {
    re.lastIndex = 0;
    for (let m = re.exec(line); m; m = re.exec(line)) {
      const from = m.index, to = m.index + m[0].length;
      if (to - from <= mark * 2 || !free(from, to)) continue;
      spans.push({ from, to, kind, mark });
      // Bold may contain italic, everything else is exclusive.
      if (kind !== "strong") taken.push([from, to]);
      else { taken.push([from, from + mark], [to - mark, to]); }
    }
  }
  spans.sort((a, b) => a.from - b.from || b.to - a.to);
  return { block, prefix, spans };
}

// ── CodeMirror: styling ────────────────────────────────────────────────────

class BulletWidget extends WidgetType {
  toDOM() {
    const el = document.createElement("span");
    el.className = "cm-md-dot";
    el.textContent = "•";
    return el;
  }
  eq() { return true; }
}

const hidden = Decoration.replace({});
const faint = Decoration.mark({ class: "cm-md-mark" });
const bullet = Decoration.replace({ widget: new BulletWidget() });
const styles: Record<SpanKind, Decoration> = {
  strong: Decoration.mark({ class: "cm-md-strong" }),
  em: Decoration.mark({ class: "cm-md-em" }),
  code: Decoration.mark({ class: "cm-md-code" }),
};
const lineStyles = {
  h1: Decoration.line({ class: "cm-md-h1" }),
  h2: Decoration.line({ class: "cm-md-h2" }),
  li: Decoration.line({ class: "cm-md-li" }),
};

function decorate(view: EditorView, hideMarks: boolean): DecorationSet {
  const out: Range<Decoration>[] = [];
  const marker = hideMarks ? hidden : faint;
  for (const { from, to } of view.visibleRanges) {
    for (let pos = from; pos <= to;) {
      const line = view.state.doc.lineAt(pos);
      const parsed = parseLine(line.text);
      const at = line.from;
      if (parsed.block) {
        out.push(lineStyles[parsed.block].range(at));
        if (parsed.block === "li" && hideMarks) out.push(bullet.range(at, at + parsed.prefix));
        else out.push(marker.range(at, at + parsed.prefix));
      }
      for (const s of parsed.spans) {
        out.push(styles[s.kind].range(at + s.from, at + s.to));
        out.push(marker.range(at + s.from, at + s.from + s.mark));
        out.push(marker.range(at + s.to - s.mark, at + s.to));
      }
      pos = line.to + 1;
    }
  }
  return Decoration.set(out, true);
}

const theme = EditorView.theme({
  ".cm-md-strong": { fontWeight: "700" },
  ".cm-md-em": { fontStyle: "italic" },
  ".cm-md-code": { fontFamily: "var(--mono)", fontSize: "0.9em", background: "var(--bg-3)", borderRadius: "4px", padding: "1px 3px" },
  ".cm-md-mark": { opacity: "0.35" },
  ".cm-md-h1": { fontSize: "1.35em", fontWeight: "700", lineHeight: "1.4" },
  ".cm-md-h2": { fontSize: "1.12em", fontWeight: "700" },
  ".cm-md-dot": { display: "inline-block", width: "1.1em", color: "var(--text-3)" },
});

export function formattedText(hideMarks: boolean): Extension {
  const plugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) { this.decorations = decorate(view, hideMarks); }
      update(u: ViewUpdate) {
        if (u.docChanged || u.viewportChanged) this.decorations = decorate(u.view, hideMarks);
      }
    },
    { decorations: v => v.decorations },
  );
  return [plugin, theme, ...(hideMarks ? [] : [keymap.of([
    { key: "Mod-b", run: v => toggleWrap(v, "**") },
    { key: "Mod-i", run: v => toggleWrap(v, "*") },
    { key: "Mod-e", run: v => toggleWrap(v, "`") },
  ])])];
}

// ── CodeMirror: commands (toolbar + shortcuts) ─────────────────────────────

/** Wrap the selection in `mark` (or unwrap it if it already is). */
export function toggleWrap(view: EditorView, mark: string): boolean {
  const { state } = view;
  const n = mark.length;
  view.dispatch(state.changeByRange(range => {
    const before = state.sliceDoc(range.from - n, range.from);
    const after = state.sliceDoc(range.to, range.to + n);
    if (before === mark && after === mark) {
      return {
        changes: [{ from: range.from - n, to: range.from }, { from: range.to, to: range.to + n }],
        range: EditorSelection.range(range.from - n, range.to - n),
      };
    }
    return {
      changes: [{ from: range.from, insert: mark }, { from: range.to, insert: mark }],
      range: EditorSelection.range(range.from + n, range.to + n),
    };
  }));
  view.focus();
  return true;
}

/** Toggle a line prefix ("# ", "## " or "- ") on every selected line. */
export function toggleLinePrefix(view: EditorView, prefix: string): boolean {
  const { state } = view;
  const changes: { from: number; to?: number; insert?: string }[] = [];
  const seen = new Set<number>();
  for (const range of state.selection.ranges) {
    for (let pos = range.from; pos <= range.to;) {
      const line = state.doc.lineAt(pos);
      if (!seen.has(line.number)) {
        seen.add(line.number);
        const existing = /^(#{1,2} |[-*] )/.exec(line.text)?.[0] ?? "";
        if (existing === prefix) changes.push({ from: line.from, to: line.from + existing.length });
        else changes.push({ from: line.from, to: line.from + existing.length, insert: prefix });
      }
      pos = line.to + 1;
    }
  }
  view.dispatch({ changes });
  view.focus();
  return true;
}
