/**
 * Public demo: a real lesson in one click, no account.
 *
 *   /demo                    -> DemoLauncher, creates a room and redirects
 *   /demo/:roomId            -> DemoRoomView as the teacher
 *   /demo/:roomId?as=student -> the same room as a student sees it
 *                               (what "Open as a student" opens in a new tab)
 *
 * It uses the same notebook page and whiteboard as real lessons, so what a
 * visitor tries here is what teachers get:
 *   Class page   text + Python blocks, ▶ runs in the browser, live editing
 *   Homework     the teacher's view: problem, solution, starter code, tests
 *   Whiteboard   the shared drawing board
 *
 * The pages are seeded and relayed by the server in memory only (see
 * app/services/demo_seed.py); the guest cookie admits this browser to this
 * one room. Python runs entirely in the browser (public/py-worker.js).
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ExternalLink, FileText, GraduationCap, PenLine } from "lucide-react";

import { DrawingCanvas } from "./components/DrawingCanvas";
import { LanguageSwitcher } from "./components/LanguageSwitcher";
import { StrawieLogoSvg } from "./components/Logo";
import { NotebookPage } from "./lessons/NotebookPage";
import { DemoError, createDemoRoom, getDemoRoom, type DemoRoom } from "./lib/demoApi";
import { warmupPyodide } from "./lib/pyodideRunner";

const GUEST_ANIMALS = ["fox", "otter", "heron", "ibex", "lynx", "marten"] as const;

/** Full-page centred card, used for every loading and error state. */
const DemoCard: React.FC<{ title: string; body: string; children?: React.ReactNode }> = ({ title, body, children }) => (
  <div className="min-h-screen grid place-items-center p-6" style={{ background: "var(--bg)", color: "var(--text)", fontFamily: "var(--font)" }}>
    <div className="st-card w-full max-w-[440px] p-8 text-center">
      <div className="flex justify-center mb-5"><StrawieLogoSvg size={30} /></div>
      <h1 className="text-[19px] font-bold mb-2">{title}</h1>
      <p className="text-[14px] leading-relaxed mb-5" style={{ color: "var(--text-3)" }}>{body}</p>
      {children}
    </div>
  </div>
);

function useErrorText() {
  const { t } = useTranslation();
  return (e: unknown) => {
    const kind = e instanceof DemoError ? e.kind : "unknown";
    return t(`demo.errors.${kind}`, { defaultValue: t("demo.errors.unknown", { defaultValue: "Something went wrong starting the demo. Please try again." }) });
  };
}

// ---------------------------------------------------------------------------
// /demo  -- create a room, then redirect to it
// ---------------------------------------------------------------------------

export const DemoLauncher: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const errorText = useErrorText();
  const [error, setError] = useState<{ message: string; canRetry: boolean } | null>(null);
  // StrictMode runs effects twice in development; creating a room is a
  // write that counts against the per-IP limit, so only do it once.
  const started = useRef(false);

  const start = useCallback(async () => {
    setError(null);
    try {
      // Download Python while the room is being created.
      warmupPyodide();
      const room = await createDemoRoom();
      // `replace`, so Back leaves the demo instead of creating another room.
      navigate(`/demo/${room.room_id}`, { replace: true });
    } catch (e) {
      const kind = e instanceof DemoError ? e.kind : "unknown";
      setError({ message: errorText(e), canRetry: kind === "network" || kind === "unknown" });
    }
  }, [navigate, errorText]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void start();
  }, [start]);

  if (error) {
    return (
      <DemoCard title={t("demo.couldNotStart", { defaultValue: "Could not start the demo" })} body={error.message}>
        <div className="flex gap-2 justify-center">
          {error.canRetry && <button type="button" className="st-btn st-btn-primary" onClick={() => void start()}>{t("demo.tryAgain", { defaultValue: "Try again" })}</button>}
          <a href="/" className="st-btn st-btn-secondary">{t("demo.backHome", { defaultValue: "Back to home" })}</a>
        </div>
      </DemoCard>
    );
  }
  return <DemoCard title={t("demo.settingUp", { defaultValue: "Setting up your lesson…" })} body={t("demo.settingUpBody", { defaultValue: "Creating a private demo room and loading Python. This takes a few seconds." })} />;
};

// ---------------------------------------------------------------------------
// /demo/:roomId  -- the lesson
// ---------------------------------------------------------------------------

type Surface = "page" | "homework" | "board";

export const DemoRoomView: React.FC = () => {
  const { t, i18n } = useTranslation();
  const { roomId } = useParams<{ roomId: string }>();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const errorText = useErrorText();
  const asStudent = params.get("as") === "student";
  const [room, setRoom] = useState<DemoRoom | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [surface, setSurface] = useState<Surface>("page");

  const lang = (["en", "ru", "kk"] as const).find(l => i18n.language?.startsWith(l)) ?? "en";
  // One name per tab, so two student tabs show two different people.
  const [animal] = useState(() => GUEST_ANIMALS[Math.floor(Math.random() * GUEST_ANIMALS.length)]);
  const guestName = asStudent
    ? t("demo.studentName", { defaultValue: "Student {{animal}}", animal: t(`demo.animals.${animal}`, { defaultValue: animal }) })
    : t("demo.teacherName", { defaultValue: "Teacher" });

  useEffect(() => {
    warmupPyodide();
    if (!roomId) return;
    let cancelled = false;
    getDemoRoom(roomId).then(
      r => { if (!cancelled) setRoom(r); },
      e => { if (!cancelled) setLoadError(e); },
    );
    return () => { cancelled = true; };
  }, [roomId]);

  if (loadError) {
    const expired = loadError instanceof DemoError && loadError.kind === "expired";
    return (
      <DemoCard
        title={expired ? t("demo.expiredTitle", { defaultValue: "This demo room has expired" }) : t("demo.couldNotLoad", { defaultValue: "Could not load the demo" })}
        body={errorText(loadError)}
      >
        <div className="flex gap-2 justify-center">
          <button type="button" className="st-btn st-btn-primary" onClick={() => navigate("/demo", { replace: true })}>{t("demo.startFresh", { defaultValue: "Start a fresh demo" })}</button>
          <a href="/" className="st-btn st-btn-secondary">{t("demo.backHome", { defaultValue: "Back to home" })}</a>
        </div>
      </DemoCard>
    );
  }
  if (!room) return <DemoCard title={t("demo.opening", { defaultValue: "Opening your lesson…" })} body={t("demo.openingBody", { defaultValue: "Connecting to the live classroom." })} />;

  const base = room.collab_room_id;
  const role = asStudent ? "student" : "teacher";
  const tabs: { id: Surface; label: string; icon: React.ReactNode }[] = [
    { id: "page", label: t("lessons.lesson.classPage", { defaultValue: "Class page" }), icon: <FileText className="h-3.5 w-3.5" /> },
    ...(asStudent ? [] : [{ id: "homework" as const, label: t("lessons.homework", { defaultValue: "Homework" }), icon: <GraduationCap className="h-3.5 w-3.5" /> }]),
    { id: "board", label: t("lessons.lesson.whiteboard", { defaultValue: "Whiteboard" }), icon: <PenLine className="h-3.5 w-3.5" /> },
  ];

  const steps = asStudent
    ? [
        t("demo.student1", { defaultValue: "This is a student's screen. The teacher's text is read-only; code blocks are yours to edit and run." }),
        t("demo.student2", { defaultValue: "Type in a code block here and watch it appear in the teacher's tab, and the other way round." }),
      ]
    : [
        t("demo.step1", { defaultValue: "Press ▶ on a code block. Real Python runs in your browser, nothing to install." }),
        t("demo.step2", { defaultValue: "Open Homework: that's how you write a problem with tests. Press \"Check with my solution\"." }),
        t("demo.step3", { defaultValue: "Click \"Open as a student\" and type in either tab: you're both on the same live page." }),
      ];

  let body: React.ReactNode;
  if (surface === "board") {
    body = <div className="ls-board"><DrawingCanvas roomId={`${base}:draw`} userName={guestName} userRole={role} className="h-full" /></div>;
  } else if (surface === "homework" && !asStudent) {
    body = (
      <div className="ls-canvas">
        <NotebookPage key={`${base}:hw-${lang}`} roomId={`${base}:hw-${lang}`} kind="master" userName={guestName} userRole="teacher" canEditText canEditStructure />
      </div>
    );
  } else {
    body = (
      <div className="ls-canvas">
        <NotebookPage key={`${base}:page-${lang}:${role}`} roomId={`${base}:page-${lang}`} kind="board" userName={guestName} userRole={role}
          canEditText={!asStudent} canEditStructure={!asStudent} />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen" style={{ background: "var(--bg-2)", color: "var(--text)", fontFamily: "var(--font)" }}>
      <header className="ls-topbar">
        <a href="/" aria-label="Strawie" className="flex items-center"><StrawieLogoSvg size={26} /></a>
        <span className="st-chip" style={{ background: "var(--amber-10)", color: "var(--amber-dim)" }}>
          {asStudent ? t("demo.pillStudent", { defaultValue: "Demo · student view" }) : t("demo.pill", { defaultValue: "Demo · you're the teacher" })}
        </span>
        <span className="ls-spacer" />
        <div className="st-seg" role="group" aria-label={t("lessons.lesson.surface", { defaultValue: "Surface" })}>
          {tabs.map(tab => (
            <button key={tab.id} type="button" aria-pressed={surface === tab.id} onClick={() => setSurface(tab.id)}>{tab.icon}{tab.label}</button>
          ))}
        </div>
        {!asStudent && (
          <button type="button" className="st-btn st-btn-secondary st-btn-sm"
            onClick={() => window.open(`/demo/${room.room_id}?as=student`, "_blank", "noopener,noreferrer")}>
            <ExternalLink className="h-3.5 w-3.5" />{t("demo.openAsStudent", { defaultValue: "Open as a student" })}
          </button>
        )}
        <LanguageSwitcher variant="dark" />
        <a href="/app" className="st-btn st-btn-primary st-btn-sm">{t("demo.createClass", { defaultValue: "Create your class" })}</a>
      </header>
      <div className="ls-banner" style={{ flexDirection: "column", alignItems: "flex-start", gap: 2 }}>
        {steps.map((step, i) => (
          <div key={i}><b style={{ color: "var(--indigo)", marginRight: 6 }}>{i + 1}.</b>{step}</div>
        ))}
      </div>
      <div className="flex-1 min-h-0 flex flex-col">{body}</div>
    </div>
  );
};
