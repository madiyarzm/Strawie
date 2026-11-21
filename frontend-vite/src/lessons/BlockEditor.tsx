/**
 * One collaboratively edited block (text or Python) on a lesson page.
 *
 * Uses a plain CodeMirror EditorView instead of @uiw/react-codemirror: the
 * editor is created once from the Y.Text's current content and yCollab keeps
 * it in sync from then on. (A controlled `value` prop would fight the sync.)
 */

import React, { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import * as Y from "yjs";
import type { Awareness } from "y-protocols/awareness";
import { yCollab, yUndoManagerKeymap } from "y-codemirror.next";
import { EditorState } from "@codemirror/state";
import { EditorView, drawSelection, highlightActiveLine, keymap, lineNumbers, placeholder as placeholderExt } from "@codemirror/view";
import { defaultKeymap, indentWithTab } from "@codemirror/commands";
import { bracketMatching, indentOnInput } from "@codemirror/language";
import { autocompletion, closeBrackets, closeBracketsKeymap, completeFromList } from "@codemirror/autocomplete";
import { python } from "@codemirror/lang-python";
import { pythonSnippets, strawieTheme } from "../components/editorTheme";
import { formattedText } from "./textFormat";

type Props = {
  ytext: Y.Text;
  awareness: Awareness | null;
  language: "python" | "text";
  editable: boolean;
  placeholder?: string;
  /** Called on Mod-Enter (run this block). */
  onRun?: () => void;
  className?: string;
  /** Receives the editor view (for the formatting toolbar). */
  viewRef?: React.MutableRefObject<EditorView | null>;
  /** Put the cursor here when the editor appears (a block that was just added). */
  autoFocus?: boolean;
};

const proseTheme = EditorView.theme({
  "&": { backgroundColor: "transparent", color: "var(--text)" },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": { fontFamily: "var(--font)" },
  ".cm-content": { fontFamily: "var(--font)", fontSize: "15px", lineHeight: "1.65", padding: "2px 0", caretColor: "var(--text)" },
  ".cm-line": { padding: "0" },
  ".cm-gutters": { display: "none" },
  ".cm-activeLine": { backgroundColor: "transparent" },
  ".cm-placeholder": { color: "var(--subtle)" },
});

const codeTweaks = EditorView.theme({
  ".cm-content": { padding: "12px 0" },
  ".cm-placeholder": { color: "var(--subtle)", fontStyle: "italic" },
});

export const BlockEditor: React.FC<Props> = ({ ytext, awareness, language, editable, placeholder, onRun, className, viewRef, autoFocus }) => {
  const { t } = useTranslation();
  const host = useRef<HTMLDivElement>(null);
  const onRunRef = useRef(onRun);
  useEffect(() => { onRunRef.current = onRun; }, [onRun]);

  useEffect(() => {
    if (!host.current) return;
    const runKey = keymap.of([{ key: "Mod-Enter", run: () => { onRunRef.current?.(); return !!onRunRef.current; } }]);
    const common = [
      runKey,
      drawSelection(),
      EditorView.editable.of(editable),
      EditorState.readOnly.of(!editable),
      yCollab(ytext, awareness ?? undefined),
      keymap.of([...yUndoManagerKeymap, ...closeBracketsKeymap, ...defaultKeymap, indentWithTab]),
      ...(placeholder ? [placeholderExt(placeholder)] : []),
    ];
    const extensions = language === "python"
      ? [
          lineNumbers(), highlightActiveLine(), indentOnInput(), bracketMatching(), closeBrackets(),
          autocompletion({ override: [completeFromList(pythonSnippets(t))] }),
          // Earlier extensions win in CodeMirror, so tweaks go before the base theme.
          codeTweaks, python(), ...strawieTheme, EditorState.tabSize.of(4), ...common,
        ]
      : [proseTheme, formattedText(!editable), EditorView.lineWrapping, ...strawieTheme, ...common];
    const view = new EditorView({
      state: EditorState.create({ doc: ytext.toString(), extensions }),
      parent: host.current,
    });
    if (viewRef) viewRef.current = view;
    if (autoFocus && editable) view.focus();
    return () => {
      if (viewRef?.current === view) viewRef.current = null;
      view.destroy();
    };
    // autoFocus only matters when the editor is first created.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ytext, awareness, language, editable, placeholder, t, viewRef]);

  return <div ref={host} className={className} />;
};
