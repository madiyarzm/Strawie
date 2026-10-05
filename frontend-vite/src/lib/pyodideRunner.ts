/**
 * Pyodide-based Python runner. Executes student code in the browser's
 * WebAssembly sandbox instead of on the server.
 *
 * Pyodide is loaded from CDN on first use (~10MB, cached by the browser).
 * stdin is fed from a pre-supplied queue of lines; once exhausted, input()
 * returns "" (empty line).
 */

const PYODIDE_VERSION = "0.27.5";
const PYODIDE_CDN = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;

// Subresource Integrity hash for the pyodide.js loader. The browser refuses
// to execute the file if its actual SHA-384 doesn't match this string — so
// a compromised CDN serving a malicious loader is blocked.
//
// Important caveats:
//   * Pyodide's loader internally fetch()es pyodide.asm.wasm, .asm.js, and
//     python_stdlib.zip. Those sub-fetches are NOT SRI-verified — Pyodide
//     upstream doesn't ship a manifest. SRI here protects the entry point;
//     full integrity requires self-hosting.
//   * When bumping PYODIDE_VERSION above, you MUST regenerate this hash:
//       curl -fsSL https://cdn.jsdelivr.net/pyodide/v<NEW>/full/pyodide.js \
//         | openssl dgst -sha384 -binary | openssl base64 -A
//     Otherwise the loader will fail to start and Pyodide won't work.
const PYODIDE_INTEGRITY =
  "sha384-rm4QcPMX69sqmX2kWiJa3BF02sgdJkVyATWkw5NHAxBUAvmLXhToWZYaP2wCcyEe";

declare global {
  interface Window {
    loadPyodide?: (opts: { indexURL: string }) => Promise<any>;
  }
}

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

type ProgressEvent =
  | { kind: "loading"; message: string }
  | { kind: "ready" };

type ProgressListener = (e: ProgressEvent) => void;

let pyodidePromise: Promise<any> | null = null;
const progressListeners = new Set<ProgressListener>();

function emitProgress(e: ProgressEvent): void {
  for (const fn of progressListeners) fn(e);
}

export function onPyodideProgress(listener: ProgressListener): () => void {
  progressListeners.add(listener);
  return () => progressListeners.delete(listener);
}

export function isPyodideReady(): boolean {
  return pyodidePromise !== null && (pyodidePromise as any)._resolved === true;
}

function loadScript(src: string, integrity?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error("Failed to load Pyodide")));
      // If already loaded:
      if ((existing as HTMLScriptElement).dataset.loaded === "true") resolve();
      return;
    }
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    // SRI: browser refuses to execute the script if its hash doesn't match
    // `integrity`. `crossOrigin="anonymous"` is required for SRI on
    // cross-origin scripts — without it the browser can't read the body
    // to verify the hash.
    if (integrity) {
      s.integrity = integrity;
      s.crossOrigin = "anonymous";
    }
    s.onload = () => {
      s.dataset.loaded = "true";
      resolve();
    };
    s.onerror = () => reject(new Error("Failed to load Pyodide (integrity check or network)"));
    document.head.appendChild(s);
  });
}

async function loadPyodideOnce(): Promise<any> {
  if (pyodidePromise) return pyodidePromise;
  emitProgress({ kind: "loading", message: "Loading Python runtime…" });
  pyodidePromise = (async () => {
    await loadScript(`${PYODIDE_CDN}pyodide.js`, PYODIDE_INTEGRITY);
    if (!window.loadPyodide) throw new Error("Pyodide failed to expose loadPyodide");
    const py = await window.loadPyodide({ indexURL: PYODIDE_CDN });
    (pyodidePromise as any)._resolved = true;
    emitProgress({ kind: "ready" });
    return py;
  })();
  return pyodidePromise;
}

/** Eagerly trigger Pyodide download. Safe to call multiple times. */
export function warmupPyodide(): void {
  void loadPyodideOnce();
}

type RunOpts = {
  code: string;
  stdinLines?: string[];
  onOutput?: (e: RunOutput) => void;
  /** Hard wall-clock timeout in ms. Default 10s. */
  timeoutMs?: number;
  /**
   * Called when the program hits `input()` and the pre-supplied `stdinLines`
   * queue is empty. Must return the line SYNCHRONOUSLY, because CPython's
   * `input()` is a blocking call and Pyodide runs on the main thread -- there
   * is no point at which we could await a promise and resume the interpreter.
   *
   * A synchronous `window.prompt()` is the one browser API that satisfies
   * this. Returning null means "no more input", which Python sees as EOF.
   *
   * (The alternative -- Pyodide in a worker with SharedArrayBuffer and
   * Atomics.wait -- gives in-page input but needs cross-origin isolation,
   * which conflicts with loading Pyodide from the CDN.)
   */
  onStdinRequest?: (promptText: string) => string | null;
};

async function runWithIO(opts: RunOpts): Promise<RunResult> {
  const py = await loadPyodideOnce();
  const start = performance.now();

  const stdoutBuf: string[] = [];
  const stderrBuf: string[] = [];
  const queue = [...(opts.stdinLines ?? [])];

  // Pyodide writes the `input()` prompt to stdout just before reading stdin,
  // so the most recent stdout chunk is our best guess at the prompt text.
  // Declared before setStdout because that callback closes over it.
  // Note: `batched` only flushes on a newline, and a prompt like
  // "Name? " has none -- so this can legitimately still be empty when
  // stdin is read. Callers must cope with an empty promptText.
  let lastStdoutChunk = "";

  py.setStdout({
    batched: (s: string) => {
      lastStdoutChunk = s;
      stdoutBuf.push(s + "\n");
      opts.onOutput?.({ type: "stdout", text: s + "\n" });
    },
  });
  py.setStderr({
    batched: (s: string) => {
      stderrBuf.push(s + "\n");
      opts.onOutput?.({ type: "stderr", text: s + "\n" });
    },
  });
  py.setStdin({
    stdin: (): string | null => {
      // One call of this callback must supply exactly one line.
      //
      // This relies on `autoEOF: true` below. With autoEOF disabled, Pyodide
      // keeps calling back until its 2048-byte buffer fills -- a newline does
      // NOT end the read -- so an interactive handler would open 2048 prompts
      // for a single `input()`. autoEOF inserts the EOF that terminates each
      // read, so one callback return answers one `input()`.
      //
      // Returning "" means end of input.
      if (queue.length > 0) {
        return queue.shift() as string;
      }

      // No queued input and no interactive handler: signal EOF rather than
      // hanging, which is what callers passing a finite stdinLines expect.
      if (!opts.onStdinRequest) {
        return "";
      }

      const answer = opts.onStdinRequest(lastStdoutChunk.trim());
      // The user cancelled the prompt. Returning null is EOF, so `input()`
      // raises EOFError and the program ends instead of prompting forever.
      if (answer === null) {
        return null;
      }
      // Echo the typed line into the transcript, otherwise the output reads
      // as if the prompt answered itself.
      opts.onOutput?.({ type: "stdout", text: answer + "\n" });
      return answer;
    },
    // See the note above: this must stay true or interactive input loops.
    autoEOF: true,
  });

  // Watchdog: Pyodide on main thread can't be killed mid-execution, but we
  // can at least report timeout to the caller.
  const timeoutMs = opts.timeoutMs ?? 10_000;
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    py.checkInterrupt?.();
  }, timeoutMs);

  let status: RunResult["status"] = "success";
  let exitCode = 0;
  try {
    await py.runPythonAsync(opts.code);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    stderrBuf.push(msg + "\n");
    opts.onOutput?.({ type: "stderr", text: msg + "\n" });
    status = timedOut ? "timeout" : "error";
    exitCode = 1;
  } finally {
    clearTimeout(timer);
  }

  return {
    status,
    stdout: stdoutBuf.join(""),
    stderr: stderrBuf.join(""),
    exit_code: exitCode,
    elapsed: parseFloat(((performance.now() - start) / 1000).toFixed(2)),
  };
}

export function runInteractive(opts: RunOpts): Promise<RunResult> {
  return runWithIO(opts);
}

/**
 * Run student code, then the assignment's test_code (if present) appended
 * to the student code, in a fresh interpreter scope. Returns one result
 * for the student run plus test_passed/test_output for grading.
 */
export async function runForSubmission(
  code: string,
  testCode: string | null | undefined,
  stdinLines: string[] = [],
): Promise<SubmissionResult> {
  const studentRun = await runWithIO({ code, stdinLines });

  let test_passed: boolean | null = null;
  let test_output = "";

  if (testCode && testCode.trim()) {
    const combined = code + "\n\n# === auto-grader ===\n" + testCode;
    const testRun = await runWithIO({ code: combined, stdinLines });
    test_passed = testRun.status === "success";
    test_output = (testRun.stdout || "") + (testRun.stderr || "");
  }

  return {
    ...studentRun,
    test_passed,
    test_output,
  };
}
