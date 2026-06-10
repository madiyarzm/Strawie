import { useCallback, useEffect, useRef, useState } from "react";
import * as Y from "yjs";
import {
  Awareness,
  encodeAwarenessUpdate,
  applyAwarenessUpdate,
} from "y-protocols/awareness";

export type DrawingStroke = {
  id: string;
  tool: "pen" | "eraser";
  color: string;
  width: number;
  points: { x: number; y: number }[];
};

/** A peer's awareness state: their user info and any in-progress stroke. */
export type PeerCursor = {
  clientId: number;
  name: string;
  color: string;
  liveStroke: DrawingStroke | null;
};

// Wire tags: 0 = Yjs doc update, 1 = awareness update.
const TAG_DOC = 0;
const TAG_AWARENESS = 1;

const TEACHER_COLOR = "#22c55e";
const STUDENT_COLORS = [
  "#38bdf8", "#a78bfa", "#fb923c", "#f472b6",
  "#facc15", "#22d3ee", "#c084fc", "#f87171",
];

function storageKey(roomId: string) {
  return `lambda:drawing:${roomId}`;
}

function loadFromStorage(doc: Y.Doc, roomId: string) {
  try {
    const raw = localStorage.getItem(storageKey(roomId));
    if (!raw) return;
    const arr = new Uint8Array(JSON.parse(raw) as number[]);
    Y.applyUpdate(doc, arr);
  } catch {
    // ignore corrupt storage
  }
}

function saveToStorage(doc: Y.Doc, roomId: string) {
  try {
    const state = Y.encodeStateAsUpdate(doc);
    localStorage.setItem(storageKey(roomId), JSON.stringify(Array.from(state)));
  } catch {
    // ignore quota errors
  }
}

/**
 * Yjs + WebSocket bridge for collaborative drawing.
 *
 * - Committed strokes are stored in a Y.Array (persistent, CRDT-synced).
 * - In-progress strokes are broadcast via Awareness so peers see them live.
 * - State is persisted to localStorage per room so drawings survive reloads.
 */
export function useCollabDrawing(
  roomId: string | undefined,
  userName?: string,
  userRole?: string,
): {
  strokes: DrawingStroke[];
  addStroke: (stroke: DrawingStroke) => void;
  clearStrokes: () => void;
  updateLiveStroke: (stroke: DrawingStroke | null) => void;
  peerCursors: PeerCursor[];
} {
  const docRef = useRef<Y.Doc>(new Y.Doc());
  const awarenessRef = useRef<Awareness | null>(null);
  const [strokes, setStrokes] = useState<DrawingStroke[]>([]);
  const [peerCursors, setPeerCursors] = useState<PeerCursor[]>([]);

  const addStroke = useCallback((stroke: DrawingStroke) => {
    docRef.current.getArray<DrawingStroke>("strokes").push([stroke]);
  }, []);

  const clearStrokes = useCallback(() => {
    const ystrokes = docRef.current.getArray<DrawingStroke>("strokes");
    docRef.current.transact(() => {
      ystrokes.delete(0, ystrokes.length);
    });
    if (roomId) {
      try { localStorage.removeItem(storageKey(roomId)); } catch { /* ignore */ }
    }
  }, [roomId]);

  /**
   * Broadcast the caller's in-progress stroke to all peers via Awareness.
   * Pass null when the stroke is committed or cancelled.
   */
  const updateLiveStroke = useCallback((stroke: DrawingStroke | null) => {
    awarenessRef.current?.setLocalStateField("liveStroke", stroke);
  }, []);

  useEffect(() => {
    const doc = docRef.current;
    const ystrokes = doc.getArray<DrawingStroke>("strokes");

    const syncStrokes = () => setStrokes(ystrokes.toArray());
    ystrokes.observe(syncStrokes);
    syncStrokes();

    if (!roomId) {
      return () => ystrokes.unobserve(syncStrokes);
    }

    // Restore saved drawing before connecting so we send it on open
    loadFromStorage(doc, roomId);
    const onDocUpdate = () => saveToStorage(doc, roomId);
    doc.on("update", onDocUpdate);

    const aw = new Awareness(doc);
    awarenessRef.current = aw;

    const myColor =
      userRole === "teacher"
        ? TEACHER_COLOR
        : STUDENT_COLORS[doc.clientID % STUDENT_COLORS.length];

    aw.setLocalStateField("user", {
      name: userName || "Anonymous",
      color: myColor,
      role: userRole || "student",
    });
    aw.setLocalStateField("liveStroke", null);

    // Rebuild peer cursor list whenever awareness changes.
    // When a NEW peer joins (added.length > 0), send them our full Yjs state so
    // they receive all committed strokes — the backend relay has no persistent
    // state, so late-joining peers would otherwise miss everything drawn before
    // they connected.
    const syncPeerCursors = ({
      added,
    }: {
      added: number[];
      updated: number[];
      removed: number[];
    }) => {
      if (added.length > 0 && socket && socket.readyState === WebSocket.OPEN) {
        // Re-send doc state AND our awareness so late-joiners see everything.
        taggedSend(TAG_DOC, Y.encodeStateAsUpdate(doc));
        taggedSend(TAG_AWARENESS, encodeAwarenessUpdate(aw, [doc.clientID]));
      }
      const cursors: PeerCursor[] = [];
      aw.getStates().forEach((state, clientId) => {
        if (clientId === doc.clientID) return; // skip self
        if (!state.user) return;
        cursors.push({
          clientId,
          name: state.user.name || "Peer",
          color: state.user.color || "#888",
          liveStroke: state.liveStroke ?? null,
        });
      });
      setPeerCursors(cursors);
    };
    aw.on("change", syncPeerCursors);

    // Same-origin WebSocket — the browser sends the httpOnly auth cookie
    // automatically with the handshake. In dev, Vite proxies /ws → backend.
    const wsBase = `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}`;
    const url = `${wsBase}/ws/collab/${encodeURIComponent(roomId)}`;

    // Stable origin token for updates we apply off the wire, so our own
    // doc/awareness "update" handlers don't echo them straight back. Keyed on
    // a fixed object (not the socket) so echo-suppression survives reconnects,
    // which replace the socket instance.
    const wsOrigin = {};

    let socket: WebSocket | null = null;
    let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let reconnectAttempts = 0;
    let disposed = false;

    function taggedSend(tag: number, payload: Uint8Array) {
      if (!socket || socket.readyState !== WebSocket.OPEN) return;
      const msg = new Uint8Array(1 + payload.length);
      msg[0] = tag;
      msg.set(payload, 1);
      socket.send(msg);
    }

    const handleDocUpdate = (update: Uint8Array, origin: unknown) => {
      if (origin === wsOrigin) return;
      taggedSend(TAG_DOC, update);
    };

    const handleAwarenessUpdate = ({
      added, updated, removed,
    }: { added: number[]; updated: number[]; removed: number[] }) => {
      const changed = added.concat(updated, removed);
      // When a new peer appears, also re-broadcast our own state so they see us.
      if (added.length > 0 && !changed.includes(doc.clientID)) {
        changed.push(doc.clientID);
      }
      taggedSend(TAG_AWARENESS, encodeAwarenessUpdate(aw, changed));
    };

    const handleMessage = (event: MessageEvent) => {
      const raw = new Uint8Array(event.data as ArrayBuffer);
      if (raw.length < 2) return;
      const tag = raw[0];
      const payload = raw.slice(1);
      if (tag === TAG_DOC) {
        Y.applyUpdate(doc, payload, wsOrigin);
      } else if (tag === TAG_AWARENESS) {
        applyAwarenessUpdate(aw, payload, wsOrigin);
      }
    };

    // Reconnect with exponential backoff (capped). Without this, a single
    // dropped socket — proxy idle timeout, server recycle, network blip —
    // permanently kills collaboration: local drawing keeps working but peers
    // silently stop seeing each other's strokes.
    const scheduleReconnect = () => {
      if (disposed || reconnectTimer) return;
      if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
        heartbeatInterval = null;
      }
      const delay = Math.min(1000 * 2 ** reconnectAttempts, 15_000) + Math.random() * 500;
      reconnectAttempts += 1;
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connect();
      }, delay);
    };

    const onOpen = () => {
      reconnectAttempts = 0;
      // (Re)sync full doc + awareness. On a reconnect this replays strokes
      // drawn while disconnected (Yjs/CRDT merges cleanly) and prompts peers
      // to re-send theirs when they see us reappear.
      taggedSend(TAG_DOC, Y.encodeStateAsUpdate(doc));
      taggedSend(TAG_AWARENESS, encodeAwarenessUpdate(aw, [doc.clientID]));

      heartbeatInterval = setInterval(() => {
        if (socket && socket.readyState === WebSocket.OPEN) {
          taggedSend(TAG_AWARENESS, encodeAwarenessUpdate(aw, [doc.clientID]));
        }
      }, 10_000);
    };

    const onClose = () => {
      if (disposed) return;
      scheduleReconnect();
    };

    const onError = () => {
      // Force-close so the `close` handler drives the single reconnect path.
      try { socket?.close(); } catch { /* already closing */ }
    };

    function connect() {
      if (disposed) return;
      const s = new WebSocket(url);
      s.binaryType = "arraybuffer";
      socket = s;
      s.addEventListener("open", onOpen);
      s.addEventListener("message", handleMessage);
      s.addEventListener("close", onClose);
      s.addEventListener("error", onError);
    }

    doc.on("update", handleDocUpdate);
    aw.on("update", handleAwarenessUpdate);
    connect();

    return () => {
      disposed = true;
      if (heartbeatInterval) clearInterval(heartbeatInterval);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      awarenessRef.current = null;
      doc.off("update", handleDocUpdate);
      doc.off("update", onDocUpdate);
      aw.off("update", handleAwarenessUpdate);
      aw.off("change", syncPeerCursors);
      ystrokes.unobserve(syncStrokes);
      if (socket) {
        socket.removeEventListener("open", onOpen);
        socket.removeEventListener("message", handleMessage);
        socket.removeEventListener("close", onClose);
        socket.removeEventListener("error", onError);
        if (
          socket.readyState === WebSocket.OPEN ||
          socket.readyState === WebSocket.CONNECTING
        ) {
          socket.close();
        }
      }
      aw.destroy();
      setPeerCursors([]);
    };
  }, [roomId, userName, userRole]);

  return { strokes, addStroke, clearStrokes, updateLiveStroke, peerCursors };
}
