import { useEffect, useRef, useState } from "react";
import * as Y from "yjs";
import {
  Awareness,
  encodeAwarenessUpdate,
  applyAwarenessUpdate,
} from "y-protocols/awareness";

export type PeerInfo = {
  clientId: number;
  name: string;
  color: string;
  isSelf: boolean;
  handRaised?: boolean;
};

/**
 * Connection state of the collaboration relay.
 *
 * Exposed so a caller can tell the user that live sync is down while local
 * editing keeps working -- otherwise an unreachable relay looks like a bug.
 * "reconnecting" covers the backoff window below, which is also the initial
 * state after a failed first connect.
 */
export type CollabStatus = "connecting" | "connected" | "reconnecting";

/*
 * The server keeps and saves every room's document, and fills a brand-new
 * room with its starter code itself. So the client never seeds a shared
 * room: it just applies whatever the server sends. `initialValue` is only
 * used when there is no room (solo, offline editing).
 */

const TEACHER_COLOR = "#22c55e"; // green-500

const STUDENT_COLORS = [
  "#38bdf8", // sky-400
  "#a78bfa", // violet-400
  "#fb923c", // orange-400
  "#f472b6", // pink-400
  "#facc15", // yellow-400
  "#22d3ee", // cyan-400
  "#c084fc", // purple-400
  "#f87171", // red-400
];

function pickStudentColor(clientId: number): string {
  return STUDENT_COLORS[clientId % STUDENT_COLORS.length];
}

// Wire tags: 0 = Yjs doc update, 1 = awareness update,
// 2 = server finished sending the saved document ("synced").
const TAG_DOC = 0;
const TAG_AWARENESS = 1;
const TAG_SYNCED = 2;

/**
 * Yjs + Awareness WebSocket bridge for collaborative editing.
 *
 * Returns the Awareness instance (for yCollab cursor rendering)
 * and a list of connected peers (for the presence bar).
 */
export function useCollab(
  roomId: string | undefined,
  doc: Y.Doc,
  initialValue?: string,
  userName?: string,
  userRole?: string,
): {
  awareness: Awareness | null;
  peers: PeerInfo[];
  setHandRaised: (raised: boolean) => void;
  status: CollabStatus;
} {
  const [awareness, setAwareness] = useState<Awareness | null>(null);
  const [status, setStatus] = useState<CollabStatus>("connecting");
  const [peers, setPeers] = useState<PeerInfo[]>([]);
  const awarenessRef = useRef<Awareness | null>(null);

  // Volatile inputs held in refs so the connection effect doesn't rebind on
  // every keystroke. `initialValue` changes whenever the parent's `code` state
  // changes (i.e. every keypress); if we kept it in the deps array, the entire
  // WebSocket + Awareness instance would tear down and rebuild constantly —
  // which is why peer cursors and selections never appeared.
  const initialValueRef = useRef(initialValue);
  const userNameRef = useRef(userName);
  const userRoleRef = useRef(userRole);
  useEffect(() => { initialValueRef.current = initialValue; }, [initialValue]);
  useEffect(() => { userNameRef.current = userName; }, [userName]);
  useEffect(() => { userRoleRef.current = userRole; }, [userRole]);

  // When name or role changes after connection, push the new identity into the
  // existing awareness state instead of reconnecting.
  useEffect(() => {
    const aw = awarenessRef.current;
    if (!aw) return;
    const role = userRole || "student";
    const isTeacher = role === "teacher";
    const myColor = isTeacher ? TEACHER_COLOR : pickStudentColor(doc.clientID);
    aw.setLocalStateField("user", {
      name: userName || "Anonymous",
      color: myColor,
      colorLight: myColor + "33",
      role,
    });
  }, [userName, userRole, doc]);

  useEffect(() => {
    const ytext = doc.getText("code");
    const initialValue = initialValueRef.current;
    const userName = userNameRef.current;
    const userRole = userRoleRef.current;

    if (!roomId) {
      if (ytext.length === 0 && initialValue) {
        ytext.insert(0, initialValue);
      }
      setAwareness(null);
      setPeers([]);
      return;
    }

    const aw = new Awareness(doc);
    awarenessRef.current = aw;
    setAwareness(aw);

    const isTeacher = userRole === "teacher";
    const myColor = isTeacher ? TEACHER_COLOR : pickStudentColor(doc.clientID);
    aw.setLocalStateField("user", {
      name: userName || "Anonymous",
      color: myColor,
      colorLight: myColor + "33",
      role: userRole || "student",
    });

    const buildPeersList = (): PeerInfo[] => {
      const states = aw.getStates();
      const list: PeerInfo[] = [];
      // Add self first.
      list.push({
        clientId: doc.clientID,
        name: (userName || "Anonymous") + " (you)",
        color: myColor,
        isSelf: true,
      });
      states.forEach((state, clientId) => {
        if (clientId === doc.clientID) return;
        const u = state.user;
        if (u) {
          list.push({
            clientId,
            name: u.name || "Peer",
            color: u.color || "#888",
            isSelf: false,
            handRaised: !!state.handRaised,
          });
        }
      });
      return list;
    };

    // Set initial peers (self).
    setPeers(buildPeersList());

    let awarenessTimer: ReturnType<typeof setTimeout> | null = null;
    const onAwarenessChange = () => {
      if (awarenessTimer) clearTimeout(awarenessTimer);
      awarenessTimer = setTimeout(() => {
        awarenessTimer = null;
        setPeers(buildPeersList());
      }, 300);
    };
    aw.on("change", onAwarenessChange);

    // Same-origin WebSocket — the browser sends the httpOnly auth cookie
    // automatically with the handshake. In dev, Vite proxies /ws → backend.
    const wsBase = `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}`;
    const url = `${wsBase}/ws/collab/${encodeURIComponent(roomId)}`;

    // Stable origin token for updates we apply off the wire, so our own
    // doc/awareness "update" handlers don't echo them straight back. We key
    // on this fixed object rather than the socket instance because the socket
    // is replaced on every reconnect — keying on the instance would break
    // echo-suppression after the first reconnect.
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

    const handleAwarenessUpdate = (
      { added, updated, removed }: { added: number[]; updated: number[]; removed: number[] },
    ) => {
      const changed = added.concat(updated, removed);
      // When a new peer appears, re-broadcast our own awareness so they see
      // our cursor (awareness isn't stored on the server). The document
      // itself comes from the server, so it isn't re-sent here.
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
    // The synced marker is a single byte, so it's handled before the length
    // check in handleMessage would drop it.
    const handleRaw = (event: MessageEvent) => {
      const raw = new Uint8Array(event.data as ArrayBuffer);
      if (raw.length === 1 && raw[0] === TAG_SYNCED) {
        setStatus("connected");
        return;
      }
      handleMessage(event);
    };

    // Reconnect with exponential backoff (capped). Without this, a single
    // dropped socket — proxy idle timeout, server recycle, network blip —
    // permanently kills collaboration even though local editing keeps working,
    // so peers silently stop seeing each other's updates.
    const scheduleReconnect = () => {
      if (disposed || reconnectTimer) return;
      setStatus("reconnecting");
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
      // (Re)sync: push our full doc + awareness state. On a reconnect this
      // replays any edits made while disconnected (Yjs/CRDT merges cleanly
      // with the server's copy). On a first connect our doc is empty, so
      // this is a no-op; the server's saved state arrives right after.
      taggedSend(TAG_DOC, Y.encodeStateAsUpdate(doc));
      taggedSend(TAG_AWARENESS, encodeAwarenessUpdate(aw, [doc.clientID]));

      // Periodically re-broadcast awareness so peers don't time us out
      // (default Yjs awareness timeout is 30s).
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
      s.addEventListener("message", handleRaw);
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
      if (awarenessTimer) clearTimeout(awarenessTimer);
      doc.off("update", handleDocUpdate);
      aw.off("update", handleAwarenessUpdate);
      aw.off("change", onAwarenessChange);
      if (socket) {
        socket.removeEventListener("open", onOpen);
        socket.removeEventListener("message", handleRaw);
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
      setAwareness(null);
      setPeers([]);
    };
    // Intentionally do NOT depend on initialValue / userName / userRole here.
    // They're read via refs so this effect only rebinds when the room itself
    // changes — keeping the WebSocket and Awareness alive across keystrokes.
  }, [roomId, doc]);

  const setHandRaised = (raised: boolean) => {
    const aw = awarenessRef.current;
    if (!aw) return;
    aw.setLocalStateField("handRaised", raised);
  };

  return { awareness, peers, setHandRaised, status };
}
