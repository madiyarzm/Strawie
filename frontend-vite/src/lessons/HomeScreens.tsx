/**
 * Schedule-driven home and group screens, and the one-step group sheet.
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Calendar, Copy, LogIn, Plus, Users } from "lucide-react";
import { DAY_KEYS, browserTimeZone, groupsApi, lessonTitle, lessonsApi } from "./api";
import type { Agenda, Group, Lesson, Slot } from "./api";
import { dayMonth, dayNumber, isToday, relative, timeOf, weekdayNames, weekdayShort } from "./format";
import { lessonForSlot, scheduleSummary } from "./schedule";

export type Nav = {
  openLesson: (lessonId: string) => void;
  openHomework: (lessonId: string) => void;
  openReview: (lessonId?: string) => void;
  openGroup: (groupId: string) => void;
  newGroup: () => void;
  joinGroup: () => void;
};

const DateTile: React.FC<{ iso: string; strong?: boolean; label?: string }> = ({ iso, strong, label }) => (
  <div className={`ls-date ${strong ? "is-strong" : ""}`}>
    <span>{label ?? weekdayShort(iso)}</span>
    <b>{dayNumber(iso)}</b>
  </div>
);

function useAgenda(intervalMs = 20_000) {
  const [agenda, setAgenda] = useState<Agenda | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try { setAgenda(await lessonsApi.agenda()); setError(null); } catch (e) { setError((e as Error).message); }
  }, []);
  useEffect(() => {
    void load();
    const id = setInterval(load, intervalMs);
    return () => clearInterval(id);
  }, [load, intervalMs]);
  return { agenda, error, reload: load };
}

type Item = { kind: "lesson"; lesson: Lesson; at: string } | { kind: "slot"; slot: Slot; at: string };

function upcomingItems(agenda: Agenda, teacherOnly: boolean | null, days = 7): Item[] {
  const now = Date.now();
  const horizon = now + days * 86_400_000;
  const items: Item[] = [];
  for (const l of agenda.lessons) {
    const t = new Date(l.starts_at).getTime();
    if ((l.live || t > now - 3 * 3_600_000) && t < horizon && (teacherOnly === null || l.is_teacher === teacherOnly)) {
      items.push({ kind: "lesson", lesson: l, at: l.starts_at });
    }
  }
  for (const s of agenda.open_slots) {
    const t = new Date(s.starts_at).getTime();
    if (t > now - 3 * 3_600_000 && t < horizon && (teacherOnly === null || s.is_teacher === teacherOnly)) {
      items.push({ kind: "slot", slot: s, at: s.starts_at });
    }
  }
  return items.sort((a, b) => {
    const live = (i: Item) => (i.kind === "lesson" && i.lesson.live ? 0 : 1);
    return live(a) - live(b) || new Date(a.at).getTime() - new Date(b.at).getTime();
  });
}

// ── Home ──────────────────────────────────────────────────────────────────

export const HomeScreen: React.FC<{ user: any; role: "teacher" | "student"; hasGroups: boolean; nav: Nav }> = ({ user, role, hasGroups, nav }) => {
  const { t } = useTranslation();
  const { agenda, error } = useAgenda();
  const [busy, setBusy] = useState<string | null>(null);
  const firstName = (user?.name || "").split(" ")[0];
  const teacher = role === "teacher";

  const openSlot = async (slot: Slot) => {
    setBusy(slot.starts_at + slot.group_id);
    try { nav.openLesson((await lessonForSlot(slot)).id); } finally { setBusy(null); }
  };

  const items = useMemo(() => (agenda ? upcomingItems(agenda, teacher ? true : false) : []), [agenda, teacher]);
  const hero = items[0];
  const rest = items.slice(1);
  const homework = (agenda?.lessons ?? []).filter(l => l.homework_enabled && !l.is_teacher)
    .sort((a, b) => new Date(a.homework_due_at ?? a.starts_at).getTime() - new Date(b.homework_due_at ?? b.starts_at).getTime());
  const toReview = (agenda?.lessons ?? []).filter(l => l.is_teacher && l.homework_enabled && (l.submitted_count ?? 0) > 0)
    .sort((a, b) => new Date(b.starts_at).getTime() - new Date(a.starts_at).getTime()).slice(0, 5);

  const heroTitle = (it: Item) => it.kind === "lesson"
    ? lessonTitle(it.lesson, t("lessons.untitled", { defaultValue: "Untitled lesson" }))
    : t("lessons.untitled", { defaultValue: "Untitled lesson" });
  const groupName = (it: Item) => it.kind === "lesson" ? it.lesson.group_name : it.slot.group_name;
  const isLive = (it: Item) => it.kind === "lesson" && it.lesson.live;

  const subtitle = !hero
    ? (hasGroups ? t("lessons.home.nothingSoon", { defaultValue: "No classes in the next week." }) : "")
    : isLive(hero)
      ? t("lessons.home.liveNow", { defaultValue: "{{group}} is live right now.", group: groupName(hero) })
      : new Date(hero.at).getTime() < Date.now()
        ? t("lessons.home.classStarted", { defaultValue: "Class time started {{when}}.", when: relative(hero.at) })
        : t("lessons.home.nextClass", { defaultValue: "Next class {{when}}.", when: relative(hero.at) });

  if (!hasGroups) {
    return (
      <div className="ls-screen">
        <div className="ls-head"><div><h1>{firstName ? t("lessons.home.hi", { defaultValue: "Hi {{name}}", name: firstName }) : t("lessons.home.hiAnon", { defaultValue: "Welcome" })}</h1></div></div>
        <div className="st-card ls-empty st-fade-up">
          <Users className="h-6 w-6" style={{ color: "var(--text-3)" }} />
          <h2>{teacher ? t("lessons.home.emptyTeacherTitle", { defaultValue: "Create your first group" }) : t("lessons.home.emptyStudentTitle", { defaultValue: "Join your class" })}</h2>
          <p>{teacher
            ? t("lessons.home.emptyTeacherBody", { defaultValue: "A group is your class of students. Pick its days and time; lessons appear on the schedule automatically." })
            : t("lessons.home.emptyStudentBody", { defaultValue: "Ask your teacher for the invite link or code." })}</p>
          {teacher
            ? <button type="button" className="st-btn st-btn-primary st-btn-lg" onClick={nav.newGroup}><Plus className="h-4 w-4" />{t("lessons.home.newGroup", { defaultValue: "New group" })}</button>
            : <button type="button" className="st-btn st-btn-primary st-btn-lg" onClick={nav.joinGroup}><LogIn className="h-4 w-4" />{t("lessons.home.joinGroup", { defaultValue: "Join with a code" })}</button>}
        </div>
      </div>
    );
  }

  return (
    <div className="ls-screen">
      <div className="ls-head">
        <div>
          <h1>{firstName ? t("lessons.home.hi", { defaultValue: "Hi {{name}}", name: firstName }) : t("lessons.home.hiAnon", { defaultValue: "Welcome" })}</h1>
          <p>{error ?? subtitle}</p>
        </div>
      </div>

      <div className="ls-grid-2">
        {hero ? (
          <div className="st-card ls-hero st-fade-up">
            <div className="ls-hero-body">
              <span className={`st-chip ${isLive(hero) ? "ls-live" : ""}`}>
                {isLive(hero) && <span className="ls-dot" />}
                {isLive(hero) ? t("lessons.live", { defaultValue: "Live" }) : `${isToday(hero.at) ? t("lessons.today", { defaultValue: "Today" }) : weekdayShort(hero.at)} · ${timeOf(hero.at)}`}
              </span>
              <h2>{teacher ? groupName(hero) : heroTitle(hero)}</h2>
              <p>{teacher ? heroTitle(hero) : groupName(hero)}</p>
            </div>
            <div className="ls-hero-actions">
              {teacher ? (
                <>
                  <button type="button" className="st-btn st-btn-secondary st-btn-lg" disabled={!!busy}
                    onClick={() => hero.kind === "lesson" ? nav.openLesson(hero.lesson.id) : void openSlot(hero.slot)}>
                    {t("lessons.prepare", { defaultValue: "Prepare" })}
                  </button>
                  <button type="button" className="st-btn st-btn-primary st-btn-lg" disabled={!!busy}
                    onClick={async () => {
                      const lesson = hero.kind === "lesson" ? hero.lesson : await lessonForSlot(hero.slot);
                      if (!lesson.live) await lessonsApi.update(lesson.id, { live: true });
                      nav.openLesson(lesson.id);
                    }}>
                    {isLive(hero) ? t("lessons.continue", { defaultValue: "Continue lesson" }) : t("lessons.start", { defaultValue: "Start lesson" })}
                  </button>
                </>
              ) : isLive(hero) && hero.kind === "lesson" ? (
                <button type="button" className="st-btn st-btn-primary st-btn-lg" onClick={() => nav.openLesson(hero.lesson.id)}>{t("lessons.join", { defaultValue: "Join lesson" })}</button>
              ) : (
                <span className="ls-muted">{t("lessons.home.startsIn", { defaultValue: "Starts {{when}}", when: relative(hero.at) })}</span>
              )}
            </div>
          </div>
        ) : (
          <div className="st-card ls-hero st-fade-up">
            <div className="ls-hero-body">
              <span className="st-chip"><Calendar className="h-3.5 w-3.5" />{t("lessons.home.noClasses", { defaultValue: "No classes this week" })}</span>
              <h2>{t("lessons.home.freeWeek", { defaultValue: "Nothing scheduled" })}</h2>
              <p>{teacher ? t("lessons.home.setSchedule", { defaultValue: "Set your groups' class days to see lessons here." }) : t("lessons.home.enjoy", { defaultValue: "Enjoy the break." })}</p>
            </div>
          </div>
        )}

        {teacher ? (
          <div className="st-card st-fade-up" style={{ animationDelay: "40ms" }}>
            <div className="ls-card-head"><h3>{t("lessons.home.toReview", { defaultValue: "To review" })}</h3></div>
            {toReview.length === 0 ? (
              <p className="ls-card-empty">{t("lessons.home.nothingToReview", { defaultValue: "No homework submitted yet." })}</p>
            ) : toReview.map(l => (
              <button type="button" key={l.id} className="ls-row" onClick={() => nav.openReview(l.id)}>
                <DateTile iso={l.starts_at} />
                <span className="ls-row-main">
                  <b>{lessonTitle(l, t("lessons.untitled", { defaultValue: "Untitled lesson" }))}</b>
                  <span>{l.group_name}</span>
                </span>
                <span className="st-chip">{t("lessons.submittedOf", { defaultValue: "{{n}}/{{total}} submitted", n: l.submitted_count, total: l.student_count })}</span>
              </button>
            ))}
          </div>
        ) : (
          <div className="st-card st-fade-up" style={{ animationDelay: "40ms" }}>
            <div className="ls-card-head"><h3>{t("lessons.homework", { defaultValue: "Homework" })}</h3></div>
            {homework.length === 0 ? (
              <p className="ls-card-empty">{t("lessons.home.noHomework", { defaultValue: "No homework right now." })}</p>
            ) : homework.map(l => {
              const due = l.homework_due_at;
              const overdue = due ? new Date(due).getTime() < Date.now() : false;
              const mine = l.my_homework;
              return (
                <button type="button" key={l.id} className="ls-row" onClick={() => nav.openHomework(l.id)}>
                  {due ? <DateTile iso={due} label={t("lessons.due", { defaultValue: "Due" })} /> : <DateTile iso={l.starts_at} />}
                  <span className="ls-row-main">
                    <b>{lessonTitle(l, t("lessons.untitled", { defaultValue: "Untitled lesson" }))}</b>
                    <span>{mine?.has_feedback ? t("lessons.home.newFeedback", { defaultValue: "Your teacher left feedback" }) : due ? relative(due) : l.group_name}</span>
                  </span>
                  <span className={`st-chip ${mine ? (mine.score === mine.max_score ? "ls-ok" : "ls-warn") : overdue ? "ls-bad" : "ls-warn"}`}>
                    {mine ? `${mine.score}/${mine.max_score}` : overdue ? t("lessons.overdue", { defaultValue: "Overdue" }) : t("lessons.notStarted", { defaultValue: "Not submitted" })}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {rest.length > 0 && (
        <>
          <h3 className="ls-section">{t("lessons.home.thisWeek", { defaultValue: "This week" })}</h3>
          <div className="st-card st-fade-up">
            {rest.map(it => (
              <button type="button" key={it.kind === "lesson" ? it.lesson.id : it.slot.group_id + it.at} className="ls-row"
                disabled={!teacher && !(it.kind === "lesson")}
                onClick={() => it.kind === "lesson" ? nav.openLesson(it.lesson.id) : teacher ? void openSlot(it.slot) : undefined}>
                <DateTile iso={it.at} />
                <span className="ls-row-main">
                  <b>{groupName(it)}</b>
                  <span>{timeOf(it.at)} · {heroTitle(it)}{it.kind === "slot" && teacher ? ` · ${t("lessons.notPrepared", { defaultValue: "not prepared" })}` : ""}</span>
                </span>
                {teacher && <span className="st-chip">{it.kind === "lesson" ? t("lessons.open", { defaultValue: "Open" }) : t("lessons.prepare", { defaultValue: "Prepare" })}</span>}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
};

// ── Group ─────────────────────────────────────────────────────────────────

export const GroupScreen: React.FC<{ groupId: string; nav: Nav; onEditSchedule: (g: Group) => void; refreshKey: number }> = ({ groupId, nav, onEditSchedule, refreshKey }) => {
  const { t } = useTranslation();
  const [group, setGroup] = useState<Group | null>(null);
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [members, setMembers] = useState<{ user_id: string; name: string; role: string }[]>([]);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [groups, ls, agenda] = await Promise.all([groupsApi.list(), lessonsApi.forGroup(groupId), lessonsApi.agenda()]);
        if (cancelled) return;
        setNow(Date.now());
        const g = groups.find(x => x.id === groupId) ?? null;
        setGroup(g);
        setLessons(ls);
        setSlots(agenda.open_slots.filter(s => s.group_id === groupId));
        try { setMembers(await groupsApi.members(groupId)); } catch { setMembers([]); }
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    })();
    return () => { cancelled = true; };
  }, [groupId, refreshKey]);

  const teacher = lessons[0]?.is_teacher ?? slots[0]?.is_teacher ?? false;
  const upcoming: Item[] = [
    ...lessons.filter(l => l.live || new Date(l.starts_at).getTime() > now - 3 * 3_600_000).map(l => ({ kind: "lesson" as const, lesson: l, at: l.starts_at })),
    ...slots.map(s => ({ kind: "slot" as const, slot: s, at: s.starts_at })),
  ].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime()).slice(0, 6);
  const earlier = lessons.filter(l => !l.live && new Date(l.starts_at).getTime() <= now - 3 * 3_600_000)
    .sort((a, b) => new Date(b.starts_at).getTime() - new Date(a.starts_at).getTime());
  const topics = Object.entries(lessons.reduce<Record<string, number>>((acc, l) => {
    if (l.topic) acc[l.topic] = (acc[l.topic] ?? 0) + 1;
    return acc;
  }, {}));
  const students = members.filter(m => m.role !== "teacher");
  const inviteLink = group?.invite_code ? `${window.location.origin}/join/${group.invite_code}` : "";

  if (error) return <div className="ls-screen"><p className="ls-muted">{error}</p></div>;
  if (!group) return <div className="ls-screen"><p className="ls-muted">{t("common.loading")}</p></div>;

  return (
    <div className="ls-screen">
      <div className="ls-head">
        <div>
          <h1>{group.name}</h1>
          <p>{scheduleSummary(group.schedule, t)} · {t("lessons.group.students", { defaultValue: "{{count}} students", count: group.member_count })}</p>
        </div>
        {teacher && (
          <div className="flex flex-wrap gap-2">
            {inviteLink && (
              <button type="button" className="st-btn st-btn-secondary" onClick={() => {
                navigator.clipboard?.writeText(inviteLink).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1800); }, () => setCopied(false));
              }}>
                <Copy className="h-3.5 w-3.5" />{copied ? t("lessons.group.copied", { defaultValue: "Link copied" }) : t("lessons.group.copyInvite", { defaultValue: "Copy invite link" })}
              </button>
            )}
            <button type="button" className="st-btn st-btn-ghost" onClick={() => onEditSchedule(group)}>{t("lessons.group.editSchedule", { defaultValue: "Edit schedule" })}</button>
          </div>
        )}
      </div>

      <div className="ls-grid-2">
        <div className="st-card st-fade-up">
          <div className="ls-card-head"><h3>{t("lessons.group.comingUp", { defaultValue: "Coming up" })}</h3></div>
          {upcoming.length === 0 && <p className="ls-card-empty">{teacher ? t("lessons.group.noUpcomingTeacher", { defaultValue: "Set class days to plan lessons." }) : t("lessons.group.noUpcoming", { defaultValue: "No upcoming classes." })}</p>}
          {upcoming.map((it, i) => {
            const lesson = it.kind === "lesson" ? it.lesson : null;
            const title = lesson ? lessonTitle(lesson, t("lessons.untitled", { defaultValue: "Untitled lesson" })) : t("lessons.untitled", { defaultValue: "Untitled lesson" });
            return (
              <div key={lesson?.id ?? it.at} className="ls-row is-static">
                <DateTile iso={it.at} strong={i === 0 || !!lesson?.live} />
                <span className="ls-row-main">
                  <b>{title}{lesson?.topic ? <span className="st-chip ls-tag">{lesson.topic}</span> : null}</b>
                  <span>{timeOf(it.at)}{lesson?.live ? ` · ${t("lessons.live", { defaultValue: "Live" })}` : ""}{!lesson && teacher ? ` · ${t("lessons.group.blankIfUnprepared", { defaultValue: "starts with a blank page if you don't prepare" })}` : ""}</span>
                </span>
                {teacher ? (
                  <button type="button" className={`st-btn st-btn-sm ${lesson?.live ? "st-btn-primary" : "st-btn-ghost"}`}
                    onClick={async () => nav.openLesson((lesson ?? await lessonForSlot((it as { slot: Slot }).slot)).id)}>
                    {lesson?.live ? t("lessons.open", { defaultValue: "Open" }) : t("lessons.prepare", { defaultValue: "Prepare" })}
                  </button>
                ) : lesson?.live ? (
                  <button type="button" className="st-btn st-btn-primary st-btn-sm" onClick={() => nav.openLesson(lesson.id)}>{t("lessons.join", { defaultValue: "Join lesson" })}</button>
                ) : null}
              </div>
            );
          })}
          {earlier.length > 0 && <div className="ls-card-sub">{t("lessons.group.earlier", { defaultValue: "Earlier" })}</div>}
          {earlier.map(l => (
            <button type="button" key={l.id} className="ls-row" onClick={() => teacher ? (l.homework_enabled ? nav.openReview(l.id) : nav.openLesson(l.id)) : (l.homework_enabled ? nav.openHomework(l.id) : nav.openLesson(l.id))}>
              <DateTile iso={l.starts_at} />
              <span className="ls-row-main">
                <b>{lessonTitle(l, t("lessons.untitled", { defaultValue: "Untitled lesson" }))}</b>
                <span>{l.homework_enabled
                  ? (teacher ? t("lessons.submittedOf", { defaultValue: "{{n}}/{{total}} submitted", n: l.submitted_count, total: l.student_count }) : l.my_homework ? `${t("lessons.homework", { defaultValue: "Homework" })}: ${l.my_homework.score}/${l.my_homework.max_score}` : t("lessons.notStarted", { defaultValue: "Not submitted" }))
                  : dayMonth(l.starts_at)}</span>
              </span>
            </button>
          ))}
        </div>

        <div className="grid gap-4 content-start">
          {teacher && (
            <div className="st-card st-fade-up" style={{ animationDelay: "40ms" }}>
              <div className="ls-card-head"><h3>{t("lessons.group.studentsTitle", { defaultValue: "Students" })}</h3></div>
              {students.length === 0
                ? <p className="ls-card-empty">{t("lessons.group.noStudents", { defaultValue: "No students yet. Share the invite link." })}</p>
                : students.map(s => <div key={s.user_id} className="ls-person"><span className="ls-avatar">{(s.name || "?")[0].toUpperCase()}</span>{s.name}</div>)}
            </div>
          )}
          <div className="st-card st-fade-up" style={{ animationDelay: "80ms" }}>
            <div className="ls-card-head"><h3>{t("lessons.group.topics", { defaultValue: "Topics so far" })}</h3></div>
            {topics.length === 0
              ? <p className="ls-card-empty">{t("lessons.group.noTopics", { defaultValue: "Tag lessons with a topic (like “Lists”) to see progress here." })}</p>
              : <div className="flex flex-wrap gap-2 px-4 pb-4">{topics.map(([name, n]) => <span key={name} className="st-chip ls-tag">{name} · {n}</span>)}</div>}
          </div>
        </div>
      </div>
    </div>
  );
};

// ── New group / edit schedule sheet ──────────────────────────────────────

export const GroupSheet: React.FC<{ group?: Group | null; onClose: () => void; onSaved: (g: Group) => void }> = ({ group, onClose, onSaved }) => {
  const { t } = useTranslation();
  const editing = !!group;
  const [name, setName] = useState(group?.name ?? "");
  const [days, setDays] = useState<number[]>(group?.schedule?.days ?? []);
  const [time, setTime] = useState(group?.schedule?.time ?? "17:00");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<Group | null>(null);
  const [copied, setCopied] = useState(false);
  const names = weekdayNames();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const save = async () => {
    if (!name.trim()) return;
    setSaving(true);
    setError(null);
    const schedule = days.length ? { days: [...days].sort(), time, tz: group?.schedule?.tz ?? browserTimeZone() } : null;
    try {
      const saved = editing ? await groupsApi.update(group!.id, { name: name.trim(), schedule }) : await groupsApi.create(name.trim(), schedule);
      if (editing) { onSaved(saved); onClose(); } else { setCreated(saved); onSaved(saved); }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const link = created?.invite_code ? `${window.location.origin}/join/${created.invite_code}` : "";

  return (
    <div className="st-backdrop fixed inset-0 z-50 flex items-center justify-center p-4" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="st-pop-in ls-sheet" role="dialog" aria-label={editing ? t("lessons.group.editSchedule", { defaultValue: "Edit schedule" }) : t("lessons.home.newGroup", { defaultValue: "New group" })}>
        {created ? (
          <>
            <div>
              <h2>{t("lessons.sheet.ready", { defaultValue: "{{name}} is ready", name: created.name })}</h2>
              <p>{t("lessons.sheet.shareHint", { defaultValue: "Send this link to your students. They open it, sign in with Google, and they're in the group." })}</p>
            </div>
            <div className="ls-link">
              <span>{link}</span>
              <button type="button" className="st-btn st-btn-primary st-btn-sm" onClick={() => navigator.clipboard?.writeText(link).then(() => setCopied(true), () => setCopied(false))}>
                {copied ? t("lessons.group.copied", { defaultValue: "Link copied" }) : t("lessons.sheet.copyLink", { defaultValue: "Copy link" })}
              </button>
            </div>
            <p className="ls-muted" style={{ fontSize: 12.5 }}>{t("lessons.sheet.orCode", { defaultValue: "Or they can enter the code {{code}} on the Join screen.", code: created.invite_code })}</p>
            <div className="flex justify-end"><button type="button" className="st-btn st-btn-secondary" onClick={onClose}>{t("common.close")}</button></div>
          </>
        ) : (
          <>
            <div>
              <h2>{editing ? t("lessons.group.editSchedule", { defaultValue: "Edit schedule" }) : t("lessons.home.newGroup", { defaultValue: "New group" })}</h2>
              <p>{t("lessons.sheet.hint", { defaultValue: "That's all the setup. Lessons appear on these days automatically." })}</p>
            </div>
            <label className="ls-field">
              <span>{t("lessons.sheet.name", { defaultValue: "Name" })}</span>
              <input className="st-input" value={name} autoFocus onChange={e => setName(e.target.value)} maxLength={200} placeholder={t("lessons.sheet.namePlaceholder", { defaultValue: "e.g. Tuesday group" })} />
            </label>
            <div className="ls-field">
              <span>{t("lessons.sheet.days", { defaultValue: "Class days" })}</span>
              <div className="ls-days">
                {DAY_KEYS.map((key, i) => (
                  <button key={key} type="button" aria-pressed={days.includes(i)} onClick={() => setDays(d => d.includes(i) ? d.filter(x => x !== i) : [...d, i])}>{names[i]}</button>
                ))}
              </div>
            </div>
            <label className="ls-field">
              <span>{t("lessons.sheet.time", { defaultValue: "Time" })}</span>
              <input className="st-input" type="time" value={time} onChange={e => setTime(e.target.value)} style={{ maxWidth: 140 }} />
            </label>
            {error && <p style={{ color: "var(--rose)", fontSize: 13 }}>{error}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" className="st-btn st-btn-ghost" onClick={onClose}>{t("common.cancel")}</button>
              <button type="button" className="st-btn st-btn-primary" disabled={!name.trim() || saving} onClick={save}>
                {editing ? t("common.save") : t("lessons.sheet.create", { defaultValue: "Create group" })}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
