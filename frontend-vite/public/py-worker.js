/*
 * Python runner worker (Pyodide).
 *
 * All student code runs here, inside the student's own browser. The server
 * never executes user code. A worker keeps the page responsive while Python
 * runs and can be killed outright if a program never stops.
 *
 * Protocol (postMessage):
 *   main → worker  {type: "init", ctrl, data, interrupt}   shared buffers (optional)
 *   main → worker  {type: "run", id, code, stdin: string[], interactive: bool}
 *                  or {type: "run", id, cells: [{code, quiet, name}], ...}
 *                  Cells share one namespace (notebook pages). Output of
 *                  quiet cells is hidden; errors in any cell are shown and
 *                  stop the run. `name` labels tracebacks ("block 3").
 *   worker → main  {type: "loading"} | {type: "ready"} | {type: "load_error", message}
 *   worker → main  {type: "stdout" | "stderr", id, text}
 *   worker → main  {type: "input_request", id}
 *   worker → main  {type: "done", id, status, exit_code, elapsed}
 *
 * Interactive input() needs SharedArrayBuffer, i.e. a cross-origin isolated
 * page (COOP/COEP headers). The main thread writes the typed line into
 * `data`, its byte length into ctrl[1], and flips ctrl[0]:
 *   0 = waiting, 1 = line ready, 2 = end of input (Stop pressed)
 * Without isolation, input() gets end-of-input and a short notice instead.
 *
 * This is a plain classic worker (served from /public, not bundled) so it can
 * use importScripts for Pyodide's own interpreter files.
 */
/* eslint-disable */
"use strict";

const PYODIDE_VERSION = "0.27.5";
const INDEX_URL = "https://cdn.jsdelivr.net/pyodide/v" + PYODIDE_VERSION + "/full/";

// SHA-384 of pyodide.js for the version above. The loader is fetched, hashed,
// and only executed if it matches, so a tampered CDN file never runs.
// When bumping PYODIDE_VERSION, regenerate:
//   curl -fsSL https://cdn.jsdelivr.net/pyodide/v<NEW>/full/pyodide.js \
//     | openssl dgst -sha384 -binary | openssl base64 -A
const LOADER_SHA384 = "rm4QcPMX69sqmX2kWiJa3BF02sgdJkVyATWkw5NHAxBUAvmLXhToWZYaP2wCcyEe";

// Hard cap on output per run so a print loop can't freeze the tab.
const MAX_OUTPUT_CHARS = 1000000;

let pyodide = null;
let loadPromise = null;
let ctrl = null; // Int32Array over SharedArrayBuffer: [state, byteLength]
let data = null; // Uint8Array over SharedArrayBuffer: the typed line
let interrupt = null; // Uint8Array over SharedArrayBuffer: Pyodide interrupt flag

let runId = 0;
let outputChars = 0;
let outputCapped = false;
let stdinQueue = [];
let interactive = false;
let warnedNoInput = false;
let quiet = false; // current cell's output is hidden
const decoder = new TextDecoder();
const lineDecoder = new TextDecoder();

function toBase64(buf) {
  const bytes = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

async function load() {
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    postMessage({ type: "loading" });
    const res = await fetch(INDEX_URL + "pyodide.js", { credentials: "omit" });
    if (!res.ok) throw new Error("Could not download the Python runtime (HTTP " + res.status + ").");
    const buf = await res.arrayBuffer();
    const digest = await crypto.subtle.digest("SHA-384", buf);
    if (toBase64(digest) !== LOADER_SHA384) {
      throw new Error("The Python runtime failed its integrity check and was not started.");
    }
    const url = URL.createObjectURL(new Blob([buf], { type: "text/javascript" }));
    try {
      importScripts(url);
    } finally {
      URL.revokeObjectURL(url);
    }
    const py = await self.loadPyodide({ indexURL: INDEX_URL });

    py.setStdout({ write: (buf) => emit("stdout", decoder.decode(buf, { stream: true }), buf.length) });
    py.setStderr({ write: (buf) => emit("stderr", decoder.decode(buf, { stream: true }), buf.length) });
    py.setStdin({ stdin: readLine, autoEOF: true });
    if (interrupt) py.setInterruptBuffer(interrupt);

    pyodide = py;
    postMessage({ type: "ready" });
    return py;
  })();
  return loadPromise;
}

function emit(type, text, length) {
  if (outputCapped || quiet) return length;
  outputChars += text.length;
  if (outputChars > MAX_OUTPUT_CHARS) {
    outputCapped = true;
    postMessage({ type: "stderr", id: runId, text: "\n[Output limit reached. The program was stopped.]\n" });
    // Throwing here surfaces as an OSError inside Python and ends the program.
    throw new Error("output limit");
  }
  if (text) postMessage({ type, id: runId, text });
  return length;
}

// Called synchronously by Python's input(). Returns the line, or null for
// end of input (Python then raises EOFError).
function readLine() {
  if (stdinQueue.length > 0) return stdinQueue.shift();
  if (!interactive) return null;
  if (!ctrl || !data) {
    if (!warnedNoInput) {
      warnedNoInput = true;
      postMessage({
        type: "stderr",
        id: runId,
        text: "\n[Typing input isn't available in this browser. Try an up-to-date Chrome, Edge, Firefox or Safari.]\n",
      });
    }
    return null;
  }
  Atomics.store(ctrl, 0, 0);
  postMessage({ type: "input_request", id: runId });
  while (Atomics.load(ctrl, 0) === 0) {
    Atomics.wait(ctrl, 0, 0, 1000);
  }
  const state = Atomics.load(ctrl, 0);
  Atomics.store(ctrl, 0, 0);
  if (state !== 1) return null;
  const len = Math.min(Atomics.load(ctrl, 1), data.length);
  const copy = new Uint8Array(len);
  copy.set(data.subarray(0, len));
  return lineDecoder.decode(copy);
}

// Keep only the student's own frames: drop Pyodide's internal frames so the
// traceback reads like normal Python and line numbers point at their code.
function cleanTraceback(message) {
  const out = [];
  let skipping = false;
  for (const line of String(message).split("\n")) {
    const frame = /^\s{2}File "([^"]*)"/.exec(line);
    if (frame) {
      // Student code runs as "<exec>" or "<block N>"; everything else is
      // Pyodide's own machinery.
      skipping = !frame[1].startsWith("<");
      if (!skipping) out.push(line);
      continue;
    }
    if (skipping && /^\s{4}/.test(line)) continue;
    skipping = false;
    out.push(line);
  }
  return out.join("\n").replace(/\n+$/, "") + "\n";
}

async function run(msg) {
  runId = msg.id;
  outputChars = 0;
  outputCapped = false;
  warnedNoInput = false;
  stdinQueue = Array.isArray(msg.stdin) ? msg.stdin.slice() : [];
  interactive = !!msg.interactive;
  if (interrupt) interrupt[0] = 0;

  const started = performance.now();
  let status = "success";
  let exitCode = 0;
  let py;
  try {
    py = await load();
  } catch (err) {
    postMessage({ type: "stderr", id: msg.id, text: String((err && err.message) || err) + "\n" });
    postMessage({ type: "done", id: msg.id, status: "error", exit_code: 1, elapsed: 0 });
    return;
  }

  // Fresh variables for every run, like running a file with `python`.
  const ns = py.globals.get("dict")();
  ns.set("__name__", "__main__");
  const cells = Array.isArray(msg.cells)
    ? msg.cells.slice(0, 200).map((c) => ({ code: String(c.code || ""), quiet: !!c.quiet, name: String(c.name || "exec").slice(0, 40) }))
    : [{ code: String(msg.code), quiet: false, name: "exec" }];
  try {
    for (const cell of cells) {
      quiet = cell.quiet;
      try {
        py.runPython(cell.code, { globals: ns, filename: "<" + cell.name + ">" });
      } finally {
        quiet = false;
      }
    }
  } catch (err) {
    const type = err && err.type;
    if (type === "SystemExit") {
      // sys.exit() / sys.exit(0) succeed, sys.exit(3) fails with that code,
      // sys.exit("message") fails with 1 and prints the message (CPython rules).
      const m = /SystemExit:\s*(.*)\s*$/.exec(String(err.message).trim());
      const arg = m ? m[1].trim() : "";
      if (arg === "" || arg === "None") exitCode = 0;
      else if (/^-?\d+$/.test(arg)) exitCode = parseInt(arg, 10);
      else {
        exitCode = 1;
        postMessage({ type: "stderr", id: msg.id, text: arg + "\n" });
      }
      status = exitCode === 0 ? "success" : "error";
    } else if (type === "KeyboardInterrupt") {
      status = "error";
      exitCode = 130;
    } else if (!outputCapped) {
      status = "error";
      exitCode = 1;
      postMessage({ type: "stderr", id: msg.id, text: cleanTraceback(err && err.message ? err.message : err) });
    } else {
      status = "error";
      exitCode = 1;
    }
  } finally {
    // Flush Python's buffered output while this run is still current, so
    // trailing text (print(..., end="")) lands here and nothing leaks into
    // the next run. After the output cap this flush is silently dropped.
    try { py.runPython("import sys\nsys.stdout.flush()\nsys.stderr.flush()"); } catch (_) { /* best effort */ }
    try { ns.destroy(); } catch (_) { /* already gone */ }
  }
  const elapsed = Math.round(performance.now() - started) / 1000;
  postMessage({ type: "done", id: msg.id, status, exit_code: exitCode, elapsed });
}

self.onmessage = (event) => {
  const msg = event.data || {};
  if (msg.type === "init") {
    if (msg.ctrl && msg.data && msg.interrupt) {
      ctrl = new Int32Array(msg.ctrl);
      data = new Uint8Array(msg.data);
      interrupt = new Uint8Array(msg.interrupt);
    }
    load().catch((err) => postMessage({ type: "load_error", message: String((err && err.message) || err) }));
  } else if (msg.type === "run") {
    run(msg);
  }
};
