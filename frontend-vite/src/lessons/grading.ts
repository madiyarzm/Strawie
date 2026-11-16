/**
 * Homework grading, in the browser.
 *
 * Each test runs in a fresh Python namespace: the code blocks above the
 * problem (quietly), then the problem's code, then the check.
 *   call: evaluates `call` and `expected` as Python and compares with ==
 *   io:   feeds `stdin` lines to the program and compares its printed output
 *
 * The server never runs code; it only stores what this reports. A student
 * could fake a result, which is an accepted trade-off.
 */

import { startRun } from "../lib/pyodideRunner";
import type { RunCell } from "../lib/pyodideRunner";
import type { Failure, HomeworkTest, ProblemResult } from "./api";

const TIME_LIMIT_MS = 10_000;

export type TestOutcome = { test: HomeworkTest; ok: boolean; got: string };

function oneLine(s: string): string {
  return s.replace(/\r?\n/g, " ").trim();
}

function normalizeOutput(s: string): string {
  return s.replace(/\r\n/g, "\n").split("\n").map(l => l.replace(/\s+$/, "")).join("\n").replace(/\n+$/, "");
}

function lastErrorLine(stderr: string): string {
  const lines = stderr.trim().split("\n").filter(Boolean);
  return lines[lines.length - 1] || "error";
}

async function runCallTest(before: string[], code: string, test: HomeworkTest): Promise<TestOutcome> {
  const mark = `@@STRAWIE_${Math.random().toString(36).slice(2)}@@`;
  const check = [
    "import json as __j",
    "try:",
    `    __r = (${oneLine(test.call)})`,
    `    __e = (${oneLine(test.expected)})`,
    `    print(${JSON.stringify(mark)} + __j.dumps({"ok": bool(__r == __e), "got": repr(__r)[:300]}))`,
    "except BaseException as __x:",
    `    print(${JSON.stringify(mark)} + __j.dumps({"ok": False, "got": type(__x).__name__ + ": " + str(__x)[:300]}))`,
  ].join("\n");
  const cells: RunCell[] = [
    ...before.map((c, i) => ({ code: c, quiet: true, name: `block ${i + 1}` })),
    { code, quiet: true, name: "your code" },
    { code: check, name: "test" },
  ];
  const result = await startRun({ code: "", cells, interactive: false, timeoutMs: TIME_LIMIT_MS }).done;
  const line = result.stdout.split("\n").find(l => l.startsWith(mark));
  if (!line) {
    const got = result.status === "timeout" ? "took too long (infinite loop?)" : lastErrorLine(result.stderr);
    return { test, ok: false, got };
  }
  try {
    const parsed = JSON.parse(line.slice(mark.length)) as { ok: boolean; got: string };
    return { test, ok: !!parsed.ok, got: parsed.got };
  } catch {
    return { test, ok: false, got: "could not read the result" };
  }
}

async function runIoTest(before: string[], code: string, test: HomeworkTest): Promise<TestOutcome> {
  const cells: RunCell[] = [
    ...before.map((c, i) => ({ code: c, quiet: true, name: `block ${i + 1}` })),
    { code, name: "your code" },
  ];
  const stdinLines = test.stdin ? test.stdin.replace(/\r\n/g, "\n").split("\n") : [];
  const result = await startRun({ code: "", cells, stdinLines, interactive: false, timeoutMs: TIME_LIMIT_MS }).done;
  if (result.status !== "success") {
    const got = result.status === "timeout" ? "took too long (infinite loop?)" : lastErrorLine(result.stderr);
    return { test, ok: false, got };
  }
  const got = normalizeOutput(result.stdout);
  return { test, ok: got === normalizeOutput(test.expected), got: got.slice(0, 300) };
}

/** Run every test of one problem. `before` = code of the blocks above it. */
export async function gradeProblem(before: string[], code: string, tests: HomeworkTest[]): Promise<TestOutcome[]> {
  const outcomes: TestOutcome[] = [];
  for (const test of tests) {
    outcomes.push(test.kind === "io" ? await runIoTest(before, code, test) : await runCallTest(before, code, test));
  }
  return outcomes;
}

/** What gets sent to the server: counts plus details of visible failures only. */
export function toProblemResult(outcomes: TestOutcome[]): ProblemResult {
  const failures: Failure[] = outcomes
    .filter(o => !o.ok)
    .slice(0, 20)
    .map(o => ({
      test_id: o.test.id.slice(0, 32),
      label: o.test.hidden ? "Hidden test" : (o.test.kind === "io" ? `input: ${oneLine(o.test.stdin)}` : o.test.call).slice(0, 300),
      expected: o.test.hidden ? "" : o.test.expected.slice(0, 500),
      got: o.test.hidden ? "" : o.got.slice(0, 500),
    }));
  return { passed: outcomes.filter(o => o.ok).length, total: outcomes.length, failures };
}
