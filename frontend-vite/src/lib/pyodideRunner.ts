/**
 * Runs student Python in the browser, inside a Web Worker (public/py-worker.js).
 *
 * Security model: the server never executes user code. Everything runs in
 * the student's own tab, in Pyodide's WebAssembly sandbox, off the main
 * thread. A runaway program is interrupted (Stop / timeout) and, if it
 * doesn't stop, the whole worker is killed and replaced.
 *
 * Interactive input() and instant Stop need SharedArrayBuffer, which the
 * browser only offers on cross-origin isolated pages (COOP/COEP headers set
 * by the server and by the Vite dev server). Without isolation, programs
 * still run; input() just receives end-of-input.
 */

export type RunOutput = { type: "stdout" | "stderr"; text: string };

export type RunResult = {
  status: "success" | "error" | "timeout";
  stdout: string;
  stderr: string;
  exit_code: number;
  elapsed: number;
};

export type SubmissionResult = RunResult & {
  test_passed: boolean | null;
  test_output: string;
};

export type RunHandle = {
  /** Resolves when the program finishes, fails, is stopped, or times out. */
  done: Promise<RunResult>;
  /** Answer a pending input() call. `null` sends end-of-input. */
  sendInput: (line: string | null) => void;
  /** Stop the program (KeyboardInterrupt; the worker is killed if it doesn't stop). */
  stop: () => void;
};

type StartOpts = {
  code: string;
  /** Lines fed to input() first, before asking the user. */
  stdinLines?: string[];
  /** When false, input() past `stdinLines` gets end-of-input instead of asking. */
  interactive?: boolean;
  onOutput?: (e: RunOutput) => void;
  /** The program is waiting in input(); answer with handle.sendInput(). */
  onInputRequest?: () => void;
  /** Wall-clock limit, excluding time spent waiting for typed input. */
  timeoutMs?: number;
};

type ProgressEvent = { kind: "loading"; message: string } | { kind: "ready" } | { kind: "failed"; message: string };
type ProgressListener = (e: ProgressEvent) => void;

const WORKER_URL = "/py-worker.js";
const INPUT_BYTES = 64 * 1024;
/** How long a stopped program gets to unwind before its worker is killed. */
const STOP_GRACE_MS = 800;

const progressListeners = new Set<ProgressListener>();
function emitProgress(e: ProgressEvent): void {
  for (const fn of progressListeners) fn(e);
}

export function onPyodideProgress(listener: ProgressListener): () => void {
  progressListeners.add(listener);
  return () => progressListeners.delete(listener);
}

/** True when typed input() and instant Stop are available on this page. */
export function isInteractiveInputSupported(): boolean {
  return typeof SharedArrayBuffer !== "undefined" && (globalThis as { crossOriginIsolated?: boolean }).crossOriginIsolated === true;
}

// ── Worker lifecycle ──────────────────────────────────────────────────────

type Shared = { ctrl: Int32Array; data: Uint8Array; interrupt: Uint8Array } | null;

type ActiveRun = {
  id: number;
  stdout: string[];
  stderr: string[];
  opts: StartOpts;
  awaitingInput: boolean;
  settled: boolean;
  resolve: (r: RunResult) => void;
  startedAt: number;
  killTimer: ReturnType<typeof setTimeout> | null;
  timeoutTimer: ReturnType<typeof setTimeout> | null;
  timedOut: boolean;
};

let worker: Worker | null = null;
let shared: Shared = null;
let ready = false;
let nextRunId = 1;
let active: ActiveRun | null = null;

function spawnWorker(): Worker {
  const w = new Worker(WORKER_URL);
  ready = false;
  shared = null;
  const init: Record<string, unknown> = { type: "init" };
  if (isInteractiveInputSupported()) {
    const ctrlBuf = new SharedArrayBuffer(8);
    const dataBuf = new SharedArrayBuffer(INPUT_BYTES);
    const intBuf = new SharedArrayBuffer(1);
    shared = { ctrl: new Int32Array(ctrlBuf), data: new Uint8Array(dataBuf), interrupt: new Uint8Array(intBuf) };
    init.ctrl = ctrlBuf;
    init.data = dataBuf;
    init.interrupt = intBuf;
  }
  w.onmessage = (ev: MessageEvent) => handleMessage(w, ev.data);
  w.onerror = () => {
    if (worker !== w) return;
    emitProgress({ kind: "failed", message: "The Python runtime stopped unexpectedly." });
    finishActive({ status: "error", exit_code: 1 }, "\n[The Python runtime stopped unexpectedly.]\n");
    killWorker();
  };
  w.postMessage(init);
  return w;
}

function getWorker(): Worker {
  if (!worker) worker = spawnWorker();
  return worker;
}

function killWorker(): void {
  if (worker) worker.terminate();
  worker = null;
  ready = false;
  shared = null;
}

function handleMessage(from: Worker, msg: any): void {
  if (from !== worker || !msg) return;
  switch (msg.type) {
    case "loading":
      emitProgress({ kind: "loading", message: "Loading Python…" });
      return;
    case "ready":
      ready = true;
      emitProgress({ kind: "ready" });
      return;
    case "load_error":
      emitProgress({ kind: "failed", message: msg.message });
      return;
  }
  const run = active;
  if (!run || msg.id !== run.id || run.settled) return;
  if (msg.type === "stdout" || msg.type === "stderr") {
    (msg.type === "stdout" ? run.stdout : run.stderr).push(msg.text);
    run.opts.onOutput?.({ type: msg.type, text: msg.text });
  } else if (msg.type === "input_request") {
    run.awaitingInput = true;
    pauseTimeout(run);
    run.opts.onInputRequest?.();
  } else if (msg.type === "done") {
    finishActive({ status: run.timedOut ? "timeout" : msg.status, exit_code: msg.exit_code, elapsed: msg.elapsed });
  }
}

function finishActive(r: { status: RunResult["status"]; exit_code: number; elapsed?: number }, note?: string): void {
  const run = active;
  if (!run || run.settled) return;
  run.settled = true;
  if (run.killTimer) clearTimeout(run.killTimer);
  if (run.timeoutTimer) clearTimeout(run.timeoutTimer);
  if (note) {
    run.stderr.push(note);
    run.opts.onOutput?.({ type: "stderr", text: note });
  }
  active = null;
  run.resolve({
    status: r.status,
    stdout: run.stdout.join(""),
    stderr: run.stderr.join(""),
    exit_code: r.exit_code,
    elapsed: r.elapsed ?? Math.round(performance.now() - run.startedAt) / 1000,
  });
}

function armTimeout(run: ActiveRun): void {
  const ms = run.opts.timeoutMs;
  if (!ms || run.timeoutTimer) return;
  run.timeoutTimer = setTimeout(() => {
    run.timeoutTimer = null;
    run.timedOut = true;
    stopRun(run, "\n[Time limit reached. The program was stopped.]\n");
  }, ms);
}

function pauseTimeout(run: ActiveRun): void {
  if (run.timeoutTimer) clearTimeout(run.timeoutTimer);
  run.timeoutTimer = null;
}

function stopRun(run: ActiveRun, note: string): void {
  if (run.settled) return;
  if (note) {
    run.stderr.push(note);
    run.opts.onOutput?.({ type: "stderr", text: note });
  }
  const sh = shared;
  if (sh) {
    // Ask Python to raise KeyboardInterrupt, and release a pending input().
    sh.interrupt[0] = 2;
    Atomics.store(sh.ctrl, 0, 2);
    Atomics.notify(sh.ctrl, 0);
    run.killTimer = setTimeout(() => hardKill(run), STOP_GRACE_MS);
  } else {
    hardKill(run);
  }
}

function hardKill(run: ActiveRun): void {
  if (run.settled) return;
  killWorker();
  finishActive({ status: run.timedOut ? "timeout" : "error", exit_code: 130 });
  // Start a fresh runtime in the background so the next Run is quick.
  getWorker();
}

/** Start running `code`. Any program still running is stopped first. */
export function startRun(opts: StartOpts): RunHandle {
  if (active) {
    const prev = active;
    stopRun(prev, "");
    hardKill(prev);
  }
  const w = getWorker();
  const id = nextRunId++;
  let resolve!: (r: RunResult) => void;
  const done = new Promise<RunResult>((r) => { resolve = r; });
  const run: ActiveRun = {
    id, stdout: [], stderr: [], opts, awaitingInput: false, settled: false,
    resolve, startedAt: performance.now(), killTimer: null, timeoutTimer: null, timedOut: false,
  };
  active = run;
  armTimeout(run);
  w.postMessage({ type: "run", id, code: opts.code, stdin: opts.stdinLines ?? [], interactive: opts.interactive !== false });

  const encoder = new TextEncoder();
  return {
    done,
    sendInput: (line) => {
      if (run.settled || !run.awaitingInput) return;
      const sh = shared;
      if (!sh) return;
      run.awaitingInput = false;
      if (line === null) {
        Atomics.store(sh.ctrl, 0, 2);
      } else {
        const bytes = encoder.encode(line).subarray(0, sh.data.length);
        sh.data.set(bytes);
        Atomics.store(sh.ctrl, 1, bytes.length);
        Atomics.store(sh.ctrl, 0, 1);
      }
      Atomics.notify(sh.ctrl, 0);
      armTimeout(run);
    },
    stop: () => stopRun(run, ""),
  };
}

// ── Convenience wrappers (kept compatible with earlier callers) ───────────

/** Eagerly download and start the Python runtime. Safe to call repeatedly. */
export function warmupPyodide(): void {
  getWorker();
}

export function isPyodideReady(): boolean {
  return ready;
}

type InteractiveOpts = {
  code: string;
  stdinLines?: string[];
  onOutput?: (e: RunOutput) => void;
  timeoutMs?: number;
  /**
   * Answer an input() call synchronously (e.g. with window.prompt). Return
   * null for end of input. The answer is echoed into the output.
   */
  onStdinRequest?: (promptText: string) => string | null;
};

/** Run to completion, answering input() through `onStdinRequest`. */
export function runInteractive(opts: InteractiveOpts): Promise<RunResult> {
  let lastStdout = "";
  const handle = startRun({
    code: opts.code,
    stdinLines: opts.stdinLines,
    interactive: !!opts.onStdinRequest,
    timeoutMs: opts.timeoutMs,
    onOutput: (e) => {
      if (e.type === "stdout") lastStdout = e.text;
      opts.onOutput?.(e);
    },
    onInputRequest: () => {
      const answer = opts.onStdinRequest ? opts.onStdinRequest(lastStdout.trim()) : null;
      if (answer !== null) opts.onOutput?.({ type: "stdout", text: answer + "\n" });
      handle.sendInput(answer);
    },
  });
  return handle.done;
}

/**
 * Run student code, then (if present) the assignment's tests appended to it,
 * each in a fresh namespace with a 10s limit. input() is fed from
 * `stdinLines` only. Grading happens here in the browser; the server just
 * stores the result.
 */
export async function runForSubmission(
  code: string,
  testCode: string | null | undefined,
  stdinLines: string[] = [],
): Promise<SubmissionResult> {
  const studentRun = await startRun({ code, stdinLines, interactive: false, timeoutMs: 10_000 }).done;

  let test_passed: boolean | null = null;
  let test_output = "";
  if (testCode && testCode.trim()) {
    const combined = code + "\n\n# === auto-grader ===\n" + testCode;
    const testRun = await startRun({ code: combined, stdinLines, interactive: false, timeoutMs: 10_000 }).done;
    test_passed = testRun.status === "success";
    test_output = (testRun.stdout || "") + (testRun.stderr || "");
  }

  return { ...studentRun, test_passed, test_output };
}
