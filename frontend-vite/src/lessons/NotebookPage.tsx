/**
 * A lesson page: text blocks and Python blocks, edited live together.
 *
 * The page is a Yjs document in a server-saved room (see app/core/lesson_rooms.py):
 *   doc.getArray("blocks"): Y.Map { id, type: "text" | "code", text: Y.Text,
 *     master code blocks: starter: Y.Text, tests: Y.Array<Y.Map>,
 *     student homework code blocks: graded: boolean }
 *
 * ▶ on a code block runs the code blocks above it (output hidden) and then
 * this block, in one namespace, so variables carry down the page.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import * as Y from "yjs";
import { ArrowDown, ArrowUp, Check, CircleDashed, Eye, EyeOff, Play, Plus, Square, Trash2, X } from "lucide-react";
import { useCollab } from "../hooks/useCollab";
import type { CollabStatus, PeerInfo } from "../hooks/useCollab";
import { startRun } from "../lib/pyodideRunner";
import type { RunHandle } from "../lib/pyodideRunner";
import { BlockEditor } from "./BlockEditor";
import { gradeProblem } from "./grading";
import type { TestOutcome } from "./grading";
import { readTests } from "./pageDoc";

export type PageKind = "board" | "solo" | "master" | "homework";

export type BlockResult = { passed: number; total: number; outcomes?: TestOutcome[]; failures?: { label: string; expected: string; got: string }[] };

type Props = {
  roomId: string;
  kind: PageKind;
  userName: string;
  userRole: "teacher" | "student";
  canEditText: boolean;
  canEditStructure: boolean;
  /** Per-block grading results to show (student homework, review). */
  results?: Record<string, BlockResult>;
  handRaised?: boolean;
  onDoc?: (doc: Y.Doc) => void;
  onPeers?: (peers: PeerInfo[]) => void;
  onStatus?: (status: CollabStatus) => void;
};

function newId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
}

function makeBlock(type: "text" | "code", withTests: boolean): Y.Map<unknown> {
  const m = new Y.Map<unknown>();
  m.set("id", newId());
  m.set("type", type);
  m.set("text", new Y.Text());
  if (type === "code" && withTests) {
    m.set("starter", new Y.Text());
    m.set("tests", new Y.Array<Y.Map<unknown>>());
  }
  return m;
}

export const NotebookPage: React.FC<Props> = ({
  roomId, kind, userName, userRole, canEditText, canEditStructure, results, handRaised, onDoc, onPeers, onStatus,
}) => {
  const { t } = useTranslation();
  const [doc] = useState(() => new Y.Doc());
  const { awareness, peers, status, setHandRaised } = useCollab(roomId, doc, undefined, userName, userRole);
  const [blocks, setBlocks] = useState<Y.Map<unknown>[]>([]);

  useEffect(() => { onDoc?.(doc); }, [doc, onDoc]);
  useEffect(() => { onPeers?.(peers); }, [peers, onPeers]);
  useEffect(() => { onStatus?.(status); }, [status, onStatus]);
  useEffect(() => { setHandRaised(!!handRaised); }, [handRaised, setHandRaised]);

  useEffect(() => {
    const arr = doc.getArray<Y.Map<unknown>>("blocks");
    const update = () => setBlocks(arr.toArray());
    update();
    arr.observe(update);
    return () => arr.unobserve(update);
  }, [doc]);

  useEffect(() => () => doc.destroy(), [doc]);

  const insertAt = useCallback((index: number, type: "text" | "code", withTests = false) => {
    const arr = doc.getArray<Y.Map<unknown>>("blocks");
    doc.transact(() => arr.insert(index, [makeBlock(type, withTests || (kind === "master" && type === "code"))]));
  }, [doc, kind]);

  const move = (index: number, delta: number) => {
    const arr = doc.getArray<Y.Map<unknown>>("blocks");
    const target = index + delta;
    if (target < 0 || target >= arr.length) return;
    // Yjs can't move items; copy the block's plain data into a fresh map.
    const src = arr.get(index);
    const copy = new Y.Map<unknown>();
    src.forEach((value, key) => {
      if (value instanceof Y.Text) copy.set(key, new Y.Text(value.toString()));
      else if (value instanceof Y.Array) {
        const tests = new Y.Array<Y.Map<unknown>>();
        tests.push((value as Y.Array<Y.Map<unknown>>).toArray().map(t => {
          const m = new Y.Map<unknown>();
          t.forEach((v, k) => m.set(k, v));
          return m;
        }));
        copy.set(key, tests);
      } else copy.set(key, value);
    });
    doc.transact(() => {
      arr.delete(index, 1);
      arr.insert(target, [copy]);
    });
  };

  const remove = (index: number) => {
    const arr = doc.getArray<Y.Map<unknown>>("blocks");
    doc.transact(() => arr.delete(index, 1));
  };

  // Numbering: graded problems in homework, tested blocks in the master.
  const problemNumbers = useMemo(() => {
    const numbers: Record<string, number> = {};
    let n = 0;
    for (const b of blocks) {
      if (b.get("type") !== "code") continue;
      const graded = kind === "master" ? readTests(b).length > 0 : !!b.get("graded");
      if (graded) numbers[String(b.get("id"))] = ++n;
    }
    return numbers;
  }, [blocks, kind]);

  if (status !== "connected" && blocks.length === 0) {
    return (
      <div className="flex items-center justify-center gap-3 py-16 text-[13px]" style={{ color: "var(--text-3)" }}>
        <span className="h-4 w-4 rounded-full border-2 animate-spin" style={{ borderColor: "var(--border-2)", borderTopColor: "transparent" }} />
        {status === "reconnecting" ? t("lessons.page.reconnecting", { defaultValue: "Reconnecting…" }) : t("lessons.page.loading", { defaultValue: "Opening the page…" })}
      </div>
    );
  }

  const addRow = (index: number) => canEditStructure && (
    <div className="nb-add-row">
      <button type="button" className="st-btn st-btn-ghost st-btn-sm" onClick={() => insertAt(index, "text")}><Plus className="h-3.5 w-3.5" />{t("lessons.page.addText", { defaultValue: "Text" })}</button>
      <button type="button" className="st-btn st-btn-ghost st-btn-sm" onClick={() => insertAt(index, "code")}><Plus className="h-3.5 w-3.5" />{t("lessons.page.addCode", { defaultValue: "Code" })}</button>
    </div>
  );

  return (
    <div className="nb-page">
      {status === "reconnecting" && (
        <div className="nb-banner">{t("lessons.page.offline", { defaultValue: "Connection lost. Your edits are kept and will sync when it's back." })}</div>
      )}
      {blocks.length === 0 && !canEditStructure && (
        <p className="text-[13px] py-8 text-center" style={{ color: "var(--text-3)" }}>{t("lessons.page.empty", { defaultValue: "This page is empty." })}</p>
      )}
      {blocks.map((block, index) => {
        const id = String(block.get("id"));
        const type = block.get("type") === "code" ? "code" : "text";
        const controls = canEditStructure && (
          <div className="nb-controls">
            <button type="button" className="st-icon-btn" style={{ width: 26, height: 26 }} title={t("lessons.page.moveUp", { defaultValue: "Move up" })} onClick={() => move(index, -1)} disabled={index === 0}><ArrowUp className="h-3.5 w-3.5" /></button>
            <button type="button" className="st-icon-btn" style={{ width: 26, height: 26 }} title={t("lessons.page.moveDown", { defaultValue: "Move down" })} onClick={() => move(index, 1)} disabled={index === blocks.length - 1}><ArrowDown className="h-3.5 w-3.5" /></button>
            <DeleteButton onDelete={() => remove(index)} />
          </div>
        );
        return (
          <React.Fragment key={id}>
            {index === 0 && addRow(0)}
            {type === "text" ? (
              <div className="nb-block nb-text">
                {controls}
                <BlockEditor
                  ytext={block.get("text") as Y.Text}
                  awareness={awareness}
                  language="text"
                  editable={canEditText}
                  placeholder={canEditText ? t("lessons.page.textPlaceholder", { defaultValue: "Write the task or an explanation…" }) : undefined}
                />
              </div>
            ) : (
              <CodeBlock
                block={block}
                blocks={blocks}
                index={index}
                awareness={awareness}
                kind={kind}
                problemNumber={problemNumbers[id]}
                result={results?.[id]}
                controls={controls}
              />
            )}
            {addRow(index + 1)}
          </React.Fragment>
        );
      })}
      {blocks.length === 0 && addRow(0)}
      {kind === "master" && canEditStructure && (
        <div className="flex justify-center pt-1">
          <button type="button" className="st-btn st-btn-secondary st-btn-sm" onClick={() => {
            const arr = doc.getArray<Y.Map<unknown>>("blocks");
            doc.transact(() => arr.push([makeBlock("text", false), makeBlock("code", true)]));
          }}>
            <Plus className="h-3.5 w-3.5" />{t("lessons.page.addProblem", { defaultValue: "Problem with tests" })}
          </button>
        </div>
      )}
    </div>
  );
};

const DeleteButton: React.FC<{ onDelete: () => void }> = ({ onDelete }) => {
  const { t } = useTranslation();
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const id = setTimeout(() => setArmed(false), 2500);
    return () => clearTimeout(id);
  }, [armed]);
  return armed ? (
    <button type="button" className="st-btn st-btn-sm" style={{ height: 26, background: "var(--rose-10)", color: "var(--rose)" }} onClick={onDelete}>
      {t("lessons.page.confirmDelete", { defaultValue: "Delete?" })}
    </button>
  ) : (
    <button type="button" className="st-icon-btn" style={{ width: 26, height: 26 }} title={t("lessons.page.delete", { defaultValue: "Delete block" })} onClick={() => setArmed(true)}>
      <Trash2 className="h-3.5 w-3.5" />
    </button>
  );
};

type OutLine = { text: string; type: "stdout" | "stderr" };

const CodeBlock: React.FC<{
  block: Y.Map<unknown>;
  blocks: Y.Map<unknown>[];
  index: number;
  awareness: import("y-protocols/awareness").Awareness | null;
  kind: PageKind;
  problemNumber?: number;
  result?: BlockResult;
  controls: React.ReactNode;
}> = ({ block, blocks, index, awareness, kind, problemNumber, result, controls }) => {
  const { t } = useTranslation();
  const [out, setOut] = useState<OutLine[] | null>(null);
  const [running, setRunning] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [input, setInput] = useState("");
  const handleRef = useRef<RunHandle | null>(null);
  const [checking, setChecking] = useState(false);
  const [check, setCheck] = useState<TestOutcome[] | null>(null);

  const codeBefore = () => blocks.slice(0, index)
    .filter(b => b.get("type") === "code")
    .map(b => (b.get("text") as Y.Text).toString());

  const run = () => {
    if (running) return;
    setOut([]);
    setRunning(true);
    setWaiting(false);
    const cells = [
      ...codeBefore().map((code, i) => ({ code, quiet: true, name: `block ${i + 1}` })),
      { code: (block.get("text") as Y.Text).toString(), name: "this block" },
    ];
    const handle = startRun({
      code: "",
      cells,
      onOutput: e => setOut(prev => [...(prev ?? []), { text: e.text, type: e.type }]),
      onInputRequest: () => setWaiting(true),
    });
    handleRef.current = handle;
    void handle.done.then(() => {
      if (handleRef.current === handle) handleRef.current = null;
      setRunning(false);
      setWaiting(false);
    });
  };

  const sendInput = () => {
    handleRef.current?.sendInput(input);
    setOut(prev => [...(prev ?? []), { text: input + "\n", type: "stdout" }]);
    setInput("");
    setWaiting(false);
  };

  useEffect(() => () => handleRef.current?.stop(), []);

  const runCheck = async () => {
    setChecking(true);
    try {
      setCheck(await gradeProblem(codeBefore(), (block.get("text") as Y.Text).toString(), readTests(block)));
    } finally {
      setChecking(false);
    }
  };

  const isMaster = kind === "master";
  const outcomes = result?.outcomes ?? null;

  return (
    <div className="nb-block nb-code">
      {controls}
      {problemNumber !== undefined && (
        <div className="nb-problem">
          <span className="nb-problem-num">{problemNumber}</span>
          {t("lessons.page.problem", { defaultValue: "Problem" })}
          {result && (
            <span className={`st-chip ${result.passed === result.total ? "nb-ok" : "nb-warn"}`} style={{ height: 22, fontSize: 11.5 }}>
              {t("lessons.page.testsPassed", { defaultValue: "{{passed}}/{{total}} tests", passed: result.passed, total: result.total })}
            </span>
          )}
        </div>
      )}
      <div className="nb-code-card">
        <div className="nb-code-row">
          <button
            type="button"
            className={`nb-run ${running ? "is-running" : ""}`}
            onClick={running ? () => handleRef.current?.stop() : run}
            title={running ? t("app.assignment.stop") : t("lessons.page.runHint", { defaultValue: "Run this block (and the blocks above it)" })}
            aria-label={running ? t("app.assignment.stop") : t("app.assignment.run")}
          >
            {running ? <Square className="h-3 w-3" fill="currentColor" /> : <Play className="h-3 w-3" fill="currentColor" />}
          </button>
          <BlockEditor
            ytext={block.get("text") as Y.Text}
            awareness={awareness}
            language="python"
            editable
            onRun={run}
            className="nb-editor"
            placeholder={isMaster ? t("lessons.page.solutionPlaceholder", { defaultValue: "Your solution (students never see it)" }) : undefined}
          />
        </div>
        {out !== null && (
          <div className="nb-out">
            {out.length === 0 && !running && <span style={{ color: "var(--term-dim)" }}>{t("lessons.page.noOutput", { defaultValue: "(no output)" })}</span>}
            {out.map((l, i) => <span key={i} style={{ color: l.type === "stderr" ? "var(--term-err)" : undefined }}>{l.text}</span>)}
            {waiting && (
              <input
                autoFocus
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); sendInput(); } }}
                className="nb-input"
                aria-label={t("app.assignment.waitingForInput")}
              />
            )}
            {running && !waiting && <span className="nb-caret" />}
            {!running && (
              <button type="button" className="nb-out-close" onClick={() => setOut(null)} aria-label={t("common.close")}><X className="h-3 w-3" /></button>
            )}
          </div>
        )}
        {isMaster && (
          <MasterExtras block={block} awareness={awareness} checking={checking} check={check} onCheck={runCheck} />
        )}
        {!isMaster && (outcomes || (result?.failures && result.failures.length > 0)) && (
          <div className="nb-tests">
            {outcomes
              ? outcomes.map(o => <TestRow key={o.test.id} label={o.test.hidden ? t("lessons.page.hiddenTest", { defaultValue: "Hidden test" }) : o.test.kind === "io" ? `${t("lessons.page.input", { defaultValue: "input" })}: ${o.test.stdin.replace(/\n/g, " ⏎ ")}` : o.test.call} ok={o.ok} expected={o.test.hidden ? "" : o.test.expected} got={o.test.hidden || o.ok ? "" : o.got} />)
              : result?.failures?.map((f, i) => <TestRow key={i} label={f.label} ok={false} expected={f.expected} got={f.got} />)}
          </div>
        )}
      </div>
    </div>
  );
};

const TestRow: React.FC<{ label: string; ok: boolean | null; expected: string; got: string }> = ({ label, ok, expected, got }) => {
  const { t } = useTranslation();
  return (
    <div className="nb-test">
      <span className={`nb-test-ic ${ok === null ? "" : ok ? "ok" : "bad"}`}>
        {ok === null ? <CircleDashed className="h-3 w-3" /> : ok ? <Check className="h-3 w-3" strokeWidth={3} /> : <X className="h-3 w-3" strokeWidth={3} />}
      </span>
      <span className="nb-test-label">{label}{expected ? <span style={{ color: "var(--text-3)" }}> → {expected}</span> : null}</span>
      {got && <span className="nb-test-got">{t("lessons.page.got", { defaultValue: "got" })} <b>{got}</b></span>}
    </div>
  );
};

/** Master only: starter code students begin with, and the tests. */
const MasterExtras: React.FC<{
  block: Y.Map<unknown>;
  awareness: import("y-protocols/awareness").Awareness | null;
  checking: boolean;
  check: TestOutcome[] | null;
  onCheck: () => void;
}> = ({ block, awareness, checking, check, onCheck }) => {
  const { t } = useTranslation();
  const [, force] = useState(0);
  let starter = block.get("starter") as Y.Text | undefined;
  let tests = block.get("tests") as Y.Array<Y.Map<unknown>> | undefined;
  if (!starter || !tests) {
    // Older code blocks on a master page: add the fields on first use.
    starter = starter ?? new Y.Text();
    tests = tests ?? new Y.Array<Y.Map<unknown>>();
    const s = starter, ts = tests;
    queueMicrotask(() => {
      if (!block.get("starter")) block.set("starter", s);
      if (!block.get("tests")) block.set("tests", ts);
    });
  }
  useEffect(() => {
    const arr = block.get("tests") as Y.Array<Y.Map<unknown>> | undefined;
    if (!arr) return;
    const update = () => force(n => n + 1);
    arr.observeDeep(update);
    return () => arr.unobserveDeep(update);
  }, [block, tests]);

  const items = tests.toArray();
  const add = (kind: "call" | "io") => {
    const m = new Y.Map<unknown>();
    m.set("id", newId());
    m.set("kind", kind);
    m.set("call", "");
    m.set("expected", "");
    m.set("stdin", "");
    m.set("hidden", false);
    tests!.push([m]);
  };
  const checkById = new Map((check ?? []).map(o => [o.test.id, o]));

  return (
    <div className="nb-master">
      <div className="nb-master-label">{t("lessons.page.starter", { defaultValue: "Students start with" })}</div>
      <div className="nb-starter">
        <BlockEditor ytext={starter} awareness={awareness} language="python" editable placeholder={t("lessons.page.starterPlaceholder", { defaultValue: "Empty, or a skeleton like  def add(a, b):" })} />
      </div>
      <div className="nb-master-label">{t("lessons.page.tests", { defaultValue: "Tests" })}</div>
      {items.length === 0 && <p className="text-[12.5px]" style={{ color: "var(--text-3)" }}>{t("lessons.page.noTests", { defaultValue: "No tests: this block is practice, not graded." })}</p>}
      {items.map((test, i) => {
        const kind = test.get("kind") === "io" ? "io" : "call";
        const id = String(test.get("id"));
        const outcome = checkById.get(id);
        const field = (key: string, placeholder: string, mono = true) => (
          <input
            className="st-input nb-test-input"
            style={{ fontFamily: mono ? "var(--mono)" : undefined }}
            defaultValue={String(test.get(key) ?? "")}
            placeholder={placeholder}
            onChange={e => test.set(key, e.target.value)}
            aria-label={placeholder}
          />
        );
        return (
          <div key={id} className="nb-test-edit">
            <span className={`nb-test-ic ${outcome ? (outcome.ok ? "ok" : "bad") : ""}`}>{outcome ? (outcome.ok ? <Check className="h-3 w-3" strokeWidth={3} /> : <X className="h-3 w-3" strokeWidth={3} />) : i + 1}</span>
            {kind === "call" ? field("call", "add(2, 3)") : field("stdin", t("lessons.page.stdinPlaceholder", { defaultValue: "input lines, e.g. Aru" }))}
            <span style={{ color: "var(--text-3)" }}>→</span>
            {field("expected", kind === "call" ? "5" : t("lessons.page.expectedOutput", { defaultValue: "expected output" }))}
            <button type="button" className="st-icon-btn" style={{ width: 28, height: 28 }} onClick={() => test.set("hidden", !test.get("hidden"))} title={test.get("hidden") ? t("lessons.page.hiddenFromStudents", { defaultValue: "Hidden from students (graded, not shown)" }) : t("lessons.page.shownToStudents", { defaultValue: "Shown to students" })}>
              {test.get("hidden") ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            </button>
            <button type="button" className="st-icon-btn" style={{ width: 28, height: 28 }} onClick={() => tests!.delete(i, 1)} title={t("lessons.page.removeTest", { defaultValue: "Remove test" })}><Trash2 className="h-3.5 w-3.5" /></button>
            {outcome && !outcome.ok && <span className="nb-test-got" style={{ gridColumn: "2 / -1" }}>{t("lessons.page.got", { defaultValue: "got" })} <b>{outcome.got}</b></span>}
          </div>
        );
      })}
      <div className="flex flex-wrap gap-2 pt-1">
        <button type="button" className="st-btn st-btn-ghost st-btn-sm" onClick={() => add("call")}><Plus className="h-3.5 w-3.5" />{t("lessons.page.addCallTest", { defaultValue: "Function check" })}</button>
        <button type="button" className="st-btn st-btn-ghost st-btn-sm" onClick={() => add("io")}><Plus className="h-3.5 w-3.5" />{t("lessons.page.addIoTest", { defaultValue: "Input → output" })}</button>
        {items.length > 0 && (
          <button type="button" className="st-btn st-btn-secondary st-btn-sm" onClick={onCheck} disabled={checking}>
            {checking ? t("lessons.page.checking", { defaultValue: "Checking…" }) : t("lessons.page.checkSolution", { defaultValue: "Check with my solution" })}
          </button>
        )}
      </div>
    </div>
  );
};
