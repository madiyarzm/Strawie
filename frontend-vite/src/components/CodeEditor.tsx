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
import type { PeerInfo } from "../hooks/useCollab";

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

const strawieEditorTheme = EditorView.theme({
  "&": {
    backgroundColor: "#0d1117",
    color: "#e2e8f0",
    height: "100%",
  },
  ".cm-content": {
    caretColor: "#818cf8",
    fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', ui-monospace, monospace",
  },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "#818cf8" },
  "&.cm-focused .cm-selectionBackground, ::selection": {
    backgroundColor: "#818cf830",
  },
  ".cm-selectionBackground": { backgroundColor: "#818cf820" },
  ".cm-activeLine": { backgroundColor: "#ffffff07" },
  ".cm-activeLineGutter": { backgroundColor: "#ffffff07", color: "#94a3b8" },
  ".cm-gutters": {
    backgroundColor: "#0d1117",
    color: "#475569",
    border: "none",
    borderRight: "1px solid #1e293b",
  },
  ".cm-lineNumbers .cm-gutterElement": { padding: "0 12px 0 8px" },
  ".cm-scroller": { overflow: "auto" },
  ".cm-error-line": { backgroundColor: "#f8717120 !important", borderLeft: "2px solid #f87171" },
  ".cm-matchingBracket": { backgroundColor: "#818cf840", outline: "1px solid #818cf880" },
  ".cm-tooltip": {
    backgroundColor: "#1e293b",
    border: "1px solid #334155",
    borderRadius: "6px",
  },
  ".cm-tooltip-autocomplete ul li[aria-selected]": {
    backgroundColor: "#818cf820",
    color: "#e2e8f0",
  },
}, { dark: true });

const strawieHighlight = HighlightStyle.define([
  { tag: t.comment, color: "#475569", fontStyle: "italic" },
  { tag: [t.lineComment, t.blockComment], color: "#475569", fontStyle: "italic" },
  { tag: t.keyword, color: "#818cf8", fontWeight: "600" },
  { tag: [t.controlKeyword, t.operatorKeyword], color: "#a78bfa", fontWeight: "600" },
  { tag: [t.definitionKeyword, t.moduleKeyword], color: "#818cf8" },
  { tag: t.string, color: "#34d399" },
  { tag: [t.special(t.string), t.regexp], color: "#2dd4bf" },
  { tag: [t.number, t.integer, t.float], color: "#fb923c" },
  { tag: [t.bool, t.null], color: "#f472b6" },
  { tag: t.function(t.variableName), color: "#38bdf8" },
  { tag: t.function(t.propertyName), color: "#38bdf8" },
  { tag: t.definition(t.function(t.variableName)), color: "#38bdf8", fontWeight: "600" },
  { tag: t.definition(t.variableName), color: "#e2e8f0" },
  { tag: t.variableName, color: "#e2e8f0" },
  { tag: t.propertyName, color: "#94a3b8" },
  { tag: [t.className, t.definition(t.className)], color: "#fbbf24", fontWeight: "600" },
  { tag: t.typeName, color: "#fbbf24" },
  { tag: t.operator, color: "#94a3b8" },
  { tag: [t.bracket, t.paren, t.squareBracket, t.angleBracket], color: "#94a3b8" },
  { tag: t.punctuation, color: "#64748b" },
  { tag: t.separator, color: "#64748b" },
  { tag: t.self, color: "#f472b6", fontStyle: "italic" },
  { tag: t.atom, color: "#f472b6" },
  { tag: t.meta, color: "#64748b" },
  { tag: t.invalid, color: "#f87171", textDecoration: "underline" },
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
}) => {
  const { t } = useTranslation();
  const [ydoc] = useState<Y.Doc>(() => new Y.Doc());
  const viewRef = useRef<EditorView | null>(null);
  const ytext = useMemo(() => ydoc.getText("code"), [ydoc]);

  const { awareness, peers, setHandRaised } = useCollab(roomId, ydoc, value, userName, userRole);

  const onPeersChangeRef = useRef(onPeersChange);
  useEffect(() => { onPeersChangeRef.current = onPeersChange; }, [onPeersChange]);
  useEffect(() => { onPeersChangeRef.current?.(peers); }, [peers]);

  useEffect(() => { setHandRaised(!!handRaised); }, [handRaised, setHandRaised]);

  useEffect(() => {
    if (!viewRef.current) return;
    viewRef.current.dispatch({ effects: [setErrorLinesEffect.of(errorLines ?? [])] });
  }, [errorLines]);

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
      {/* Presence bar: always rendered to avoid layout shift */}
      <div className="flex items-center gap-3 px-3 h-6 min-h-[24px] border-b border-slate-800 bg-[#0d1117] text-[10px] text-slate-400">
        {peers.map((p) => (
          <span
            key={p.clientId}
            className={`flex items-center gap-1 ${p.isSelf ? "text-slate-300" : "text-slate-400"}`}
          >
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{ backgroundColor: p.color }}
            />
            {p.name}
            {p.handRaised && (
              <LifeBuoy
                className="h-3 w-3"
                style={{ color: "var(--amber, #f59e0b)" }}
                aria-label={t("editor.handRaised")}
              />
            )}
          </span>
        ))}
      </div>
      <CodeMirror
        key={`${roomId || "local"}:${awareness ? "awareness" : "plain"}`}
        height="100%"
        className={`flex-1 min-h-0 text-[13px] md:text-sm font-mono ${className}`}
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
