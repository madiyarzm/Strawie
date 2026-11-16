/**
 * IDE-style code editor with real-time CRDT collaboration.
 *
 * Renders colored cursors and selections of other participants via Yjs Awareness.
 */

import React, { useMemo, useRef, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import CodeMirror from "@uiw/react-codemirror";
import { Decoration, EditorView } from "@codemirror/view";
import type { DecorationSet } from "@codemirror/view";
import { StateEffect, StateField, RangeSetBuilder } from "@codemirror/state";
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
import { pythonSnippets, strawieTheme } from "./editorTheme";
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
