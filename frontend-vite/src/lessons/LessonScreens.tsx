/**
 * Lesson, homework and review screens.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import * as Y from "yjs";
import { ArrowLeft, Check, Clock, LifeBuoy, Lock, PenLine, FileText, Users } from "lucide-react";
import { DrawingCanvas } from "../components/DrawingCanvas";
import { lessonTitle, lessonsApi } from "./api";
import type { Lesson, ProblemResult, RosterRow, Submission } from "./api";
import { NotebookPage } from "./NotebookPage";
import { snapshotBlocks } from "./pageDoc";
import type { BlockResult } from "./NotebookPage";
import { gradeProblem, toProblemResult } from "./grading";
import { dateTime, relative } from "./format";

type Me = { id: string; displayName: string; role: "teacher" | "student" };

function usePolledLesson(lessonId: string, intervalMs: number) {
  const [lesson, setLesson] = useState<Lesson | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try { setLesson(await lessonsApi.get(lessonId)); setError(null); } catch (e) { setError((e as Error).message); }
  }, [lessonId]);
  useEffect(() => {
    void load();
    const id = setInterval(load, intervalMs);
    return () => clearInterval(id);
  }, [load, intervalMs]);
  return { lesson, setLesson, error, reload: load };
}

const Seg: React.FC<{ value: string; options: { id: string; label: string; icon?: React.ReactNode }[]; onChange: (id: string) => void; label: string }> = ({ value, options, onChange, label }) => (
  <div className="st-seg" role="group" aria-label={label}>
    {options.map(o => (
      <button key={o.id} type="button" aria-pressed={value === o.id} onClick={() => onChange(o.id)}>{o.icon}{o.label}</button>
    ))}
  </div>
);

// ── Lesson ────────────────────────────────────────────────────────────────

export const LessonScreen: React.FC<{ lessonId: string; me: Me; onBack: () => void; onReview: (lessonId: string) => void }> = ({ lessonId, me, onBack, onReview }) => {
  const { t } = useTranslation();
  const { lesson, setLesson, error } = usePolledLesson(lessonId, 3000);
  const [surface, setSurface] = useState<"page" | "board">("page");
  const [tab, setTab] = useState<"class" | "homework">("class");
  const [focus, setFocus] = useState<string | null>(null);
  const [students, setStudents] = useState<RosterRow[]>([]);
  const [online, setOnline] = useState<string[]>([]);
  const [handRaised, setHandRaised] = useState(false);
  const [customizing, setCustomizing] = useState<string | null>(null);
  const [titleDraft, setTitleDraft] = useState<string | null>(null);
  const teacher = !!lesson?.is_teacher;

  // Roster (names) and who's connected, for the teacher's solo grid.
  useEffect(() => {
    if (!teacher) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const [roster, presence] = await Promise.all([lessonsApi.roster(lessonId), lessonsApi.presence(lessonId)]);
        if (!cancelled) { setStudents(roster); setOnline(presence); }
      } catch { /* keep last */ }
    };
    void tick();
    const id = setInterval(tick, 5000);
    return () => { cancelled = true; clearInterval(id); };
  }, [teacher, lessonId]);

  const update = async (changes: Parameters<typeof lessonsApi.update>[1]) => {
    try { setLesson(await lessonsApi.update(lessonId, changes)); } catch { /* polled again shortly */ }
  };

  if (error && !lesson) return <div className="ls-screen"><p className="ls-muted">{error}</p></div>;
  if (!lesson) return <div className="ls-screen"><p className="ls-muted">{t("common.loading")}</p></div>;

  const solo = lesson.live && lesson.room_mode === "solo";
  const title = lessonTitle(lesson, t("lessons.untitled", { defaultValue: "Untitled lesson" }));
  const page = (roomId: string, opts: { kind: "board" | "solo" | "master" | "homework"; text: boolean; structure: boolean }) => (
    <NotebookPage key={roomId} roomId={roomId} kind={opts.kind} userName={me.displayName} userRole={me.role}
      canEditText={opts.text} canEditStructure={opts.structure} handRaised={handRaised} />
  );

  let body: React.ReactNode;
  if (surface === "board") {
    body = <div className="ls-board"><DrawingCanvas roomId={`lesson:${lesson.id}:draw`} userName={me.displayName} userRole={me.role} className="h-full" /></div>;
  } else if (teacher && tab === "homework") {
    body = (
      <>
        <div className="ls-banner">
          {lesson.homework_enabled ? (
            <>
              <Clock className="h-4 w-4" />
              <span>{t("lessons.lesson.dueBy", { defaultValue: "Due {{when}}", when: lesson.homework_due_at ? dateTime(lesson.homework_due_at) : "—" })}</span>
              <input type="datetime-local" className="st-input ls-due-input" aria-label={t("lessons.lesson.changeDue", { defaultValue: "Change due date" })}
                value={lesson.homework_due_at ? toLocalInput(lesson.homework_due_at) : ""}
                onChange={e => e.target.value && void update({ homework_due_at: new Date(e.target.value).toISOString() })} />
              <span className="ls-spacer" />
              <button type="button" className="st-btn st-btn-ghost st-btn-sm" onClick={() => onReview(lesson.id)}>{t("lessons.submittedOf", { defaultValue: "{{n}}/{{total}} submitted", n: lesson.submitted_count, total: lesson.student_count })}</button>
            </>
          ) : (
            <>
              <span>{t("lessons.lesson.notGiven", { defaultValue: "Students can't see this yet. Prepare the problems, then give the homework." })}</span>
              <span className="ls-spacer" />
              <button type="button" className="st-btn st-btn-primary st-btn-sm" onClick={() => void update({ homework_enabled: true })}>{t("lessons.lesson.give", { defaultValue: "Give homework" })}</button>
            </>
          )}
        </div>
        <div className="ls-canvas">
          <div className="ls-custom">
            <span>{t("lessons.lesson.sameForEveryone", { defaultValue: "Same for everyone. Change one student's copy:" })}</span>
            <button type="button" className={`ls-kid ${customizing === null ? "is-on" : ""}`} onClick={() => setCustomizing(null)}>{t("lessons.lesson.master", { defaultValue: "Everyone" })}</button>
            {students.map(s => (
              <button type="button" key={s.user_id} className={`ls-kid ${customizing === s.user_id ? "is-on" : ""}`} onClick={() => setCustomizing(s.user_id)}>
                <span className="ls-avatar sm">{s.name[0]?.toUpperCase()}</span>{s.name}
              </button>
            ))}
          </div>
          {customizing === null
            ? page(`lesson:${lesson.id}:hw`, { kind: "master", text: true, structure: true })
            : (
              <>
                <p className="ls-note">{t("lessons.lesson.customNote", { defaultValue: "You're editing only this student's copy. Tests stay the same as everyone's." })}</p>
                {page(`lesson:${lesson.id}:hw:${customizing}`, { kind: "homework", text: true, structure: true })}
              </>
            )}
          <p className="ls-note center">{t("lessons.lesson.testsNote", { defaultValue: "Tests run in each student's browser when they submit. Students who already opened the homework keep their copy." })}</p>
        </div>
      </>
    );
  } else if (teacher && solo) {
    if (focus) {
      const student = students.find(s => s.user_id === focus);
      body = (
        <>
          <div className="ls-banner">
            <span className="ls-avatar sm">{student?.name[0]?.toUpperCase()}</span>
            <span>{t("lessons.lesson.onStudentPage", { defaultValue: "You're on {{name}}'s page. They see your cursor.", name: student?.name ?? "" })}</span>
            <span className="ls-spacer" />
            <button type="button" className="st-btn st-btn-secondary st-btn-sm" onClick={() => setFocus(null)}><ArrowLeft className="h-3.5 w-3.5" />{t("lessons.lesson.allStudents", { defaultValue: "All students" })}</button>
          </div>
          <div className="ls-canvas">{page(`lesson:${lesson.id}:solo:${focus}`, { kind: "solo", text: true, structure: true })}</div>
        </>
      );
    } else {
      body = (
        <>
          <div className="ls-banner">
            <span>{t("lessons.lesson.soloHint", { defaultValue: "Everyone works on their own copy of the page. Only you can see all of them." })}</span>
            <span className="ls-spacer" />
            <button type="button" className="st-btn st-btn-primary st-btn-sm" onClick={() => void update({ room_mode: "together" })}>{t("lessons.lesson.bringBack", { defaultValue: "Bring everyone back" })}</button>
          </div>
          <div className="ls-solo-grid">
            {students.length === 0 && <p className="ls-muted">{t("lessons.group.noStudents", { defaultValue: "No students yet. Share the invite link." })}</p>}
            {students.map(s => (
              <button type="button" key={s.user_id} className="st-card ls-tile" onClick={() => setFocus(s.user_id)}>
                <span className="ls-avatar">{s.name[0]?.toUpperCase()}</span>
                <span className="ls-row-main"><b>{s.name}</b><span>{online.includes(s.user_id) ? t("lessons.lesson.online", { defaultValue: "Working now" }) : t("lessons.lesson.offline", { defaultValue: "Not connected" })}</span></span>
                <span className={`ls-presence ${online.includes(s.user_id) ? "on" : ""}`} />
              </button>
            ))}
          </div>
        </>
      );
    }
  } else if (!teacher && solo) {
    body = (
      <>
        <div className="ls-banner">{t("lessons.lesson.soloStudent", { defaultValue: "Solo time: this is your own copy. Your teacher can see it." })}</div>
        <div className="ls-canvas">{page(`lesson:${lesson.id}:solo:${me.id}`, { kind: "solo", text: true, structure: false })}</div>
      </>
    );
  } else {
    body = <div className="ls-canvas">{page(`lesson:${lesson.id}:board`, { kind: "board", text: teacher, structure: teacher })}</div>;
  }

  return (
    <div className="ls-work">
      <header className="ls-topbar">
        <button type="button" className="st-icon-btn" onClick={onBack} aria-label={t("common.back")}><ArrowLeft className="h-4 w-4" /></button>
        <div className="ls-top-title">
          <span className="ls-crumb">{lesson.group_name} /</span>
          {teacher ? (
            <input className="ls-title-input" value={titleDraft ?? lesson.title ?? ""} placeholder={t("lessons.untitled", { defaultValue: "Untitled lesson" })}
              onChange={e => setTitleDraft(e.target.value)}
              onBlur={() => { if (titleDraft !== null && titleDraft !== (lesson.title ?? "")) void update({ title: titleDraft.trim() || null }); setTitleDraft(null); }}
              onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} maxLength={200} aria-label={t("lessons.lesson.titleLabel", { defaultValue: "Lesson title" })} />
          ) : <h1>{title}</h1>}
        </div>
        {teacher && (
          <input className="st-input ls-topic-input" defaultValue={lesson.topic ?? ""} placeholder={t("lessons.lesson.topic", { defaultValue: "Topic tag" })} maxLength={60}
            onBlur={e => { const v = e.target.value.trim() || null; if (v !== lesson.topic) void update({ topic: v }); }} aria-label={t("lessons.lesson.topic", { defaultValue: "Topic tag" })} />
        )}
        {lesson.live && <span className="st-chip ls-live"><span className="ls-dot" />{t("lessons.live", { defaultValue: "Live" })}</span>}
        <span className="ls-spacer" />
        {teacher && (
          <Seg label={t("lessons.lesson.pages", { defaultValue: "Pages" })} value={tab} onChange={v => { setTab(v as "class" | "homework"); setSurface("page"); setFocus(null); }}
            options={[{ id: "class", label: t("lessons.lesson.classPage", { defaultValue: "Class page" }) }, { id: "homework", label: t("lessons.homework", { defaultValue: "Homework" }) }]} />
        )}
        <Seg label={t("lessons.lesson.surface", { defaultValue: "Surface" })} value={surface} onChange={v => setSurface(v as "page" | "board")}
          options={[{ id: "page", label: t("lessons.lesson.page", { defaultValue: "Page" }), icon: <FileText className="h-3.5 w-3.5" /> }, { id: "board", label: t("lessons.lesson.whiteboard", { defaultValue: "Whiteboard" }), icon: <PenLine className="h-3.5 w-3.5" /> }]} />
        {teacher && lesson.live && tab === "class" && (
          <Seg label={t("lessons.lesson.roomMode", { defaultValue: "Room mode" })} value={lesson.room_mode} onChange={v => { setFocus(null); void update({ room_mode: v as "together" | "solo" }); }}
            options={[{ id: "together", label: t("lessons.lesson.together", { defaultValue: "Together" }), icon: <Users className="h-3.5 w-3.5" /> }, { id: "solo", label: t("lessons.lesson.solo", { defaultValue: "Solo" }) }]} />
        )}
        {teacher ? (
          lesson.live
            ? <button type="button" className="st-btn st-btn-secondary st-btn-sm" onClick={() => void update({ live: false })}>{t("lessons.lesson.end", { defaultValue: "End lesson" })}</button>
            : <button type="button" className="st-btn st-btn-primary st-btn-sm" onClick={() => void update({ live: true })}>{t("lessons.start", { defaultValue: "Start lesson" })}</button>
        ) : (
          <button type="button" className={`st-btn st-btn-sm ${handRaised ? "st-btn-warn" : "st-btn-ghost"}`} aria-pressed={handRaised} onClick={() => setHandRaised(v => !v)}>
            <LifeBuoy className="h-3.5 w-3.5" />{handRaised ? t("app.assignment.handRaised") : t("app.assignment.askForHelp")}
          </button>
        )}
      </header>
      {body}
    </div>
  );
};

function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ── Homework (student) ────────────────────────────────────────────────────

export const HomeworkScreen: React.FC<{ lessonId: string; me: Me; onBack: () => void }> = ({ lessonId, me, onBack }) => {
  const { t } = useTranslation();
  const { lesson, error } = usePolledLesson(lessonId, 30_000);
  const docRef = useRef<Y.Doc | null>(null);
  const [results, setResults] = useState<Record<string, BlockResult> | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [mine, setMine] = useState<Submission | null>(null);

  useEffect(() => {
    lessonsApi.roster(lessonId).then(rows => setMine(rows[0]?.submission ?? null), () => setMine(null));
  }, [lessonId]);

  const onDoc = useCallback((d: Y.Doc) => { docRef.current = d; }, []);

  const submit = async () => {
    const doc = docRef.current;
    if (!doc) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const problems = await lessonsApi.tests(lessonId);
      const testsById = new Map(problems.map(p => [p.block_id, p.tests]));
      const arr = doc.getArray<Y.Map<unknown>>("blocks").toArray();
      const shown: Record<string, BlockResult> = {};
      const sent: Record<string, ProblemResult> = {};
      const before: string[] = [];
      for (const block of arr) {
        if (block.get("type") !== "code") continue;
        const id = String(block.get("id"));
        const code = (block.get("text") as Y.Text).toString();
        const tests = testsById.get(id);
        if (tests && tests.length) {
          const outcomes = await gradeProblem([...before], code, tests);
          const result = toProblemResult(outcomes);
          sent[id] = result;
          shown[id] = { passed: result.passed, total: result.total, outcomes };
        }
        before.push(code);
      }
      setResults(shown);
      setMine(await lessonsApi.submit(lessonId, snapshotBlocks(doc), sent));
    } catch (e) {
      setSubmitError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  if (error && !lesson) return <div className="ls-screen"><p className="ls-muted">{error}</p></div>;
  if (!lesson) return <div className="ls-screen"><p className="ls-muted">{t("common.loading")}</p></div>;
  const due = lesson.homework_due_at;
  const overdue = due ? new Date(due).getTime() < Date.now() : false;

  return (
    <div className="ls-work">
      <header className="ls-topbar">
        <button type="button" className="st-icon-btn" onClick={onBack} aria-label={t("common.back")}><ArrowLeft className="h-4 w-4" /></button>
        <div className="ls-top-title"><span className="ls-crumb">{t("lessons.homework", { defaultValue: "Homework" })} /</span><h1>{lessonTitle(lesson, t("lessons.untitled", { defaultValue: "Untitled lesson" }))}</h1></div>
        {due && <span className={`st-chip ${overdue ? "ls-bad" : "ls-warn"}`}><Clock className="h-3.5 w-3.5" />{overdue ? t("lessons.overdue", { defaultValue: "Overdue" }) : `${t("lessons.due", { defaultValue: "Due" })} ${relative(due)}`}</span>}
        <span className="ls-spacer" />
        <span className="ls-private"><Lock className="h-3.5 w-3.5" />{t("lessons.hw.private", { defaultValue: "Only you and your teacher see this" })}</span>
        <button type="button" className="st-btn st-btn-primary st-btn-sm" disabled={submitting} onClick={() => void submit()}>
          {submitting ? <span className="h-3.5 w-3.5 rounded-full border-2 animate-spin" style={{ borderColor: "currentColor", borderTopColor: "transparent" }} /> : <Check className="h-3.5 w-3.5" strokeWidth={2.5} />}
          {submitting ? t("lessons.hw.checking", { defaultValue: "Checking…" }) : mine ? t("lessons.hw.submitAgain", { defaultValue: "Submit again" }) : t("app.assignment.submit")}
        </button>
      </header>
      {submitError && <div className="ls-banner ls-banner-bad">{submitError}</div>}
      {mine && (
        <div className="ls-banner">
          <span className={`ls-score ${mine.score === mine.max_score ? "ok" : "warn"}`}>{mine.score}/{mine.max_score}</span>
          <span>{mine.max_score === 0
            ? t("lessons.hw.submittedNoTests", { defaultValue: "Submitted. Your teacher will check it." })
            : mine.score === mine.max_score
              ? t("lessons.hw.allPassed", { defaultValue: "All tests passed. Nice work!" })
              : t("lessons.hw.someFailed", { defaultValue: "Some tests failed. Fix them and submit again; your teacher sees your latest try." })}</span>
          {mine.feedback && <span className="ls-feedback"><b>{t("lessons.hw.teacherSays", { defaultValue: "Teacher:" })}</b> {mine.feedback}</span>}
        </div>
      )}
      <div className="ls-canvas">
        <p className="ls-note">{t("lessons.hw.runHint", { defaultValue: "▶ runs a block together with the blocks above it, so your variables carry down the page." })}</p>
        <NotebookPage roomId={`lesson:${lesson.id}:hw:${me.id}`} kind="homework" userName={me.displayName} userRole={me.role}
          canEditText={false} canEditStructure={false} results={results ?? undefined} onDoc={onDoc} />
      </div>
    </div>
  );
};

// ── Review (teacher) ──────────────────────────────────────────────────────

export const ReviewScreen: React.FC<{ lessonId?: string; me: Me; onBack: () => void; onPick: (lessonId: string) => void }> = ({ lessonId, me, onBack, onPick }) => {
  const { t } = useTranslation();
  const [lessons, setLessons] = useState<Lesson[] | null>(null);
  const [lesson, setLesson] = useState<Lesson | null>(null);
  const [roster, setRoster] = useState<RosterRow[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (lessonId) return;
    lessonsApi.agenda().then(a => setLessons(a.lessons.filter(l => l.is_teacher && l.homework_enabled)
      .sort((x, y) => new Date(y.starts_at).getTime() - new Date(x.starts_at).getTime())), () => setLessons([]));
  }, [lessonId]);

  useEffect(() => {
    if (!lessonId) return;
    lessonsApi.get(lessonId).then(setLesson, () => setLesson(null));
    lessonsApi.roster(lessonId).then(rows => {
      setRoster(rows);
      setSelected(s => s ?? rows.find(r => r.submission)?.user_id ?? rows[0]?.user_id ?? null);
    }, () => setRoster([]));
  }, [lessonId]);

  const row = roster.find(r => r.user_id === selected) ?? null;
  const sub = row?.submission ?? null;
  useEffect(() => { setFeedback(sub?.feedback ?? ""); setSaved(false); setLive(false); }, [sub?.id, selected]);

  if (!lessonId) {
    return (
      <div className="ls-screen">
        <div className="ls-head"><div><h1>{t("lessons.review.title", { defaultValue: "Review" })}</h1><p>{t("lessons.review.pick", { defaultValue: "Homework from your recent lessons." })}</p></div></div>
        <div className="st-card">
          {lessons === null && <p className="ls-card-empty">{t("common.loading")}</p>}
          {lessons?.length === 0 && <p className="ls-card-empty">{t("lessons.review.none", { defaultValue: "No homework given in the last two weeks." })}</p>}
          {lessons?.map(l => (
            <button type="button" key={l.id} className="ls-row" onClick={() => onPick(l.id)}>
              <span className="ls-row-main"><b>{lessonTitle(l, t("lessons.untitled", { defaultValue: "Untitled lesson" }))}</b><span>{l.group_name} · {l.homework_due_at ? dateTime(l.homework_due_at) : ""}</span></span>
              <span className="st-chip">{t("lessons.submittedOf", { defaultValue: "{{n}}/{{total}} submitted", n: l.submitted_count, total: l.student_count })}</span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  const results: Record<string, BlockResult> | undefined = sub
    ? Object.fromEntries(Object.entries(sub.results).map(([id, r]) => [id, { passed: r.passed, total: r.total, failures: r.failures }]))
    : undefined;

  return (
    <div className="ls-screen">
      <div className="ls-head">
        <div>
          <button type="button" className="st-btn st-btn-ghost st-btn-sm" style={{ marginLeft: -10 }} onClick={onBack}><ArrowLeft className="h-3.5 w-3.5" />{t("lessons.review.title", { defaultValue: "Review" })}</button>
          <h1>{lesson ? lessonTitle(lesson, t("lessons.untitled", { defaultValue: "Untitled lesson" })) : ""}</h1>
          <p>{lesson?.group_name}{lesson?.homework_due_at ? ` · ${t("lessons.due", { defaultValue: "Due" })} ${dateTime(lesson.homework_due_at)}` : ""}</p>
        </div>
      </div>
      <div className="ls-review">
        <div className="st-card">
          {roster.map(r => (
            <button type="button" key={r.user_id} className={`ls-row ${r.user_id === selected ? "is-selected" : ""}`} onClick={() => setSelected(r.user_id)}>
              <span className="ls-avatar">{r.name[0]?.toUpperCase()}</span>
              <span className="ls-row-main"><b>{r.name}</b><span>{r.submission ? dateTime(r.submission.submitted_at) : t("lessons.notStarted", { defaultValue: "Not submitted" })}</span></span>
              <span className={`st-chip ${!r.submission ? "ls-bad" : r.submission.score === r.submission.max_score ? "ls-ok" : "ls-warn"}`}>{r.submission ? `${r.submission.score}/${r.submission.max_score}` : "—"}</span>
            </button>
          ))}
          {roster.length === 0 && <p className="ls-card-empty">{t("lessons.group.noStudents", { defaultValue: "No students yet. Share the invite link." })}</p>}
        </div>
        <div className="grid gap-4 content-start min-w-0">
          {row && (
            <div className="flex flex-wrap items-center gap-2">
              <div className="st-seg">
                <button type="button" aria-pressed={!live} onClick={() => setLive(false)} disabled={!sub}>{t("lessons.review.submitted", { defaultValue: "Submitted version" })}</button>
                <button type="button" aria-pressed={live} onClick={() => setLive(true)}>{t("lessons.review.live", { defaultValue: "Live page" })}</button>
              </div>
              <span className="ls-muted" style={{ fontSize: 12.5 }}>{live ? t("lessons.review.liveHint", { defaultValue: "Edit their page directly, e.g. to leave a hint in the code." }) : ""}</span>
            </div>
          )}
          {row && live && lesson && (
            <NotebookPage key={row.user_id} roomId={`lesson:${lesson.id}:hw:${row.user_id}`} kind="homework" userName={me.displayName} userRole="teacher" canEditText canEditStructure={false} />
          )}
          {row && !live && !sub && <div className="st-card ls-empty"><h2>{t("lessons.review.notYet", { defaultValue: "{{name}} hasn't submitted yet", name: row.name })}</h2><p>{t("lessons.review.openLive", { defaultValue: "Open their live page to see where they are." })}</p></div>}
          {row && !live && sub && (
            <div className="nb-page" style={{ maxWidth: "none", width: "100%" }}>
              {sub.blocks.map(b => b.type === "text"
                ? <p key={b.id} className="ls-snap-text">{b.text}</p>
                : (
                  <div key={b.id} className="nb-code-card">
                    {results?.[b.id] && (
                      <div className="nb-problem" style={{ margin: "8px 12px 0" }}>
                        <span className={`st-chip ${results[b.id].passed === results[b.id].total ? "nb-ok" : "nb-warn"}`} style={{ height: 22, fontSize: 11.5 }}>
                          {t("lessons.page.testsPassed", { defaultValue: "{{passed}}/{{total}} tests", passed: results[b.id].passed, total: results[b.id].total })}
                        </span>
                      </div>
                    )}
                    <pre className="ls-snap-code">{b.text || " "}</pre>
                    {results?.[b.id]?.failures && results[b.id].failures!.length > 0 && (
                      <div className="nb-tests">{results[b.id].failures!.map((f, i) => (
                        <div key={i} className="nb-test"><span className="nb-test-ic bad">✕</span><span className="nb-test-label">{f.label}{f.expected ? <span style={{ color: "var(--text-3)" }}> → {f.expected}</span> : null}</span>{f.got && <span className="nb-test-got">{t("lessons.page.got", { defaultValue: "got" })} <b>{f.got}</b></span>}</div>
                      ))}</div>
                    )}
                  </div>
                ))}
            </div>
          )}
          {sub && (
            <div className="st-card" style={{ padding: 16 }}>
              <label className="ls-field">
                <span>{t("lessons.review.feedbackFor", { defaultValue: "Feedback for {{name}}", name: row?.name })}</span>
                <textarea className="st-input" rows={3} value={feedback} onChange={e => { setFeedback(e.target.value); setSaved(false); }} maxLength={5000}
                  placeholder={t("lessons.review.feedbackPlaceholder", { defaultValue: "Only this student will see it." })} />
              </label>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" className="st-btn st-btn-primary st-btn-sm" disabled={saved} onClick={async () => {
                  const updated = await lessonsApi.feedback(sub.id, feedback);
                  setRoster(rs => rs.map(r => r.user_id === updated.user_id ? { ...r, submission: updated } : r));
                  setSaved(true);
                }}>{saved ? t("lessons.review.sent", { defaultValue: "Sent" }) : t("lessons.review.send", { defaultValue: "Send feedback" })}</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
