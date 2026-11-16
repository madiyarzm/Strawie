/** Editor look and Python completions shared by every code editor. */

import type { TFunction } from "i18next";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";

export const pythonSnippets = (t: TFunction) => [
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

export const strawieTheme = [strawieEditorTheme, syntaxHighlighting(strawieHighlight)];
