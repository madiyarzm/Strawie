/**
 * Typed client for groups-with-schedules, lessons and homework.
 * Unlike the older helpers in lib/api.ts, every non-2xx response throws an
 * Error carrying the server's message, so screens can show it.
 */

export type Schedule = { days: number[]; time: string; tz: string };

export type Group = {
  id: string;
  teacher_id: string;
  name: string;
  invite_code: string | null;
  schedule: Schedule | null;
  member_count: number;
};

export type MyHomework = { submitted_at: string; score: number; max_score: number; has_feedback: boolean };

export type Lesson = {
  id: string;
  group_id: string;
  group_name: string;
  title: string | null;
  topic: string | null;
  starts_at: string;
  room_mode: "together" | "solo";
  live: boolean;
  homework_enabled: boolean;
  homework_due_at: string | null;
  is_teacher: boolean;
  my_homework: MyHomework | null;
  submitted_count: number | null;
  student_count: number | null;
};

export type Slot = { group_id: string; group_name: string; starts_at: string; is_teacher: boolean };
export type Agenda = { lessons: Lesson[]; open_slots: Slot[] };

export type HomeworkTest = { id: string; kind: "call" | "io"; call: string; expected: string; stdin: string; hidden: boolean };
export type ProblemTests = { block_id: string; tests: HomeworkTest[] };

export type Failure = { test_id: string; label: string; expected: string; got: string };
export type ProblemResult = { passed: number; total: number; failures: Failure[] };

export type Submission = {
  id: string;
  lesson_id: string;
  user_id: string;
  user_name: string;
  blocks: { id: string; type: "text" | "code"; text: string }[];
  results: Record<string, ProblemResult>;
  score: number;
  max_score: number;
  feedback: string | null;
  submitted_at: string;
};

export type RosterRow = { user_id: string; name: string; submission: Submission | null };

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    credentials: "include",
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
  if (!res.ok) {
    const detail = data?.detail;
    const message = typeof detail === "string" ? detail : res.status === 422 ? "Some fields are invalid." : res.statusText;
    throw new Error(message || "Request failed");
  }
  return data as T;
}

const L = "/api/v1/lessons";

export const lessonsApi = {
  agenda: () => request<Agenda>("GET", `${L}/agenda`),
  forGroup: (groupId: string) => request<Lesson[]>("GET", `${L}?group_id=${encodeURIComponent(groupId)}`),
  get: (id: string) => request<Lesson>("GET", `${L}/${id}`),
  create: (groupId: string, startsAt: string, title?: string) =>
    request<Lesson>("POST", L, { group_id: groupId, starts_at: startsAt, ...(title ? { title } : {}) }),
  update: (id: string, changes: Partial<{
    title: string | null; topic: string | null; room_mode: "together" | "solo"; live: boolean;
    homework_enabled: boolean; homework_due_at: string | null; starts_at: string;
  }>) => request<Lesson>("PATCH", `${L}/${id}`, changes),
  remove: (id: string) => request<void>("DELETE", `${L}/${id}`),
  presence: (id: string) => request<string[]>("GET", `${L}/${id}/presence`),
  tests: (id: string) => request<ProblemTests[]>("GET", `${L}/${id}/homework/tests`),
  submit: (id: string, blocks: Submission["blocks"], results: Record<string, ProblemResult>) =>
    request<Submission>("POST", `${L}/${id}/homework/submissions`, { blocks, results }),
  roster: (id: string) => request<RosterRow[]>("GET", `${L}/${id}/homework/submissions`),
  feedback: (submissionId: string, feedback: string) =>
    request<Submission>("PATCH", `${L}/homework-submissions/${submissionId}/feedback`, { feedback }),
};

export const groupsApi = {
  list: () => request<Group[]>("GET", "/api/v1/groups/"),
  create: (name: string, schedule: Schedule | null) =>
    request<Group>("POST", "/api/v1/groups/", { name, description: "", schedule }),
  update: (id: string, changes: { name?: string; schedule?: Schedule | null }) =>
    request<Group>("PATCH", `/api/v1/groups/${id}`, changes),
  members: (id: string) => request<{ user_id: string; name: string; email: string; role: string }[]>(
    "GET", `/api/v1/groups/${id}/members`),
};

export const DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

export function browserTimeZone(): string {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch { return "UTC"; }
}

export function lessonTitle(lesson: { title: string | null }, untitled: string): string {
  return lesson.title?.trim() || untitled;
}
