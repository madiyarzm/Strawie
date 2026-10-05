/**
 * API client for the public demo.
 *
 * Kept separate from `api.ts` because the demo must NOT share that module's
 * behaviour: `api.ts` throws a bare "Unauthorized" on 401 and drops the
 * response detail, but the demo needs to tell a visitor apart a rate limit
 * from an expired room from the demo being switched off. Those messages are
 * the whole difference between "looks broken" and "clearly explained".
 */

const API_BASE: string =
  (import.meta.env.VITE_API_URL as string | undefined) ?? "";

export type DemoFile = {
  id: string;
  name: string;
  content: string;
};

export type DemoRoom = {
  room_id: string;
  expires_at: string;
  collab_room_id: string;
  files: DemoFile[];
  banner_lines: string[];
};

/**
 * Why a room could not be opened. The UI branches on `kind` to decide
 * between "start a fresh room" and "wait and retry", so each case a visitor
 * can actually hit gets its own value rather than one generic failure.
 */
export type DemoErrorKind =
  | "expired" // room gone or never existed (404)
  | "rate_limited" // too many rooms from this IP (429)
  | "disabled" // demo turned off server-side (503)
  | "network" // fetch itself failed
  | "unknown";

export class DemoError extends Error {
  kind: DemoErrorKind;

  constructor(kind: DemoErrorKind, message: string) {
    super(message);
    this.name = "DemoError";
    this.kind = kind;
  }
}

/** Map an HTTP status to the error kind, so status handling lives in one place. */
function kindForStatus(status: number): DemoErrorKind {
  if (status === 404) return "expired";
  if (status === 429) return "rate_limited";
  if (status === 503) return "disabled";
  return "unknown";
}

/** Fallback copy per kind, used when the server sends no usable detail. */
function fallbackMessage(kind: DemoErrorKind): string {
  switch (kind) {
    case "expired":
      return "This demo room has expired. Start a fresh one.";
    case "rate_limited":
      return "Too many demo rooms from your network. Please try again in an hour.";
    case "disabled":
      return "The demo is temporarily unavailable. Please check back soon.";
    case "network":
      return "Could not reach the server. Check your connection and try again.";
    default:
      return "Something went wrong starting the demo. Please try again.";
  }
}

/**
 * Pull the human-readable message out of a failed response.
 *
 * FastAPI uses {"detail": "..."} but slowapi's own 429 handler returns a
 * plain-text body, so both shapes are handled rather than assuming JSON.
 */
async function extractMessage(response: Response, kind: DemoErrorKind): Promise<string> {
  let raw = "";
  try {
    raw = await response.text();
  } catch {
    return fallbackMessage(kind);
  }

  if (!raw.trim()) return fallbackMessage(kind);

  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed?.detail === "string" && parsed.detail.trim()) {
      return parsed.detail;
    }
    // Pydantic validation errors come back as an array; not useful to show.
    return fallbackMessage(kind);
  } catch {
    // Plain-text body (slowapi): show it only if it looks like a sentence,
    // never a raw stack trace or HTML page.
    const trimmed = raw.trim();
    const looksLikeProse = trimmed.length < 200 && !trimmed.startsWith("<");
    return looksLikeProse ? trimmed : fallbackMessage(kind);
  }
}

async function demoFetch(method: string, path: string): Promise<Response> {
  try {
    return await fetch(`${API_BASE}${path}`, {
      method,
      // Needed so the guest cookie is set on create and sent on later calls.
      credentials: "include",
    });
  } catch {
    throw new DemoError("network", fallbackMessage("network"));
  }
}

/**
 * Create a fresh demo room. The server also sets the guest cookie on this
 * response, which is what later authorises the collaboration WebSocket — so
 * this call must succeed before the room is usable.
 */
export async function createDemoRoom(): Promise<{ room_id: string; expires_at: string }> {
  const response = await demoFetch("POST", "/api/v1/demo/rooms");
  if (!response.ok) {
    const kind = kindForStatus(response.status);
    throw new DemoError(kind, await extractMessage(response, kind));
  }
  return response.json();
}

/** Fetch a room's seeded files and banner. 404 means expired or never existed. */
export async function getDemoRoom(roomId: string): Promise<DemoRoom> {
  const response = await demoFetch("GET", `/api/v1/demo/rooms/${encodeURIComponent(roomId)}`);
  if (!response.ok) {
    const kind = kindForStatus(response.status);
    throw new DemoError(kind, await extractMessage(response, kind));
  }
  return response.json();
}
