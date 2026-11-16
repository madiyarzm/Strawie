/**
 * IDE-style code editor with real-time CRDT collaboration.
 *
 * Renders colored cursors and selections of other participants via Yjs Awareness.
 */

import React, { useMemo, useRef, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import CodeMirror from "@uiw/react-codemirror";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { Decoration, EditorView } from "@codemirror/view";
import type { DecorationSet } from "@codemirror/view";
import { StateEffect, StateField, RangeSetBuilder } from "@codemirror/state";
import { tags as t } from "@lezer/highlight";
import { python } from "@codemirror/lang-python";
import { bracketMatching } from "@codemirror/language";
import {
  closeBrackets,
  autocompletion,
  completeFromList,
} from "@codemirror/autocomplete";
import * as Y from "yjs";
import { yCollab } from "y-codemirror.next";
import { LifeBuoy } from "lucide-react";
import { useCollab } from "../hooks/useCollab";
import type { CollabStatus, PeerInfo } from "../hooks/useCollab";

interface CodeEditorProps {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  roomId?: string;
  userName?: string;
  userRole?: string;
  handRaised?: boolean;
  onPeersChange?: (peers: PeerInfo[]) => void;
  errorLines?: number[];
  /**
   * Notified when the collaboration relay connects or drops. Optional: only
   * the demo currently surfaces it, so a visitor sees "live sync offline,
   * your edits are still saved locally" instead of silence.
   */
  onCollabStatusChange?: (status: CollabStatus) => void;
  /** Render the built-in presence strip. Hosts that show peers elsewhere
   *  (e.g. in their own toolbar via onPeersChange) can turn it off. */
  showPresence?: boolean;
}

const setErrorLinesEffect = StateEffect.define<number[]>();

const errorLineField = StateField.define<DecorationSet>({
  create() { return Decoration.none; },
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const effect of tr.effects) {
      if (effect.is(setErrorLinesEffect)) {
        const builder = new RangeSetBuilder<Decoration>();
        for (const lineNum of [...effect.value].sort((a, b) => a - b)) {
          if (lineNum >= 1 && lineNum <= tr.state.doc.lines) {
            const line = tr.state.doc.line(lineNum);
            builder.add(line.from, line.from, Decoration.line({ class: "cm-error-line" }));
          }
        }
        deco = builder.finish();
      }
    }
    return deco;
  },
  provide: f => EditorView.decorations.from(f),
});

const pythonSnippets = (t: TFunction) => [
  { label: "print", type: "function", apply: "print()", detail: t("editor.builtinFunction"), info: t("editor.printInfo") },
  { label: "range", type: "function", apply: "range()", detail: t("editor.builtinFunction"), info: t("editor.rangeInfo") },
  { label: "len", type: "function", apply: "len()", detail: t("editor.builtinFunction"), info: t("editor.lenInfo") },
  { label: "def", type: "keyword", apply: "def ", detail: t("editor.keyword"), info: t("editor.defInfo") },
  { label: "for", type: "keyword", apply: "for ", detail: t("editor.keyword"), info: t("editor.forInfo") },
  { label: "if", type: "keyword", apply: "if ", detail: t("editor.keyword"), info: t("editor.ifInfo") },
];

// Colours come from CSS variables (index.css) so the editor follows the app
// theme: light uses the landing page's syntax palette, dark a warm neutral.
const strawieEditorTheme = EditorView.theme({
  "&": {
    backgroundColor: "var(--editor-bg)",
    color: "var(--syn-ink)",
    height: "100%",
  },
  "&.cm-focused": { outline: "none" },
  ".cm-content": {
    caretColor: "var(--editor-caret)",
    fontFamily: "var(--mono)",
    padding: "14px 0",
  },
  ".cm-line": { padding: "0 18px 0 14px" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--editor-caret)", borderLeftWidth: "2px" },
  "&.cm-focused .cm-selectionBackground, ::selection": {
    backgroundColor: "var(--editor-select)",
  },
  ".cm-selectionBackground": { backgroundColor: "var(--editor-select)" },
  ".cm-activeLine": { backgroundColor: "var(--editor-active)" },
  ".cm-activeLineGutter": { backgroundColor: "transparent", color: "var(--text-2)" },
  ".cm-gutters": {
    backgroundColor: "var(--editor-gutter)",
    color: "var(--editor-gutter-text)",
    border: "none",
    borderRight: "1px solid var(--border)",
  },
  ".cm-gutter": { fontFamily: "var(--mono)" },
  ".cm-lineNumbers .cm-gutterElement": { padding: "0 12px 0 16px", minWidth: "44px" },
  ".cm-scroller": { overflow: "auto", lineHeight: "1.7" },
  ".cm-error-line": { backgroundColor: "var(--rose-10) !important", boxShadow: "inset 2px 0 0 var(--rose)" },
  ".cm-matchingBracket": { backgroundColor: "var(--editor-select)", outline: "none", borderRadius: "2px" },
  ".cm-tooltip": {
    backgroundColor: "var(--bg)",
    color: "var(--text)",
    border: "1px solid var(--border)",
    borderRadius: "12px",
    boxShadow: "var(--shadow-lg)",
    overflow: "hidden",
  },
  ".cm-tooltip-autocomplete ul": { fontFamily: "var(--mono)", padding: "4px" },
  ".cm-tooltip-autocomplete ul li": { borderRadius: "8px", padding: "3px 8px !important" },
  ".cm-tooltip-autocomplete ul li[aria-selected]": {
    backgroundColor: "var(--bg-3)",
    color: "var(--text)",
  },
  ".cm-completionDetail": { color: "var(--text-3)", fontStyle: "normal", marginLeft: "8px" },
  ".cm-completionInfo": { padding: "8px 10px", fontFamily: "var(--font)", fontSize: "12px" },
});

const strawieHighlight = HighlightStyle.define([
  { tag: [t.comment, t.lineComment, t.blockComment], color: "var(--syn-comment)", fontStyle: "italic" },
  { tag: [t.keyword, t.controlKeyword, t.operatorKeyword, t.definitionKeyword, t.moduleKeyword], color: "var(--syn-keyword)", fontWeight: "500" },
  { tag: t.string, color: "var(--syn-string)" },
  { tag: [t.special(t.string), t.regexp], color: "var(--syn-string)" },
  { tag: [t.number, t.integer, t.float], color: "var(--syn-number)" },
  { tag: [t.bool, t.null, t.atom], color: "var(--syn-const)" },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: "var(--syn-fn)" },
  { tag: t.definition(t.function(t.variableName)), color: "var(--syn-fn)", fontWeight: "600" },
  { tag: [t.definition(t.variableName), t.variableName], color: "var(--syn-ink)" },
  { tag: t.propertyName, color: "var(--syn-ink)" },
  { tag: [t.className, t.definition(t.className), t.typeName], color: "var(--syn-class)", fontWeight: "600" },
  { tag: [t.operator, t.bracket, t.paren, t.squareBracket, t.angleBracket, t.punctuation, t.separator, t.meta], color: "var(--syn-punct)" },
  { tag: t.self, color: "var(--syn-const)", fontStyle: "italic" },
  { tag: t.invalid, color: "var(--rose)", textDecoration: "underline" },
]);

const strawieTheme = [strawieEditorTheme, syntaxHighlighting(strawieHighlight)];

export const CodeEditor: React.FC<CodeEditorProps> = ({
  value,
  onChange,
  className = "",
  roomId,
  userName,
  userRole,
  handRaised,
  onPeersChange,
  errorLines,
  onCollabStatusChange,
  showPresence = true,
}) => {
  const { t } = useTranslation();
  const [ydoc] = useState<Y.Doc>(() => new Y.Doc());
  const viewRef = useRef<EditorView | null>(null);
  const ytext = useMemo(() => ydoc.getText("code"), [ydoc]);

  const { awareness, peers, setHandRaised, status: collabStatus } = useCollab(roomId, ydoc, value, userName, userRole);

  const onPeersChangeRef = useRef(onPeersChange);
  useEffect(() => { onPeersChangeRef.current = onPeersChange; }, [onPeersChange]);
  useEffect(() => { onPeersChangeRef.current?.(peers); }, [peers]);

  // Same ref pattern as onPeersChange: held in a ref so an inline arrow
  // function from the parent doesn't re-fire the effect every render.
  const onCollabStatusChangeRef = useRef(onCollabStatusChange);
  useEffect(() => { onCollabStatusChangeRef.current = onCollabStatusChange; }, [onCollabStatusChange]);
  useEffect(() => { onCollabStatusChangeRef.current?.(collabStatus); }, [collabStatus]);

  useEffect(() => { setHandRaised(!!handRaised); }, [handRaised, setHandRaised]);

  useEffect(() => {
    if (!viewRef.current) return;
    viewRef.current.dispatch({ effects: [setErrorLinesEffect.of(errorLines ?? [])] });
  }, [errorLines]);

  // Fade a remote user's name label once they stop moving, leaving just the
  // thin caret so parked names don't cover the code others are reading (the
  // hide is CSS via `.cm-ySelectionCaret--idle`). y-codemirror keys each caret
  // by color and reuses the DOM node across moves, so we toggle the class
  // per-user, matching the caret by its inline color (== awareness user.color).
  useEffect(() => {
    if (!awareness) return;
    const IDLE_MS = 3500;
    const timers = new Map<string, ReturnType<typeof setTimeout>>();
    // Canonicalize any CSS color to the browser's "rgb(...)" form for matching.
    const probe = document.createElement("span");
    const norm = (c: string): string => {
      probe.style.color = "";
      probe.style.color = c;
      return probe.style.color;
    };

    const markActive = (color: string) => {
      const root = viewRef.current?.dom;
      if (!root) return;
      const want = norm(color);
      root.querySelectorAll<HTMLElement>(".cm-ySelectionCaret").forEach((el) => {
        if (norm(el.style.backgroundColor) !== want) return;
        el.classList.remove("cm-ySelectionCaret--idle");
        const prev = timers.get(want);
        if (prev) clearTimeout(prev);
        timers.set(want, setTimeout(() => el.classList.add("cm-ySelectionCaret--idle"), IDLE_MS));
      });
    };

    const onChange = ({ added, updated }: { added: number[]; updated: number[]; removed: number[] }) => {
      const self = awareness.doc.clientID;
      const ids = added.concat(updated).filter((id) => id !== self);
      if (ids.length === 0) return;
      const states = awareness.getStates();
      // Defer a frame so y-codemirror has (re)rendered the caret for this change.
      requestAnimationFrame(() => {
        for (const id of ids) {
          const color = (states.get(id)?.user as { color?: string } | undefined)?.color;
          if (color) markActive(color);
        }
      });
    };

    awareness.on("change", onChange);
    return () => {
      awareness.off("change", onChange);
      timers.forEach((tm) => clearTimeout(tm));
      timers.clear();
    };
  }, [awareness]);

  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    // Do NOT call updateHandler() immediately. On fresh mount, ytext is empty
    // and the parent already holds the restored value (template / draft / last
    // submission). Firing onChange("") here would clobber that and persist an
    // empty string to localStorage, destroying the saved draft.
    const updateHandler = () => {
      onChangeRef.current(ytext.toString());
    };
    ytext.observe(updateHandler);
    return () => {
      ytext.unobserve(updateHandler);
    };
  }, [ytext]);

  const extensions = useMemo(
    () => [
      python(),
      bracketMatching(),
      closeBrackets(),
      autocompletion({
        override: [completeFromList(pythonSnippets(t))],
        activateOnTyping: true,
      }),
      yCollab(ytext, awareness ?? undefined),
      errorLineField,
      ...strawieTheme,
    ],
    [ytext, awareness, t],
  );

  return (
    <div className="h-full flex flex-col">
      {/* Presence strip: who's in this file. Always rendered (fixed height)
          so joining peers never shift the code. */}
      {showPresence && <div
        className="flex items-center gap-1.5 px-3 h-8 min-h-[32px] overflow-x-auto"
        style={{ background: "var(--editor-bg)", borderBottom: "1px solid var(--border)" }}
      >
        {peers.map((p) => (
          <span
            key={p.clientId}
            className="inline-flex items-center gap-1.5 h-[22px] px-2 rounded-full text-[11px] font-medium whitespace-nowrap"
            style={{
              background: p.isSelf ? "var(--bg-3)" : "transparent",
              color: p.isSelf ? "var(--text-2)" : "var(--text-3)",
            }}
          >
            <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: p.color }} />
            {p.name}
            {p.handRaised && (
              <LifeBuoy
                className="h-3 w-3"
                style={{ color: "var(--amber)" }}
                aria-label={t("editor.handRaised")}
              />
            )}
          </span>
        ))}
      </div>}
      <CodeMirror
        key={`${roomId || "local"}:${awareness ? "awareness" : "plain"}`}
        height="100%"
        className={`flex-1 min-h-0 text-[13px] font-mono ${className}`}
        theme="none"
        extensions={extensions}
        onCreateEditor={(view) => { viewRef.current = view; }}
        basicSetup={{
          lineNumbers: true,
          highlightActiveLineGutter: true,
          highlightActiveLine: true,
          foldGutter: false,
          bracketMatching: true,
          closeBrackets: true,
          autocompletion: true,
          indentOnInput: true,
          tabSize: 4,
        }}
        style={{ flex: 1 }}
      />
    </div>
  );
};
