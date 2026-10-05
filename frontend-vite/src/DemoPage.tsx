/**
 * Public demo: a working classroom in one click, no account.
 *
 * Two routes live here:
 *   /demo            -> DemoLauncher, creates a room and redirects
 *   /demo/:roomId    -> DemoRoomView, the actual workspace
 *
 * Design constraints this file is built around:
 *   * A reviewer spends 60-120 seconds here, so there must be no empty state,
 *     no dead button, and no unexplained failure. Every error path below ends
 *     in a readable sentence plus an action.
 *   * Python runs ENTIRELY in the browser via Pyodide. Guests are refused by
 *     the server-side sandbox on purpose (app/api/ws_sandbox.py), so there is
 *     no server execution path to fall back to and none is attempted.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { CodeEditor } from "./components/CodeEditor";
import type { CollabStatus } from "./hooks/useCollab";
import {
  DemoError,
  createDemoRoom,
  getDemoRoom,
  type DemoFile,
  type DemoRoom,
} from "./lib/demoApi";
import {
  isPyodideReady,
  onPyodideProgress,
  runInteractive,
  warmupPyodide,
} from "./lib/pyodideRunner";

/** One line of terminal transcript. */
type TerminalLine = {
  id: number;
  text: string;
  kind: "stdout" | "stderr" | "info";
};

// Guests are anonymous, but the collaboration presence UI wants a label, and
// "Anonymous" twice over is confusing when the whole point is watching two
// cursors. Give each tab a distinct, friendly name.
const GUEST_NAMES = [
  "Guest Fox",
  "Guest Otter",
  "Guest Heron",
  "Guest Ibex",
  "Guest Lynx",
  "Guest Marten",
];

function pickGuestName(): string {
  const index = Math.floor(Math.random() * GUEST_NAMES.length);
  return GUEST_NAMES[index];
}

// ---------------------------------------------------------------------------
// Shared presentational pieces
// ---------------------------------------------------------------------------

/** Full-page centred card, used for every loading and error state. */
const DemoCard: React.FC<{
  title: string;
  body: string;
  children?: React.ReactNode;
}> = ({ title, body, children }) => (
  <div
    style={{
      minHeight: "100vh",
      background: "var(--bg)",
      color: "var(--text)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: 24,
      fontFamily: "var(--font)",
    }}
  >
    <div
      style={{
        maxWidth: 440,
        width: "100%",
        background: "var(--bg-2)",
        border: "1px solid var(--border)",
        borderRadius: "var(--r-lg)",
        padding: 32,
        textAlign: "center",
      }}
    >
      <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 10 }}>{title}</h1>
      <p style={{ color: "var(--muted)", fontSize: 14, lineHeight: 1.6, marginBottom: 20 }}>
        {body}
      </p>
      {children}
    </div>
  </div>
);

const primaryButtonStyle: React.CSSProperties = {
  background: "var(--indigo)",
  color: "white",
  border: "none",
  borderRadius: "var(--r)",
  padding: "10px 18px",
  fontSize: 14,
  fontWeight: 600,
  cursor: "pointer",
  fontFamily: "var(--font)",
};

const secondaryButtonStyle: React.CSSProperties = {
  ...primaryButtonStyle,
  background: "transparent",
  color: "var(--text-2)",
  border: "1px solid var(--border-2)",
};

// ---------------------------------------------------------------------------
// /demo  -- create a room, then redirect to it
// ---------------------------------------------------------------------------

export const DemoLauncher: React.FC = () => {
  const navigate = useNavigate();
  const [error, setError] = useState<{ message: string; canRetry: boolean } | null>(null);

  // React 18 StrictMode mounts effects twice in development. Creating a room
  // is a write, so guard it -- otherwise every dev visit burns two rooms out
  // of the per-IP hourly allowance.
  const hasStartedRef = useRef(false);

  const start = useCallback(async () => {
    setError(null);
    try {
      // Start downloading Pyodide while the room is being created, so the
      // ~10MB runtime is already in flight by the time the editor paints.
      warmupPyodide();

      const room = await createDemoRoom();
      // `replace` so the browser Back button leaves the demo instead of
      // bouncing through /demo and creating yet another room.
      navigate(`/demo/${room.room_id}`, { replace: true });
    } catch (caught) {
      if (caught instanceof DemoError) {
        // A rate limit or a disabled demo will not fix itself on an instant
        // retry, so only offer the button where retrying can actually help.
        const canRetry = caught.kind === "network" || caught.kind === "unknown";
        setError({ message: caught.message, canRetry });
      } else {
        setError({
          message: "Something went wrong starting the demo. Please try again.",
          canRetry: true,
        });
      }
    }
  }, [navigate]);

  useEffect(() => {
    if (hasStartedRef.current) return;
    hasStartedRef.current = true;
    void start();
  }, [start]);

  if (error) {
    return (
      <DemoCard title="Could not start the demo" body={error.message}>
        <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
          {error.canRetry && (
            <button
              style={primaryButtonStyle}
              onClick={() => {
                hasStartedRef.current = true;
                void start();
              }}
            >
              Try again
            </button>
          )}
          <a href="/" style={{ ...secondaryButtonStyle, textDecoration: "none" }}>
            Back to home
          </a>
        </div>
      </DemoCard>
    );
  }

  return (
    <DemoCard
      title="Setting up your classroom…"
      body="Creating a private demo room and loading Python. This takes a few seconds."
    />
  );
};

// ---------------------------------------------------------------------------
// /demo/:roomId  -- the workspace
// ---------------------------------------------------------------------------

export const DemoRoomView: React.FC = () => {
  const { roomId } = useParams<{ roomId: string }>();
  const navigate = useNavigate();

  const [room, setRoom] = useState<DemoRoom | null>(null);
  const [loadError, setLoadError] = useState<DemoError | null>(null);

  // Local mirror of file contents. The authoritative copy for collaboration
  // lives in each file's Yjs document inside CodeEditor; this mirror is what
  // the Run button executes, kept current through onChange.
  const [files, setFiles] = useState<DemoFile[]>([]);
  const [activeFileId, setActiveFileId] = useState<string>("");

  const [terminalLines, setTerminalLines] = useState<TerminalLine[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [pyodideState, setPyodideState] = useState<"loading" | "ready" | "failed">(
    isPyodideReady() ? "ready" : "loading",
  );
  const [collabStatus, setCollabStatus] = useState<CollabStatus>("connecting");

  const nextLineId = useRef(0);
  const runCounter = useRef(0);
  const terminalRef = useRef<HTMLDivElement | null>(null);

  // One stable guest name per tab, so two tabs show two different peers.
  const guestName = useMemo(() => pickGuestName(), []);

  const appendLine = useCallback((text: string, kind: TerminalLine["kind"]) => {
    setTerminalLines((previous) => [
      ...previous,
      { id: nextLineId.current++, text, kind },
    ]);
  }, []);

  // --- load the room -------------------------------------------------------

  useEffect(() => {
    if (!roomId) return;
    let cancelled = false;

    async function load(currentRoomId: string) {
      try {
        const loaded = await getDemoRoom(currentRoomId);
        if (cancelled) return;

        setRoom(loaded);
        setFiles(loaded.files);
        // Open the first file so the editor is never blank on arrival.
        if (loaded.files.length > 0) {
          setActiveFileId(loaded.files[0].id);
        }
      } catch (caught) {
        if (cancelled) return;
        setLoadError(
          caught instanceof DemoError
            ? caught
            : new DemoError("unknown", "Could not load this demo room."),
        );
      }
    }

    void load(roomId);
    return () => {
      cancelled = true;
    };
  }, [roomId]);

  // --- Pyodide readiness ---------------------------------------------------

  useEffect(() => {
    warmupPyodide();

    const unsubscribe = onPyodideProgress((event) => {
      if (event.kind === "ready") setPyodideState("ready");
    });

    // The progress stream only reports success, so a load failure would leave
    // the Run button disabled forever with no explanation. Time it out and say
    // so instead. 45s is generous for a ~10MB download on a slow connection.
    const failureTimer = setTimeout(() => {
      setPyodideState((current) => (current === "ready" ? current : "failed"));
    }, 45_000);

    return () => {
      unsubscribe();
      clearTimeout(failureTimer);
    };
  }, []);

  // Keep the newest output in view without yanking the whole page around.
  useEffect(() => {
    const element = terminalRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [terminalLines]);

  // --- running code --------------------------------------------------------

  const activeFile = files.find((file) => file.id === activeFileId) ?? null;

  const handleRun = useCallback(async () => {
    if (isRunning || !activeFile) return;

    if (pyodideState === "failed") {
      appendLine(
        "Python runtime is unavailable. Use 'Reload runtime' below to retry.\n",
        "stderr",
      );
      return;
    }

    runCounter.current += 1;
    if (runCounter.current === 1) {
      setTerminalLines([]);
    } else {
      appendLine(`\n--- Run ${runCounter.current} ---\n`, "info");
    }

    setIsRunning(true);
    if (pyodideState !== "ready") {
      appendLine("Loading Python runtime (first run only)…\n", "info");
    }

    try {
      const result = await runInteractive({
        code: activeFile.content,
        onOutput: (output) => appendLine(output.text, output.type),
        // input() is a blocking call and Pyodide runs on the main thread, so
        // the line must be returned synchronously. window.prompt is the only
        // browser API that can do that. See onStdinRequest in pyodideRunner.
        onStdinRequest: (promptText) => {
          const question = promptText || "Input:";
          return window.prompt(question);
        },
        // Interactive runs need time for a human to type, so allow longer
        // than the 10s default used for plain runs.
        timeoutMs: 120_000,
      });

      if (result.status === "timeout") {
        appendLine("\nStopped: the program ran longer than 2 minutes.\n", "stderr");
      }
      setPyodideState("ready");
    } catch (caught) {
      // Reaching here almost always means Pyodide itself failed to load, not
      // that the user's Python was wrong -- a Python error is reported through
      // onOutput as stderr instead.
      const detail = caught instanceof Error ? caught.message : String(caught);
      appendLine(`\nCould not start the Python runtime: ${detail}\n`, "stderr");
      setPyodideState("failed");
    } finally {
      setIsRunning(false);
    }
  }, [activeFile, appendLine, isRunning, pyodideState]);

  const handleFileChange = useCallback(
    (fileId: string, nextContent: string) => {
      setFiles((previous) => {
        const updated: DemoFile[] = [];
        for (const file of previous) {
          if (file.id === fileId) {
            updated.push({ ...file, content: nextContent });
          } else {
            updated.push(file);
          }
        }
        return updated;
      });
    },
    [],
  );

  const handleOpenSecondTab = useCallback(() => {
    if (!roomId) return;
    // Same URL on purpose: the guest cookie is already in this browser, so the
    // new tab joins the same Yjs room and the reviewer sees live CRDT sync.
    window.open(`/demo/${roomId}`, "_blank", "noopener,noreferrer");
  }, [roomId]);

  // --- error and loading states -------------------------------------------

  if (loadError) {
    const isExpired = loadError.kind === "expired";
    return (
      <DemoCard
        title={isExpired ? "This demo room has expired" : "Could not load the demo"}
        body={loadError.message}
      >
        <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
          <button style={primaryButtonStyle} onClick={() => navigate("/demo", { replace: true })}>
            Start a fresh demo
          </button>
          <a href="/" style={{ ...secondaryButtonStyle, textDecoration: "none" }}>
            Back to home
          </a>
        </div>
      </DemoCard>
    );
  }

  if (!room || !activeFile) {
    return (
      <DemoCard
        title="Opening your classroom…"
        body="Loading your files and connecting to the collaboration server."
      />
    );
  }

  // Per-file Yjs room. The server owns the "demo:<uuid>" prefix and the ACL
  // only admits the room bound to this browser's guest token, so appending a
  // file id cannot widen access.
  const collabRoomId = `${room.collab_room_id}:${activeFile.id}`;

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        background: "var(--bg)",
        color: "var(--text)",
        fontFamily: "var(--font)",
      }}
    >
      {/* Header: demo-mode indicator plus the two-tab affordance. */}
      <header
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
          padding: "12px 16px",
          borderBottom: "1px solid var(--border)",
          background: "var(--bg-2)",
        }}
      >
        <strong style={{ fontSize: 15, letterSpacing: "-0.01em" }}>Strawie</strong>

        {/* Says "demo mode" explicitly so missing account features read as
            intentional rather than broken. */}
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            color: "var(--amber)",
            background: "var(--amber-10)",
            border: "1px solid var(--amber-muted)",
            borderRadius: 999,
            padding: "3px 10px",
          }}
        >
          You're in demo mode
        </span>

        <span style={{ flex: 1 }} />

        <button style={primaryButtonStyle} onClick={handleOpenSecondTab}>
          Open in second tab
        </button>
        <a href="/" style={{ ...secondaryButtonStyle, textDecoration: "none" }}>
          Sign in
        </a>
      </header>

      {/* Pinned three-line guide: exactly what to click, in order. */}
      <div
        style={{
          padding: "10px 16px",
          background: "var(--indigo-10)",
          borderBottom: "1px solid var(--border)",
          fontSize: 13,
          lineHeight: 1.7,
          color: "var(--text-2)",
        }}
      >
        {room.banner_lines.map((line, index) => (
          <div key={index}>
            <span style={{ color: "var(--indigo)", fontWeight: 700, marginRight: 6 }}>
              {index + 1}.
            </span>
            {line}
          </div>
        ))}
      </div>

      {/* Relay down: local editing still works, so say that rather than
          leaving the reviewer to guess why the second tab is silent. */}
      {collabStatus === "reconnecting" && (
        <div
          style={{
            padding: "8px 16px",
            background: "var(--amber-10)",
            borderBottom: "1px solid var(--amber-muted)",
            color: "var(--amber)",
            fontSize: 12.5,
          }}
        >
          Live collaboration is offline — reconnecting. Your edits still work and
          will sync once the connection returns.
        </div>
      )}

      {/* Pyodide unavailable: offer the one action that can fix it. */}
      {pyodideState === "failed" && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            flexWrap: "wrap",
            padding: "8px 16px",
            background: "var(--rose-10)",
            borderBottom: "1px solid var(--rose-muted)",
            color: "var(--rose)",
            fontSize: 12.5,
          }}
        >
          <span>
            The in-browser Python runtime did not load. This usually means the CDN
            was blocked or the connection dropped.
          </span>
          {/* A full reload is the honest fix: the Pyodide loader caches its
              failed promise for the lifetime of the page. */}
          <button
            style={{ ...secondaryButtonStyle, padding: "5px 12px", fontSize: 12.5 }}
            onClick={() => window.location.reload()}
          >
            Reload runtime
          </button>
        </div>
      )}

      {/* File tabs. */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 4,
          padding: "6px 12px",
          borderBottom: "1px solid var(--border)",
          background: "var(--bg-2)",
        }}
      >
        {files.map((file) => {
          const isActive = file.id === activeFileId;
          return (
            <button
              key={file.id}
              onClick={() => setActiveFileId(file.id)}
              style={{
                padding: "5px 12px",
                fontSize: 12.5,
                fontFamily: "ui-monospace, monospace",
                borderRadius: 8,
                cursor: "pointer",
                background: isActive ? "var(--bg)" : "transparent",
                color: isActive ? "var(--indigo)" : "var(--muted)",
                border: isActive ? "1px solid var(--border)" : "1px solid transparent",
              }}
            >
              {file.name}
            </button>
          );
        })}
      </div>

      {/* Editor and terminal. */}
      <div style={{ flex: 1, display: "flex", minHeight: 0, flexWrap: "wrap" }}>
        {/* `display: grid` rather than flex: CodeEditor's own root is
            `h-full flex flex-col` and its `className` prop lands on an inner
            wrapper, so as a flex child it would size to its content and leave
            dead space. A single-column grid stretches it to the full width
            without reaching into the shared component. */}
        <div
          style={{
            flex: "1 1 420px",
            minWidth: 300,
            minHeight: 320,
            display: "grid",
            gridTemplateColumns: "minmax(0, 1fr)",
          }}
        >
          {/* `key` forces a fresh CodeEditor (and therefore a fresh Y.Doc and
              WebSocket) per file, so the two files never share a document. */}
          <CodeEditor
            key={activeFile.id}
            value={activeFile.content}
            onChange={(nextContent) => handleFileChange(activeFile.id, nextContent)}
            roomId={collabRoomId}
            userName={guestName}
            userRole="guest"
            onCollabStatusChange={setCollabStatus}
            className="flex-1"
          />
        </div>

        <div
          style={{
            flex: "1 1 360px",
            minWidth: 280,
            display: "flex",
            flexDirection: "column",
            borderLeft: "1px solid var(--border)",
            background: "var(--bg-2)",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "8px 12px",
              borderBottom: "1px solid var(--border)",
            }}
          >
            <button
              style={{
                ...primaryButtonStyle,
                padding: "6px 16px",
                opacity: isRunning ? 0.6 : 1,
                cursor: isRunning ? "default" : "pointer",
              }}
              onClick={() => void handleRun()}
              disabled={isRunning}
            >
              {isRunning ? "Running…" : `Run ${activeFile.name}`}
            </button>

            <span style={{ fontSize: 11.5, color: "var(--subtle)" }}>
              {pyodideState === "loading" && "Loading Python…"}
              {pyodideState === "ready" && "Python ready — runs in your browser"}
              {pyodideState === "failed" && "Python unavailable"}
            </span>
          </div>

          <div
            ref={terminalRef}
            style={{
              flex: 1,
              overflowY: "auto",
              padding: 12,
              fontFamily: "ui-monospace, monospace",
              fontSize: 12.5,
              lineHeight: 1.55,
              whiteSpace: "pre-wrap",
              minHeight: 200,
            }}
          >
            {terminalLines.length === 0 ? (
              // Never a blank panel: tell the reviewer what to do next.
              <span style={{ color: "var(--subtle)" }}>
                Press Run to execute {activeFile.name} in your browser.
              </span>
            ) : (
              terminalLines.map((line) => (
                <span
                  key={line.id}
                  style={{
                    color:
                      line.kind === "stderr"
                        ? "var(--rose)"
                        : line.kind === "info"
                          ? "var(--subtle)"
                          : "var(--text)",
                  }}
                >
                  {line.text}
                </span>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
