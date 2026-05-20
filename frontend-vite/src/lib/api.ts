/**
 * API client for Strawie backend.
 *
 * Mirrors the backend REST API with typed wrappers.
 *
 * Authentication: the backend sets the JWT as an httpOnly cookie. The browser
 * sends it automatically with every same-origin request when
 * `credentials: "include"` is set, so this client never sees or stores the
 * token in JavaScript — XSS can't steal it.
 */

// Same-origin in both dev and prod:
//   * Dev: Vite proxies /api and /ws to the FastAPI backend on :8000.
//   * Prod: FastAPI serves the built frontend, so it's literally same-origin.
// VITE_API_URL can override this for unusual setups.
const API_BASE: string =
  (import.meta.env.VITE_API_URL as string | undefined) ?? "";

async function api(
  method: string,
  path: string,
  body: unknown = null,
): Promise<any> {
  const opts: RequestInit = {
    method,
    headers: { "Content-Type": "application/json" },
    credentials: "include",
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${API_BASE}${path}`, opts);
  if (res.status === 401) {
    throw new Error("Unauthorized");
  }
  if (res.status === 204) return null;
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(res.statusText || "Request failed");
  }
}

export const apiClient = {
  get: (path: string) => api("GET", path),
  post: (path: string, body: unknown) => api("POST", path, body),
  put: (path: string, body: unknown) => api("PUT", path, body),
  patch: (path: string, body: unknown) => api("PATCH", path, body),
  delete: (path: string) => api("DELETE", path),
};

export function getSandboxWsUrl(): string {
  // Same-origin WS — cookies travel with the handshake automatically.
  const httpBase = (import.meta.env.VITE_API_URL as string | undefined) ?? "";
  const wsBase = httpBase
    ? httpBase.replace(/^http/, "ws")
    : `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}`;
  return `${wsBase}/ws/sandbox/run`;
}

// --- Health ---

export async function healthCheck(): Promise<any | null> {
  const url = API_BASE ? `${API_BASE}/health` : "/health";
  const res = await fetch(url);
  return res.ok ? await res.json() : null;
}

// --- Auth ---

export function isInAppBrowser(): boolean {
  const ua = navigator.userAgent;
  // LinkedIn, Facebook, Instagram, Twitter/X in-app browsers all block Google OAuth (error 403 disallowed_useragent)
  return /LinkedIn|FBAN|FBAV|FBIOS|Instagram|Twitter\/|Snapchat|MicroMessenger|Line\//.test(ua);
}

export function googleLogin(): void {
  const url = `${API_BASE}/api/v1/auth/google`;

  if (!isInAppBrowser()) {
    window.location.href = url;
    return;
  }

  if (/Android/.test(navigator.userAgent)) {
    // Android: intent:// URL forces the OS to open the URL in Chrome instead of the in-app WebView.
    // Strips the https:// prefix because the intent scheme carries it separately.
    window.location.href = `intent://${url.replace(/^https?:\/\//, "")}#Intent;scheme=https;package=com.android.chrome;end`;
  } else {
    // iOS: window.open with _blank causes LinkedIn to hand off to Safari in most cases.
    window.open(url, "_blank");
  }
}

export async function getMe(): Promise<any> {
  return apiClient.get("/api/v1/users/me");
}

/**
 * One-shot role selection on first login. The backend rejects with 409 if
 * the role has already been chosen; the frontend should route around that
 * by checking `role_locked` from getMe() before calling this.
 */
export async function chooseRole(role: "teacher" | "student"): Promise<any> {
  return apiClient.post("/api/v1/users/me/role", { role });
}

export async function getMyStats(): Promise<{ xp: number; submissions_total: number; submissions_accepted: number }> {
  return apiClient.get("/api/v1/users/me/stats");
}

export async function getMyCosmetics(): Promise<Record<string, unknown>> {
  return apiClient.get("/api/v1/users/me/cosmetics");
}

export async function updateMyCosmetics(cosmetics: Record<string, unknown>): Promise<Record<string, unknown>> {
  return apiClient.put("/api/v1/users/me/cosmetics", { cosmetics });
}

export async function getMyActivity(): Promise<{ days: { date: string; count: number }[] }> {
  return apiClient.get("/api/v1/users/me/activity");
}

/**
 * Log out: clear the auth cookie on the server. With cookie auth there is
 * no token in JS to check, so callers determine logged-in state by calling
 * getMe() and catching a 401.
 */
export async function logout(): Promise<void> {
  try {
    await apiClient.post("/api/v1/auth/logout", {});
  } catch {
    // Already logged out / network blip — caller will redirect anyway.
  }
}

// --- Admin ---

export async function listAllUsers(): Promise<any[]> {
  return apiClient.get("/api/v1/users/");
}

export async function updateUserRole(userId: string, role: "teacher" | "student"): Promise<any> {
  return apiClient.patch(`/api/v1/users/${userId}/role`, { role });
}

// --- Groups ---

export async function listGroups(): Promise<any[]> {
  return apiClient.get("/api/v1/groups/");
}

export async function createGroup(
  name: string,
  description = "",
): Promise<any> {
  return apiClient.post("/api/v1/groups/", { name, description });
}

export async function joinGroup(inviteCode: string): Promise<any> {
  return apiClient.post("/api/v1/groups/join", { invite_code: inviteCode });
}

export async function getGroup(groupId: string): Promise<any> {
  return apiClient.get(`/api/v1/groups/${groupId}`);
}

export async function listGroupMembers(groupId: string): Promise<any[]> {
  return apiClient.get(`/api/v1/groups/${groupId}/members`);
}

export async function removeGroupMember(groupId: string, userId: string): Promise<void> {
  await apiClient.delete(`/api/v1/groups/${groupId}/members/${userId}`);
}

export async function deleteGroup(groupId: string): Promise<void> {
  await apiClient.delete(`/api/v1/groups/${groupId}`);
}

// --- Classrooms ---

export async function listClassrooms(groupId?: string): Promise<any[]> {
  const q = groupId ? `?group_id=${groupId}` : "";
  return apiClient.get(`/api/v1/classrooms/${q}`);
}

export async function createClassroom(
  groupId: string,
  name: string,
  description = "",
): Promise<any> {
  return apiClient.post("/api/v1/classrooms/", {
    group_id: groupId,
    name,
    description,
  });
}

export async function deleteClassroom(classroomId: string): Promise<void> {
  await apiClient.delete(`/api/v1/classrooms/${classroomId}`);
}

export async function getClassroomActiveCounts(): Promise<Record<string, number>> {
  return apiClient.get("/api/v1/classrooms/active-counts");
}

export async function leaveGroup(groupId: string): Promise<void> {
  await apiClient.post(`/api/v1/groups/${groupId}/leave`, {});
}

// --- Assignments ---

export async function listAssignments(classroomId: string): Promise<any[]> {
  return apiClient.get(`/api/v1/assignments/?classroom_id=${classroomId}`);
}

export async function getHint(assignmentId: string, code: string, attemptNumber: number): Promise<string> {
  const res = await apiClient.post(`/api/v1/assignments/${assignmentId}/hint`, { code, attempt_number: attemptNumber });
  return res?.hint ?? "Keep going — you're almost there!";
}

export async function createAssignment(
  classroomId: string,
  title: string,
  description = "",
  templateCode = "",
  dueAt: string | null = null,
  testCode: string | null = null,
): Promise<any> {
  return apiClient.post("/api/v1/assignments/", {
    classroom_id: classroomId,
    title,
    description,
    template_code: templateCode,
    test_code: testCode,
    due_at: dueAt,
  });
}

export async function addSubmissionFeedback(submissionId: string, feedback: string): Promise<any> {
  return apiClient.patch(`/api/v1/submissions/${submissionId}/feedback`, { feedback });
}

// --- Submissions ---

export async function listSubmissions(assignmentId: string): Promise<any[]> {
  return apiClient.get(`/api/v1/submissions/?assignment_id=${assignmentId}`);
}

export async function getSubmission(submissionId: string): Promise<any> {
  return apiClient.get(`/api/v1/submissions/${submissionId}`);
}

export async function createSubmission(
  assignmentId: string,
  code: string,
  status?: string,
  resultJson?: Record<string, unknown>,
): Promise<any> {
  const body: Record<string, unknown> = { assignment_id: assignmentId, code };
  if (status) body.status = status;
  if (resultJson) body.result_json = resultJson;
  return apiClient.post("/api/v1/submissions/", body);
}

// --- Sandbox ---

export async function runSandbox(code: string, stdin = ""): Promise<any> {
  return apiClient.post("/api/v1/sandbox/run", { code, stdin });
}
