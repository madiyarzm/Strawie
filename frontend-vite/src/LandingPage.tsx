import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation, Trans } from "react-i18next";
import { motion } from "framer-motion";
import {
  ArrowRight,
  Code2,
  Sparkles,
  CheckCircle2,
  KeyRound,
  Activity,
  Terminal,
  PenLine,
  Trophy,
  Flame,
  Zap,
  Star,
  Lightbulb,
  Target,
} from "lucide-react";
import { getMe, googleLogin, isInAppBrowser } from "./lib/api";
import { StrawieLogoSvg } from "./components/Logo";
import { LanguageSwitcher } from "./components/LanguageSwitcher";
import { TermsModal, PrivacyModal } from "./components/LegalModals";

import strawieTeaching from "./assets/mascots/characters/strawie-teaching.png";
import berryFocused from "./assets/mascots/characters/berry-focused.png";
import berryAsking from "./assets/mascots/characters/berry-asking.png";
import berryBuildSuccess from "./assets/mascots/characters/berry-build-success.png";
import strawieHanging from "./assets/mascots/hanging/strawie-hanging.png";
import berryHanging from "./assets/mascots/hanging/berry-hanging.png";
import raspieHanging from "./assets/mascots/hanging/raspie-hanging.png";
import raspieSliding from "./assets/mascots/steps/raspie-sliding.png";
import raspieReady from "./assets/mascots/cta/raspie-ready.png";

// ── Motion variants ─────────────────────────────────────────────────────
const SPRING = { type: "spring" as const, stiffness: 220, damping: 24, mass: 0.9 };

const fadeUp = {
  hidden: { opacity: 0, y: 20 },
  show: (i = 0) => ({
    opacity: 1,
    y: 0,
    transition: { ...SPRING, delay: i * 0.08 },
  }),
};

// ── Editor: shared types ────────────────────────────────────────────────
type Tok = { t: string; c: string };
type Line = Tok[];

// Light editor palette — readable on a light card.
const PY = {
  ink: "#1F2937",
  comment: "#94A3B8",
  keyword: "#7C3AED",
  fn: "#0F766E",
  string: "#0E7490",
  number: "#B45309",
  punct: "#475569",
} as const;

// ── Lesson 1: Variables — the demo lesson ───────────────────────────────
const LESSON_LINES: Line[] = [
  [{ t: "# lesson 1 — variables", c: PY.comment }],
  [
    { t: "name", c: PY.ink },
    { t: " = ", c: PY.punct },
    { t: '"Berry"', c: PY.string },
  ],
  [
    { t: "xp", c: PY.ink },
    { t: " = ", c: PY.punct },
    { t: "0", c: PY.number },
  ],
  [],
  [
    { t: "print", c: PY.fn },
    { t: "(", c: PY.punct },
    { t: 'f"Welcome to class, ', c: PY.string },
    { t: "{name}", c: PY.keyword },
    { t: '!"', c: PY.string },
    { t: ")", c: PY.punct },
  ],
];

const TYPING_LINE_INDEX = 4;
const TYPING_FULL = `print(f"Welcome to class, {name}!")`;

// ── Glass nav ───────────────────────────────────────────────────────────
const Nav: React.FC<{ onSignIn: () => void }> = ({ onSignIn }) => {
  const { t } = useTranslation();
  // Condense the floating nav once the user scrolls past the hero — a subtle
  // shrink + firmer shadow, the way refined product sites do it.
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 16);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header className={`fixed inset-x-0 z-50 flex justify-center px-4 transition-all duration-300 ease-out ${scrolled ? "top-2" : "top-4"}`}>
      <nav
        className={`flex items-center gap-2 rounded-full
                   bg-white/70 backdrop-blur-xl border border-white/60
                   transition-all duration-300 ease-out
                   ${scrolled ? "px-2.5 py-1.5 shadow-lift-md bg-white/80" : "px-3 py-2 shadow-lift-glass"}`}
      >
        <div className="pl-2 pr-3">
          <StrawieLogoSvg size={scrolled ? 23 : 26} />
        </div>
        <div className="hidden lg:flex items-center gap-1 text-[13px] text-apple-ink-3 font-medium">
          <a className="px-3 py-1.5 rounded-full hover:bg-apple-mist hover:text-apple-ink transition-colors duration-200" href="#editor">{t("landing.nav.editor")}</a>
          <a className="px-3 py-1.5 rounded-full hover:bg-apple-mist hover:text-apple-ink transition-colors duration-200" href="#features">{t("landing.nav.features")}</a>
          <a className="px-3 py-1.5 rounded-full hover:bg-apple-mist hover:text-apple-ink transition-colors duration-200" href="#teachers">{t("landing.nav.teachers")}</a>
          <a className="px-3 py-1.5 rounded-full hover:bg-apple-mist hover:text-apple-ink transition-colors duration-200" href="#students">{t("landing.nav.students")}</a>
        </div>
        <LanguageSwitcher variant="light" className="shrink-0" />
        <button
          onClick={onSignIn}
          className="px-3 py-1.5 text-[13px] font-medium text-apple-ink-2 hover:text-apple-ink rounded-full transition-colors duration-200
                     focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-apple-ink/15"
        >
          {t("landing.nav.signIn")}
        </button>
        <button
          onClick={onSignIn}
          className="group flex items-center gap-1.5 px-4 py-1.5 rounded-full
                     bg-apple-ink text-white text-[13px] font-semibold
                     shadow-lift-sm hover:shadow-lift-md
                     hover:bg-apple-ink-2 hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98]
                     focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-apple-ink/25 focus-visible:ring-offset-2 focus-visible:ring-offset-white
                     transition-all duration-200 ease-out"
        >
          {t("landing.nav.open")}
          <ArrowRight size={14} strokeWidth={2.5} className="transition-transform duration-200 group-hover:translate-x-0.5" />
        </button>
      </nav>
    </header>
  );
};

// ── Code Editor card ────────────────────────────────────────────────────
const EditorCard: React.FC<{ className?: string }> = ({ className = "" }) => {
  const [typed, setTyped] = useState(0);
  const [pausing, setPausing] = useState(false);

  useEffect(() => {
    if (pausing) {
      const t = setTimeout(() => { setTyped(0); setPausing(false); }, 2500);
      return () => clearTimeout(t);
    }
    if (typed < TYPING_FULL.length) {
      const t = setTimeout(() => setTyped((n) => n + 1), 80);
      return () => clearTimeout(t);
    }
    setPausing(true);
  }, [typed, pausing]);

  const lines = LESSON_LINES.map((line, i) =>
    i === TYPING_LINE_INDEX
      ? ([{ t: TYPING_FULL.slice(0, typed), c: PY.ink }] as Line)
      : line
  );

  return (
    <div className={`relative ${className}`}>
      <div
        className="rounded-[22px] bg-white
                   border border-apple-line
                   shadow-lift-xl
                   overflow-hidden"
      >
        {/* window chrome */}
        <div className="flex items-center gap-3 px-4 h-10 border-b border-apple-line bg-apple-mist/50">
          <div className="flex gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-[#FF6058]" />
            <span className="w-2.5 h-2.5 rounded-full bg-[#FFBD2E]" />
            <span className="w-2.5 h-2.5 rounded-full bg-[#28C840]" />
          </div>
          <div className="flex-1 flex justify-center">
            <div className="text-[11px] font-medium text-apple-ink-3 font-mono">
              lesson_1_variables.py
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <PresenceDot color="#5B7FFF" name="Strawie" />
            <PresenceDot color="#9B7BFF" name="A" />
          </div>
        </div>

        {/* tabs */}
        <div className="flex items-center px-4 h-9 border-b border-apple-line bg-white/60">
          <div className="flex items-center gap-2 px-3 py-1 rounded-md bg-apple-mist text-[12px] font-medium text-apple-ink-2 font-mono">
            <span className="w-1.5 h-1.5 rounded-full bg-berry-blue" />
            lesson_1_variables.py
          </div>
        </div>

        {/* editor body */}
        <div className="flex font-mono text-[13px] leading-[22px]">
          {/* gutter */}
          <div className="py-4 px-3 text-right text-apple-ink-4/70 select-none border-r border-apple-line bg-apple-mist/30">
            {lines.map((_, i) => (
              <div key={i}>{i + 1}</div>
            ))}
          </div>
          {/* code */}
          <div className="flex-1 py-4 px-5 relative">
            {lines.map((line, li) => (
              <div key={li} className="relative min-h-[22px]">
                {line.length === 0 ? (
                  <span>&nbsp;</span>
                ) : (
                  line.map((tok, ti) => (
                    <span key={ti} style={{ color: tok.c }}>
                      {tok.t}
                    </span>
                  ))
                )}
                {/* teacher cursor on line 2 (name = "Berry") */}
                {li === 1 && (
                  <CollabCursor color="#5B7FFF" label="Strawie" offsetCh={0} />
                )}
                {/* student typing cursor on line 5 */}
                {li === TYPING_LINE_INDEX && (
                  <CollabCursor
                    color="#9B7BFF"
                    label="Berry"
                    offsetCh={0}
                  />
                )}
              </div>
            ))}
          </div>
        </div>

        {/* output bar */}
        <div className="flex items-center gap-3 px-5 h-11 border-t border-apple-line bg-apple-mist/40">
          <CheckCircle2 size={14} className="text-emerald-500" />
          <span className="text-[12px] font-medium text-apple-ink-2 font-mono">
            Welcome to class, Berry!
          </span>
          <span className="ml-auto text-[11px] font-semibold text-berry-blue
                           bg-berry-blue-soft px-2 py-0.5 rounded-full">
            +10 XP
          </span>
        </div>
      </div>

    </div>
  );
};

const PresenceDot: React.FC<{ color: string; name: string }> = ({ color, name }) => (
  <div
    className="flex items-center justify-center w-5 h-5 rounded-full text-[9px] font-bold text-white"
    style={{ background: color }}
    title={name}
  >
    {name[0]}
  </div>
);

const CollabCursor: React.FC<{ color: string; label: string; offsetCh: number }> = ({
  color,
  label,
  offsetCh,
}) => (
  <>
    <span
      className="absolute top-0 w-[2px] h-[18px] animate-cursorPulse"
      style={{ left: `calc(${offsetCh}ch)`, background: color, top: 3 }}
    />
    <span
      className="absolute -top-[18px] px-1.5 py-px rounded-[3px] text-[9px] font-semibold text-white whitespace-nowrap"
      style={{ left: `calc(${offsetCh}ch)`, background: color, fontFamily: "Plus Jakarta Sans, sans-serif" }}
    >
      {label}
    </span>
  </>
);

// ── Lesson 5: Recursion — multi-user collab showcase ─────────────────────
const L5: Line[] = [
  [{ t: "# lesson 5 — recursion", c: PY.comment }],
  [
    { t: "def ", c: PY.keyword },
    { t: "factorial", c: PY.fn },
    { t: "(", c: PY.punct },
    { t: "n", c: PY.ink },
    { t: "):", c: PY.punct },
  ],
  [
    { t: "    ", c: PY.ink },
    { t: "if", c: PY.keyword },
    { t: " n == ", c: PY.ink },
    { t: "0", c: PY.number },
    { t: ":", c: PY.punct },
  ],
  [
    { t: "        ", c: PY.ink },
    { t: "return ", c: PY.keyword },
    { t: "1", c: PY.number },
  ],
  [
    { t: "    ", c: PY.ink },
    { t: "return ", c: PY.keyword },
    { t: "n", c: PY.ink },
    { t: " * ", c: PY.punct },
    { t: "factorial", c: PY.fn },
    { t: "(", c: PY.punct },
    { t: "n", c: PY.ink },
    { t: " - ", c: PY.punct },
    { t: "1", c: PY.number },
    { t: ")", c: PY.punct },
  ],
  [],
  [
    { t: "print", c: PY.fn },
    { t: "(", c: PY.punct },
    { t: "factorial", c: PY.fn },
    { t: "(", c: PY.punct },
    { t: "5", c: PY.number },
    { t: "))", c: PY.punct },
  ],
];

// Lesson 6: Sorting — second tab content
const L6: Line[] = [
  [{ t: "# lesson 6 — sorting", c: PY.comment }],
  [
    { t: "nums", c: PY.ink },
    { t: " = [", c: PY.punct },
    { t: "3", c: PY.number },
    { t: ", ", c: PY.punct },
    { t: "1", c: PY.number },
    { t: ", ", c: PY.punct },
    { t: "4", c: PY.number },
    { t: ", ", c: PY.punct },
    { t: "1", c: PY.number },
    { t: ", ", c: PY.punct },
    { t: "5", c: PY.number },
    { t: ", ", c: PY.punct },
    { t: "9", c: PY.number },
    { t: "]", c: PY.punct },
  ],
  [
    { t: "nums", c: PY.ink },
    { t: ".", c: PY.punct },
    { t: "sort", c: PY.fn },
    { t: "()", c: PY.punct },
  ],
  [],
  [
    { t: "print", c: PY.fn },
    { t: "(", c: PY.punct },
    { t: "nums", c: PY.ink },
    { t: ")", c: PY.punct },
  ],
];

const COLLAB_USERS = [
  { color: "#5B7FFF", initial: "S", name: "Strawie" },
  { color: "#9B7BFF", initial: "B", name: "Berry" },
  { color: "#F97316", initial: "R", name: "Raspie" },
];

const CollabEditorView: React.FC = () => {
  const { t } = useTranslation();
  const [tab, setTab] = useState<"l5" | "l6">("l5");
  const lines = tab === "l5" ? L5 : L6;
  const fileName = tab === "l5" ? "lesson_5_recursion.py" : "lesson_6_sorting.py";
  const output = tab === "l5" ? ["120"] : ["[1, 1, 3, 4, 5, 9]"];

  return (
    <div className="rounded-[22px] bg-white border border-apple-line shadow-lift-xl overflow-hidden">
      {/* titlebar */}
      <div className="flex items-center gap-3 px-4 h-10 border-b border-apple-line bg-apple-mist/50">
        <div className="flex gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-[#FF6058]" />
          <span className="w-2.5 h-2.5 rounded-full bg-[#FFBD2E]" />
          <span className="w-2.5 h-2.5 rounded-full bg-[#28C840]" />
        </div>
        <div className="flex-1 flex justify-center">
          <div className="flex items-center gap-2 text-[11px] font-medium text-apple-ink-3 font-mono">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            {fileName}
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {COLLAB_USERS.map((u) => (
            <div
              key={u.name}
              className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold text-white"
              style={{ background: u.color }}
              title={u.name}
            >
              {u.initial}
            </div>
          ))}
          <span className="text-[11px] text-apple-ink-4 ml-0.5">{t("landing.showcase.live", { count: 3 })}</span>
        </div>
      </div>
      {/* tabs */}
      <div className="flex items-center px-4 h-9 border-b border-apple-line bg-white/60 gap-1">
        <button
          onClick={() => setTab("l5")}
          className={`flex items-center gap-2 px-3 py-1 rounded-md text-[12px] font-medium font-mono transition
            ${tab === "l5" ? "bg-apple-mist text-apple-ink-2" : "text-apple-ink-4 hover:bg-apple-mist/50"}`}
        >
          {tab === "l5" && <span className="w-1.5 h-1.5 rounded-full bg-berry-blue" />}
          lesson_5_recursion.py
        </button>
        <button
          onClick={() => setTab("l6")}
          className={`flex items-center gap-2 px-3 py-1 rounded-md text-[12px] font-medium font-mono transition
            ${tab === "l6" ? "bg-apple-mist text-apple-ink-2" : "text-apple-ink-4 hover:bg-apple-mist/50"}`}
        >
          {tab === "l6" && <span className="w-1.5 h-1.5 rounded-full bg-berry-blue" />}
          lesson_6_sorting.py
        </button>
      </div>
      {/* editor body */}
      <div className="flex font-mono text-[13px] leading-[22px]">
        <div className="py-4 px-3 text-right text-apple-ink-4/70 select-none border-r border-apple-line bg-apple-mist/30">
          {lines.map((_, i) => <div key={i}>{i + 1}</div>)}
        </div>
        <div className="flex-1 py-4 px-5 relative">
          {lines.map((line, li) => (
            <div
              key={`${tab}-${li}`}
              className="relative min-h-[22px] rounded"
              style={tab === "l5" && li === 4 ? { background: "rgba(155,123,255,0.08)" } : undefined}
            >
              {line.length === 0 ? (
                <span>&nbsp;</span>
              ) : (
                line.map((tok, ti) => (
                  <span key={ti} style={{ color: tok.c }}>{tok.t}</span>
                ))
              )}
              {tab === "l5" && li === 1 && <CollabCursor color="#5B7FFF" label="Strawie" offsetCh={4} />}
              {tab === "l5" && li === 4 && <CollabCursor color="#9B7BFF" label="Berry" offsetCh={11} />}
              {tab === "l5" && li === 6 && <CollabCursor color="#F97316" label="Raspie" offsetCh={5} />}
            </div>
          ))}
        </div>
      </div>
      {/* output */}
      <div className="border-t border-apple-line bg-apple-mist/40 px-5 py-3">
        <div className="flex items-center gap-2 mb-1.5">
          <Terminal size={11} className="text-apple-ink-4" />
          <span className="text-[11px] font-medium text-apple-ink-4 font-mono">{t("landing.showcase.output")}</span>
        </div>
        <div className="font-mono text-[12px] text-apple-ink-2 leading-[20px]">
          {output.map((o, i) => <div key={i}>{o}</div>)}
        </div>
      </div>
    </div>
  );
};

// ── Dark mini editor (Bento tile) ─────────────────────────────────────────
const DK = {
  comment: "#475569",
  keyword: "#818cf8",
  fn: "#38bdf8",
  string: "#34d399",
  punct: "#94a3b8",
  ink: "#e2e8f0",
  err: "#f87171",
} as const;

const L2_DARK: Line[] = [
  [{ t: "# lesson 2 — functions", c: DK.comment }],
  [
    { t: "def ", c: DK.keyword },
    { t: "greet", c: DK.fn },
    { t: "(", c: DK.punct },
    { t: "name", c: DK.ink },
    { t: "):", c: DK.punct },
  ],
  [
    { t: "    return ", c: DK.ink },
    { t: 'f"Hello, ', c: DK.string },
    { t: "{name}", c: DK.keyword },
    { t: '!"', c: DK.string },
  ],
  [],
  [
    { t: "def ", c: DK.keyword },
    { t: "check", c: DK.fn },
    { t: "(", c: DK.punct },
    { t: "result", c: DK.ink },
    { t: "):", c: DK.punct },
  ],
  [
    { t: "    return ", c: DK.ink },
    { t: '"✓ pass"', c: DK.string },
    { t: " if ", c: DK.keyword },
    { t: "result", c: DK.ink },
    { t: ".ok ", c: DK.ink },
    { t: "else ", c: DK.keyword },
    { t: '"✗ fail"', c: DK.err },
  ],
];

const BentoEditorMini: React.FC = () => (
  <div className="rounded-[18px] bg-[#0d1117] border border-slate-800 overflow-hidden">
    <div className="flex items-center gap-2 px-3 h-8 border-b border-slate-800">
      <div className="flex gap-1">
        <span className="w-2 h-2 rounded-full bg-[#FF6058]" />
        <span className="w-2 h-2 rounded-full bg-[#FFBD2E]" />
        <span className="w-2 h-2 rounded-full bg-[#28C840]" />
      </div>
      <div className="flex-1 text-center text-[10px] text-slate-500 font-mono">
        lesson_2_functions.py
      </div>
      <div className="flex items-center gap-1">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
        <span className="text-[9px] text-slate-500">2 live</span>
      </div>
    </div>
    <div className="flex font-mono text-[11px] leading-[20px]">
      <div className="py-3 px-2 text-right text-slate-700 select-none border-r border-slate-800 min-w-[28px]">
        {L2_DARK.map((_, i) => <div key={i}>{i + 1}</div>)}
      </div>
      <div className="flex-1 py-3 px-3">
        {L2_DARK.map((line, li) => (
          <div key={li} className="min-h-[20px]">
            {line.length === 0 ? (
              <span>&nbsp;</span>
            ) : (
              line.map((tok, ti) => (
                <span key={ti} style={{ color: tok.c }}>{tok.t}</span>
              ))
            )}
          </div>
        ))}
      </div>
    </div>
  </div>
);

// ── Hero ────────────────────────────────────────────────────────────────
const Hero: React.FC<{ onCta: () => void }> = ({ onCta }) => {
  const { t } = useTranslation();
  return (
    <section className="relative pt-36 pb-28 px-6 overflow-hidden">
      {/* subtle background wash */}
      <div className="absolute inset-0 -z-10">
        <div className="absolute top-32 left-1/2 -translate-x-1/2 w-[1200px] h-[640px] bg-berry-blue-soft/35 blur-[120px] rounded-full" />
        <div className="absolute top-64 right-[-10%] w-[520px] h-[520px] bg-berry-purple-soft/30 blur-[120px] rounded-full" />
      </div>

      <div className="max-w-[1180px] mx-auto">
        <motion.div
          initial="hidden"
          animate="show"
          className="text-center max-w-[820px] mx-auto"
        >
          <motion.h1
            custom={0}
            variants={fadeUp}
            className="text-[clamp(40px,6vw,76px)] leading-[1.04] tracking-[-0.04em]
                       font-[800] text-apple-ink"
          >
            <Trans
              i18nKey="landing.hero.title"
              components={{
                grad: (
                  <span className="bg-gradient-to-r from-berry-blue to-berry-purple
                                   bg-clip-text text-transparent" />
                ),
              }}
            />
          </motion.h1>

          <motion.p
            custom={1}
            variants={fadeUp}
            className="mt-7 text-[18px] leading-[1.55] text-apple-ink-3 max-w-[620px] mx-auto"
          >
            {t("landing.hero.subtitle")}
          </motion.p>

          <motion.div
            custom={2}
            variants={fadeUp}
            className="mt-10 flex items-center justify-center gap-3"
          >
            <button
              onClick={onCta}
              className="group flex items-center gap-2 px-5 py-3 rounded-full
                         bg-apple-ink text-white text-[14px] font-semibold
                         shadow-lift-md hover:shadow-lift-xl
                         hover:bg-apple-ink-2 hover:-translate-y-0.5
                         active:translate-y-0 active:scale-[0.98]
                         focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-apple-ink/25 focus-visible:ring-offset-2 focus-visible:ring-offset-apple-bg
                         transition-all duration-200 ease-out"
            >
              {t("landing.hero.ctaPrimary")}
              <ArrowRight size={16} strokeWidth={2.5} className="transition-transform duration-200 group-hover:translate-x-0.5" />
            </button>
            <button
              onClick={onCta}
              className="px-5 py-3 rounded-full
                         bg-white/70 backdrop-blur-md
                         border border-apple-line
                         text-[14px] font-semibold text-apple-ink-2
                         shadow-lift-sm hover:shadow-lift-md
                         hover:bg-white hover:-translate-y-0.5
                         active:translate-y-0 active:scale-[0.98]
                         focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-apple-ink/15 focus-visible:ring-offset-2 focus-visible:ring-offset-apple-bg
                         transition-all duration-200 ease-out"
            >
              {t("landing.hero.ctaSecondary")}
            </button>
          </motion.div>
        </motion.div>

        {/* centerpiece editor */}
        <motion.div
          initial={{ opacity: 0, y: 60, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ ...SPRING, delay: 0.45 }}
          className="mt-20 max-w-[960px] mx-auto"
        >
          <EditorCard />
        </motion.div>
      </div>
    </section>
  );
};

// ── Section header helper ───────────────────────────────────────────────
const SectionHeader: React.FC<{ eyebrow: string; title: React.ReactNode; sub?: string }> = ({
  eyebrow,
  title,
  sub,
}) => (
  <motion.div
    initial={{ opacity: 0, y: 20 }}
    whileInView={{ opacity: 1, y: 0 }}
    viewport={{ once: true, amount: 0.5 }}
    transition={SPRING}
    className="text-center max-w-[640px] mx-auto mb-16"
  >
    <div className="inline-block px-3 py-1 rounded-full bg-apple-mist text-[11px] font-semibold tracking-wide uppercase text-apple-ink-3 mb-4">
      {eyebrow}
    </div>
    <h2 className="text-[clamp(28px,4vw,46px)] leading-[1.08] tracking-[-0.03em] font-[800] text-apple-ink">
      {title}
    </h2>
    {sub && <p className="mt-4 text-[16px] text-apple-ink-3 leading-[1.6]">{sub}</p>}
  </motion.div>
);

// ── Editor showcase section ─────────────────────────────────────────────
const EditorShowcase: React.FC = () => {
  const { t } = useTranslation();
  return (
  <section id="editor" className="px-6 py-28 bg-gradient-to-b from-apple-bg to-white overflow-hidden">
    <div className="max-w-[1180px] mx-auto">
      <SectionHeader
        eyebrow={t("landing.showcase.eyebrow")}
        title={t("landing.showcase.title")}
        sub={t("landing.showcase.subtitle")}
      />
      <div className="max-w-[940px] mx-auto">
        {/* Mascots row — sits between the subtitle and the editor card */}
        <HangingMascots />
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.2 }}
          transition={{ ...SPRING, delay: 0.1 }}
          className="relative -mt-12 sm:-mt-14 md:-mt-16"
        >
          <CollabEditorView />
        </motion.div>
      </div>
    </div>
  </section>
  );
};

// ── Hanging mascots (decorative) ────────────────────────────────────────
type HangingMascotProps = {
  src: string;
  delay: number;
  swingFrom: number;
  swingTo: number;
  duration: number;
  positionClass: string;
  sizeClass: string;
};

const HangingMascot: React.FC<HangingMascotProps> = ({
  src,
  delay,
  swingFrom,
  swingTo,
  duration,
  positionClass,
  sizeClass,
}) => (
  <motion.div
    initial={{ opacity: 0, y: -24 }}
    whileInView={{ opacity: 1, y: 0 }}
    viewport={{ once: true, amount: 0.2 }}
    transition={{ ...SPRING, delay }}
    className={`absolute ${positionClass}`}
    style={{ transformOrigin: "50% 0%" }}
  >
    <motion.img
      src={src}
      alt=""
      animate={{ rotate: [swingFrom, swingTo, swingFrom] }}
      transition={{ duration, repeat: Infinity, ease: "easeInOut" }}
      style={{ transformOrigin: "50% 0%" }}
      className={`${sizeClass} h-auto select-none drop-shadow-[0_8px_18px_rgba(0,0,0,0.12)]`}
    />
  </motion.div>
);

// ─────────────────────────────────────────────────────────────────────────
//  MASCOT TWEAK PANEL — edit anything here to reposition / resize mascots
// ─────────────────────────────────────────────────────────────────────────
//
//  HORIZONTAL: change left-[N%] / right-[N%] (or use left-[Npx])
//  VERTICAL:   change top-[N%] / top-[Npx]   (negative also works: top-[-20px])
//  SIZE:       all three share MASCOT_SIZE — bump it up/down for larger/smaller
//              (override per mascot by replacing sizeClass on that mascot)
//  ROW HEIGHT: MASCOT_ROW_HEIGHT controls how tall the mascots area is —
//              raise it to push them further from the editor card below.
//  OVERLAP:    the editor card pulls up via -mt-* in <EditorShowcase/>.
//              Adjust the -mt-* there to control how much mascots overlap
//              the top of the editor (more negative = more overlap).
//
const MASCOT_SIZE = "w-[90px] sm:w-[105px] md:w-[120px]";
const MASCOT_ROW_HEIGHT = "h-24 sm:h-28 md:h-32";

const HangingMascots: React.FC = () => (
  <div
    aria-hidden="true"
    className={`pointer-events-none relative w-full ${MASCOT_ROW_HEIGHT} z-10`}
  >
    {/* STRAWIE — left side */}
    <HangingMascot
      src={strawieHanging}
      delay={0.15}
      swingFrom={0}
      swingTo={0}
      duration={8}
      positionClass="left-[6%] sm:left-[10%] md:left-[14%] top-[-44px]"
      sizeClass={MASCOT_SIZE}
    />
    {/* BERRY — center, slightly lower */}
    <HangingMascot
      src={berryHanging}
      delay={0.25}
      swingFrom={0}
      swingTo={0}
      duration={7}
      positionClass="left-[50%] -translate-x-1/2 top-[-18px]"
      sizeClass={MASCOT_SIZE}
    />
    {/* RASPIE — right side */}
    <HangingMascot
      src={raspieHanging}
      delay={0.35}
      swingFrom={0}
      swingTo={0}
      duration={9}
      positionClass="right-[6%] sm:right-[10%] md:right-[16%] top-[-28px]"
      sizeClass={MASCOT_SIZE}
    />
  </div>
);

// ── Bento ───────────────────────────────────────────────────────────────
const BentoTile: React.FC<{
  className?: string;
  children: React.ReactNode;
  delay?: number;
}> = ({ className = "", children, delay = 0 }) => (
  <motion.div
    initial={{ opacity: 0, y: 24 }}
    whileInView={{ opacity: 1, y: 0 }}
    viewport={{ once: true, amount: 0.2 }}
    transition={{ ...SPRING, delay }}
    whileHover={{ y: -4 }}
    className={`relative rounded-[24px] bg-white border border-apple-line shadow-lift-md
                p-7 overflow-hidden ${className}`}
  >
    {children}
  </motion.div>
);

const Bento: React.FC = () => {
  const { t } = useTranslation();
  return (
  <section id="features" className="px-6 py-28">
    <div className="max-w-[1180px] mx-auto">
      <SectionHeader
        eyebrow={t("landing.features.eyebrow")}
        title={t("landing.features.title")}
        sub={t("landing.features.subtitle")}
      />

      <div className="grid grid-cols-1 md:grid-cols-6 gap-4">
        {/* 1. Live editing — wide */}
        <BentoTile className="md:col-span-4 md:row-span-2 min-h-[420px]" delay={0}>
          <div className="flex items-center gap-2 text-[12px] font-semibold text-berry-blue uppercase tracking-wider mb-2">
            <Code2 size={14} /> {t("landing.features.liveEditing.tag")}
          </div>
          <h3 className="text-[24px] font-[800] tracking-[-0.02em] text-apple-ink mb-2">
            {t("landing.features.liveEditing.title")}
          </h3>
          <p className="text-[14px] text-apple-ink-3 leading-relaxed mb-6 max-w-[420px]">
            {t("landing.features.liveEditing.body")}
          </p>
          <div className="absolute bottom-0 right-0 w-[78%] translate-y-[18%] translate-x-[10%]">
            <div className="rounded-tl-[18px] overflow-hidden shadow-lift-md">
              <BentoEditorMini />
            </div>
          </div>
        </BentoTile>

        {/* 2. AI hints */}
        <BentoTile className="md:col-span-2" delay={0.05}>
          <div className="flex items-center gap-2 text-[12px] font-semibold text-berry-purple uppercase tracking-wider mb-2">
            <Sparkles size={14} /> {t("landing.features.aiHints.tag")}
          </div>
          <h3 className="text-[20px] font-[800] tracking-[-0.02em] text-apple-ink mb-2">
            {t("landing.features.aiHints.title")}
          </h3>
          <div className="flex items-end gap-3">
            <img src={berryAsking} alt="" className="w-20 h-24 object-contain drop-shadow-sm" />
            <div className="flex-1 mb-2 px-3 py-2 rounded-2xl rounded-bl-sm bg-berry-purple-soft text-[12px] text-apple-ink-2 leading-snug border border-berry-purple/15">
              <Trans
                i18nKey="landing.features.aiHints.bubble"
                components={{ code: <code className="px-1 rounded bg-white text-berry-purple font-mono" /> }}
              />
            </div>
          </div>
        </BentoTile>

        {/* 3. Auto-grading */}
        <BentoTile className="md:col-span-2" delay={0.1}>
          <div className="flex items-center gap-2 text-[12px] font-semibold text-emerald-600 uppercase tracking-wider mb-2">
            <CheckCircle2 size={14} /> {t("landing.features.autoGrading.tag")}
          </div>
          <h3 className="text-[20px] font-[800] tracking-[-0.02em] text-apple-ink mb-3">
            {t("landing.features.autoGrading.title")}
          </h3>
          <div className="space-y-2 text-[12px] font-mono">
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-50 border border-emerald-100 text-emerald-700">
              <CheckCircle2 size={12} /> test_prints_welcome — {t("landing.features.autoGrading.passed")}
            </div>
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-50 border border-emerald-100 text-emerald-700">
              <CheckCircle2 size={12} /> test_xp_increments — {t("landing.features.autoGrading.passed")}
            </div>
          </div>
        </BentoTile>

        {/* 4. Invite codes */}
        <BentoTile className="md:col-span-2" delay={0.15}>
          <div className="flex items-center gap-2 text-[12px] font-semibold text-berry-coral uppercase tracking-wider mb-2">
            <KeyRound size={14} /> {t("landing.features.invite.tag")}
          </div>
          <h3 className="text-[20px] font-[800] tracking-[-0.02em] text-apple-ink mb-3">
            {t("landing.features.invite.title")}
          </h3>
          <div className="flex items-center gap-1">
            {"H6P-2Q9".split("").map((ch, i) =>
              ch === "-" ? (
                <span key={i} className="text-apple-ink-4 mx-0.5">·</span>
              ) : (
                <div
                  key={i}
                  className="w-9 h-11 flex items-center justify-center rounded-lg
                             bg-apple-mist border border-apple-line
                             text-apple-ink font-mono font-bold"
                >
                  {ch}
                </div>
              )
            )}
          </div>
        </BentoTile>

        {/* 5. Sandbox */}
        <BentoTile className="md:col-span-2" delay={0.2}>
          <div className="flex items-center gap-2 text-[12px] font-semibold text-apple-ink-3 uppercase tracking-wider mb-2">
            <Terminal size={14} /> {t("landing.features.sandbox.tag")}
          </div>
          <h3 className="text-[20px] font-[800] tracking-[-0.02em] text-apple-ink mb-3">
            {t("landing.features.sandbox.title")}
          </h3>
          <div className="rounded-xl bg-apple-ink p-3 font-mono text-[11px]">
            <div className="text-emerald-400">$ python lesson_1.py</div>
            <div className="text-zinc-300 mt-1">Welcome to class, Berry!</div>
            <div className="text-zinc-500 mt-1">— exit code 0 in 0.04s</div>
          </div>
        </BentoTile>

        {/* 6. Drawing Mode — fills row 3 cols 5-6 */}
        <BentoTile className="md:col-span-2" delay={0.22}>
          <div className="flex items-center gap-2 text-[12px] font-semibold text-berry-coral uppercase tracking-wider mb-2">
            <PenLine size={14} /> {t("landing.features.drawing.tag")}
          </div>
          <h3 className="text-[20px] font-[800] tracking-[-0.02em] text-apple-ink mb-3">
            {t("landing.features.drawing.title")}
          </h3>
          <div className="relative rounded-xl border border-apple-line bg-apple-mist/30 h-[90px] overflow-hidden">
            <svg className="absolute inset-0 w-full h-full" viewBox="0 0 200 90" preserveAspectRatio="none">
              <motion.path
                d="M 15 68 Q 50 18 90 45 T 155 35"
                stroke="#5B7FFF" strokeWidth="2.5" fill="none" strokeLinecap="round" opacity="0.85"
                initial={{ pathLength: 0 }}
                animate={{ pathLength: 1 }}
                transition={{ duration: 1.4, ease: "easeInOut", repeat: Infinity, repeatDelay: 1.2, repeatType: "loop" }}
              />
              <motion.path
                d="M 40 75 Q 75 35 115 55 T 185 42"
                stroke="#9B7BFF" strokeWidth="2.5" fill="none" strokeLinecap="round" opacity="0.85"
                initial={{ pathLength: 0 }}
                animate={{ pathLength: 1 }}
                transition={{ duration: 1.4, ease: "easeInOut", delay: 0.35, repeat: Infinity, repeatDelay: 1.2, repeatType: "loop" }}
              />
            </svg>
            <div className="absolute top-1.5 right-2 flex gap-1">
              <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full text-white" style={{ background: "#5B7FFF" }}>Strawie</span>
              <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full text-white" style={{ background: "#9B7BFF" }}>Berry</span>
            </div>
          </div>
          <p className="text-[11px] text-apple-ink-3 mt-2 leading-snug">
            {t("landing.features.drawing.body")}
          </p>
        </BentoTile>

        {/* 7. Streaks — wide */}
        <BentoTile className="md:col-span-4" delay={0.25}>
          <div className="flex items-center justify-between mb-3">
            <div>
              <div className="flex items-center gap-2 text-[12px] font-semibold text-berry-amber uppercase tracking-wider mb-1">
                <Activity size={14} /> {t("landing.features.streaks.tag")}
              </div>
              <h3 className="text-[20px] font-[800] tracking-[-0.02em] text-apple-ink">
                {t("landing.features.streaks.title")}
              </h3>
            </div>
            <div className="text-right">
              <div className="text-[12px] font-bold text-apple-ink">Lv 3 · Coder</div>
              <div className="text-[11px] text-apple-ink-4">720 / 1500 XP</div>
            </div>
          </div>
          {/* XP progress bar */}
          <div className="h-1.5 rounded-full bg-apple-mist overflow-hidden mb-4">
            <motion.div
              className="h-full rounded-full bg-gradient-to-r from-berry-blue to-berry-purple"
              initial={{ width: "0%" }}
              whileInView={{ width: "48%" }}
              viewport={{ once: true }}
              transition={{ duration: 1.1, ease: [0.25, 0.46, 0.45, 0.94], delay: 0.2 }}
            />
          </div>
          <div className="flex gap-[3px]">
            {Array.from({ length: 12 }).map((_, w) => (
              <div key={w} className="flex flex-col gap-[3px]">
                {Array.from({ length: 7 }).map((_, d) => {
                  const r = Math.abs(Math.sin((w + 1) * (d + 2) * 13.7));
                  const lvl = w > 7 ? Math.floor(r * 4) : Math.floor(r * 3);
                  const palette = [
                    "bg-apple-mist",
                    "bg-berry-blue-soft",
                    "bg-berry-blue/40",
                    "bg-berry-blue",
                  ];
                  return (
                    <motion.div
                      key={d}
                      className={`w-3 h-3 rounded-[3px] ${palette[lvl]}`}
                      initial={{ opacity: 0, scale: 0.4 }}
                      whileInView={{ opacity: 1, scale: 1 }}
                      viewport={{ once: true }}
                      transition={{ duration: 0.25, delay: (w * 7 + d) * 0.012 }}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </BentoTile>

        {/* 8. Achievements — fills row 4 cols 5-6 */}
        <BentoTile className="md:col-span-2" delay={0.28}>
          <div className="flex items-center gap-2 text-[12px] font-semibold text-berry-amber uppercase tracking-wider mb-2">
            <Trophy size={14} /> {t("landing.features.achievements.tag")}
          </div>
          <h3 className="text-[20px] font-[800] tracking-[-0.02em] text-apple-ink mb-3">
            {t("landing.features.achievements.title")}
          </h3>
          <div className="flex gap-2">
            {[
              { icon: <Flame size={16} />, label: t("landing.features.achievements.streak"), bg: "bg-orange-50", border: "border-orange-100", text: "text-orange-500" },
              { icon: <Zap size={16} />, label: t("landing.features.achievements.firstSolve"), bg: "bg-blue-50", border: "border-blue-100", text: "text-berry-blue" },
              { icon: <Trophy size={16} />, label: t("landing.features.achievements.topScorer"), bg: "bg-yellow-50", border: "border-yellow-100", text: "text-yellow-500" },
            ].map((b) => (
              <div
                key={b.label}
                className={`flex flex-col items-center gap-1 px-2 py-2.5 rounded-xl border flex-1 ${b.bg} ${b.border}`}
              >
                <span className={b.text}>{b.icon}</span>
                <span className={`text-[9px] font-semibold leading-tight text-center ${b.text}`}>{b.label}</span>
              </div>
            ))}
          </div>
          <div className="mt-3 flex gap-2">
            {[
              { icon: <Star size={14} />, label: t("landing.features.achievements.hundredXp"), locked: false },
              { icon: <Lightbulb size={14} />, label: t("landing.features.achievements.hintMaster"), locked: false },
              { icon: <Target size={14} />, label: t("landing.features.achievements.perfectRun"), locked: true },
            ].map((b) => (
              <div
                key={b.label}
                className={`flex flex-col items-center gap-1 px-2 py-2 rounded-xl border flex-1 ${b.locked ? "bg-apple-mist border-apple-line opacity-40" : "bg-white border-apple-line"}`}
              >
                <span className="text-apple-ink-3">{b.icon}</span>
                <span className="text-[9px] font-medium text-apple-ink-3 text-center leading-tight">{b.label}</span>
              </div>
            ))}
          </div>
        </BentoTile>
      </div>
    </div>
  </section>
  );
};

// ── How it works ───────────────────────────────────────────────────────
const Steps: React.FC = () => {
  const { t } = useTranslation();
  const steps: { n: string; title: string; desc: string; mascot?: string; mascotClass?: string }[] = [
    { n: "01", title: t("landing.steps.step1Title"), desc: t("landing.steps.step1Desc"), mascot: strawieTeaching },
    {
      n: "02",
      title: t("landing.steps.step2Title"),
      desc: t("landing.steps.step2Desc"),
      mascot: raspieSliding,
      mascotClass: "h-16 w-auto max-w-[7rem] object-contain object-left drop-shadow-sm mb-3",
    },
    { n: "03", title: t("landing.steps.step3Title"), desc: t("landing.steps.step3Desc"), mascot: berryAsking },
    { n: "04", title: t("landing.steps.step4Title"), desc: t("landing.steps.step4Desc"), mascot: berryBuildSuccess },
  ];

  return (
    <section className="px-6 py-28 bg-apple-mist/40">
      <div className="max-w-[1180px] mx-auto">
        <SectionHeader
          eyebrow={t("landing.steps.eyebrow")}
          title={t("landing.steps.title")}
        />
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {steps.map((s, i) => (
            <motion.div
              key={s.n}
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.4 }}
              transition={{ ...SPRING, delay: i * 0.06 }}
              className="rounded-[20px] bg-white border border-apple-line shadow-lift-sm p-6"
            >
              {s.mascot && (
                <img
                  src={s.mascot}
                  alt=""
                  className={
                    s.mascotClass ?? "w-16 h-16 object-contain drop-shadow-sm mb-3"
                  }
                />
              )}
              <div className="font-mono text-[12px] font-semibold text-apple-ink-4 mb-3">
                {s.n}
              </div>
              <h3 className="text-[17px] font-[700] text-apple-ink mb-1.5 tracking-[-0.01em]">
                {s.title}
              </h3>
              <p className="text-[13px] text-apple-ink-3 leading-[1.55]">{s.desc}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
};

// ── Roles split ────────────────────────────────────────────────────────
const Roles: React.FC<{ onCta: () => void }> = ({ onCta }) => {
  const { t } = useTranslation();
  const teacher = {
    id: "teachers",
    roleKey: "teacher" as const,
    roleLabel: t("landing.roles.forTeachers"),
    heading: t("landing.roles.teacherHeading"),
    openLabel: t("landing.roles.openAsTeacher"),
    img: strawieTeaching,
    accentText: "text-berry-blue",
    bullets: [
      t("landing.roles.teacherBullet1"),
      t("landing.roles.teacherBullet2"),
      t("landing.roles.teacherBullet3"),
      t("landing.roles.teacherBullet4"),
      t("landing.roles.teacherBullet5"),
    ],
  };
  const student = {
    id: "students",
    roleKey: "student" as const,
    roleLabel: t("landing.roles.forStudents"),
    heading: t("landing.roles.studentHeading"),
    openLabel: t("landing.roles.openAsStudent"),
    img: berryFocused,
    accentText: "text-berry-purple",
    bullets: [
      t("landing.roles.studentBullet1"),
      t("landing.roles.studentBullet2"),
      t("landing.roles.studentBullet3"),
      t("landing.roles.studentBullet4"),
      t("landing.roles.studentBullet5"),
    ],
  };

  return (
    <section className="px-6 py-28">
      <div className="max-w-[1180px] mx-auto">
        <SectionHeader
          eyebrow={t("landing.roles.eyebrow")}
          title={t("landing.roles.title")}
        />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {[teacher, student].map((r, i) => (
            <motion.div
              key={r.roleKey}
              id={r.id}
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.3 }}
              transition={{ ...SPRING, delay: i * 0.1 }}
              className="relative rounded-[28px] bg-white border border-apple-line
                         shadow-lift-md p-8 overflow-hidden"
            >
              <div className="flex items-center gap-4 mb-6">
                <div className="w-20 h-20 flex items-end justify-center shrink-0">
                  <img
                    src={r.img}
                    alt=""
                    className="w-full h-full object-contain drop-shadow-md"
                  />
                </div>
                <div>
                  <div className={`text-[11px] font-semibold uppercase tracking-wider ${r.accentText}`}>
                    {r.roleLabel}
                  </div>
                  <h3 className="text-[24px] font-[800] tracking-[-0.02em] text-apple-ink">
                    {r.heading}
                  </h3>
                </div>
              </div>
              <ul className="space-y-3">
                {r.bullets.map((b) => (
                  <li key={b} className="flex items-start gap-3 text-[14px] text-apple-ink-2">
                    <CheckCircle2
                      size={16}
                      className={`mt-0.5 shrink-0 ${r.accentText}`}
                      strokeWidth={2.2}
                    />
                    {b}
                  </li>
                ))}
              </ul>
              <div className="mt-7">
                <button
                  onClick={onCta}
                  className={`group w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-full
                              bg-apple-ink text-white text-[13px] font-semibold
                              shadow-lift-sm hover:shadow-lift-md hover:bg-apple-ink-2
                              hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98]
                              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-apple-ink/25 focus-visible:ring-offset-2 focus-visible:ring-offset-apple-surface
                              transition-all duration-200 ease-out`}
                >
                  {r.openLabel}
                  <ArrowRight size={14} strokeWidth={2.5} className="transition-transform duration-200 group-hover:translate-x-0.5" />
                </button>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
};

// ── CTA ────────────────────────────────────────────────────────────────
const CTA: React.FC<{ onCta: () => void }> = ({ onCta }) => {
  const { t } = useTranslation();
  return (
  <section className="px-6 py-32">
    <div className="max-w-[920px] mx-auto">
      <div className="relative rounded-[32px] bg-white border border-apple-line shadow-lift-xl p-12 text-center overflow-hidden">
        {/* gentle gradient blobs */}
        <div className="absolute -top-32 left-1/3 w-96 h-96 bg-berry-blue-soft rounded-full blur-3xl" />
        <div className="absolute -bottom-32 right-1/3 w-96 h-96 bg-berry-purple-soft rounded-full blur-3xl" />

        <div className="relative">
          <motion.img
            src={raspieReady}
            alt=""
            initial={{ opacity: 0, y: 20, scale: 0.9 }}
            whileInView={{ opacity: 1, y: 0, scale: 1 }}
            viewport={{ once: true }}
            transition={{ ...SPRING, delay: 0.05 }}
            className="w-24 h-24 object-contain drop-shadow-lg mx-auto mb-4"
          />
          <motion.h2
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={SPRING}
            className="text-[clamp(32px,4vw,52px)] leading-[1.05] tracking-[-0.03em] font-[800] text-apple-ink"
          >
            {t("landing.cta.title")}
          </motion.h2>
          <motion.p
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ ...SPRING, delay: 0.1 }}
            className="mt-4 text-[16px] text-apple-ink-3 max-w-[480px] mx-auto"
          >
            {t("landing.cta.subtitle")}
          </motion.p>
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ ...SPRING, delay: 0.18 }}
            className="mt-9 flex items-center justify-center gap-3"
          >
            <button
              onClick={onCta}
              className="group flex items-center gap-2 px-6 py-3 rounded-full
                         bg-apple-ink text-white text-[14px] font-semibold
                         shadow-lift-md hover:shadow-lift-xl hover:bg-apple-ink-2
                         hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98]
                         focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-apple-ink/25 focus-visible:ring-offset-2 focus-visible:ring-offset-apple-surface
                         transition-all duration-200 ease-out"
            >
              {t("landing.cta.button")}
              <ArrowRight size={16} strokeWidth={2.5} className="transition-transform duration-200 group-hover:translate-x-0.5" />
            </button>
          </motion.div>
        </div>
      </div>
    </div>
  </section>
  );
};

// ── Footer ─────────────────────────────────────────────────────────────
const Footer: React.FC = () => {
  const { t } = useTranslation();
  const [showTerms, setShowTerms] = useState(false);
  const [showPrivacy, setShowPrivacy] = useState(false);
  return (
    <>
      <footer className="px-6 py-10 border-t border-apple-line bg-white">
        <div className="max-w-[1180px] mx-auto flex items-center justify-between">
          <StrawieLogoSvg size={24} />
          <div className="flex items-center gap-4 text-[12px] text-apple-ink-4">
            <button
              onClick={() => setShowTerms(true)}
              className="hover:text-apple-ink transition-colors"
            >
              Terms of Service
            </button>
            <span>·</span>
            <button
              onClick={() => setShowPrivacy(true)}
              className="hover:text-apple-ink transition-colors"
            >
              Privacy Policy
            </button>
            <span>·</span>
            <span>{t("landing.footer.copyright")}</span>
          </div>
        </div>
      </footer>
      {showTerms && <TermsModal onClose={() => setShowTerms(false)} />}
      {showPrivacy && <PrivacyModal onClose={() => setShowPrivacy(false)} />}
    </>
  );
};

// ── Open-in-browser modal ───────────────────────────────────────────────
const OpenInBrowserModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [copied, setCopied] = useState(false);
  const isIos = /iPhone|iPad|iPod/.test(navigator.userAgent);

  const copyLink = () => {
    navigator.clipboard.writeText(window.location.href).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm bg-white rounded-2xl shadow-2xl p-6 flex flex-col gap-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-semibold text-apple-ink text-[15px]">Open in your browser to sign in</p>
            <p className="text-[13px] text-apple-ink-3 mt-1 leading-snug">
              Google doesn't allow sign-in inside the LinkedIn app.{" "}
              {isIos
                ? "Tap the ··· menu at the top right and choose “Open in Safari”."
                : "Tap the ··· menu and choose “Open in browser”."}
            </p>
          </div>
          <button onClick={onClose} className="text-apple-ink-3 hover:text-apple-ink text-xl leading-none mt-0.5">×</button>
        </div>
        <button
          onClick={copyLink}
          className="w-full py-2.5 rounded-xl bg-apple-ink text-white text-[14px] font-semibold active:scale-[0.98] transition"
        >
          {copied ? "Copied!" : "Copy link"}
        </button>
      </div>
    </div>
  );
};

// ── Page ───────────────────────────────────────────────────────────────
export const LandingPage: React.FC = () => {
  const navigate = useNavigate();
  const [showBrowserModal, setShowBrowserModal] = useState(false);

  useEffect(() => {
    // `?preview` keeps us on the marketing page even when logged in — so the
    // landing can be reviewed without logging out. Real visitors never use it.
    if (new URLSearchParams(window.location.search).has("preview")) return;
    // Cookie auth: probe /me to learn if we're logged in. 401 = not logged in,
    // stay on the landing page.
    getMe()
      .then(() => navigate("/app", { replace: true }))
      .catch(() => {});
  }, [navigate]);

  const handleSignIn = isInAppBrowser()
    ? () => setShowBrowserModal(true)
    : googleLogin;

  // Force light surface for the page; rest of the app is dark.
  return (
    <div
      data-theme="light"
      className="min-h-screen bg-apple-bg text-apple-ink antialiased"
      style={{
        // Keep wordmark/logo visible — Logo reads --text via data-theme="light".
        background:
          "radial-gradient(1200px 800px at 50% -200px, #FFFFFF 0%, #FAFAF7 60%, #FAFAF7 100%)",
      }}
    >
      {showBrowserModal && <OpenInBrowserModal onClose={() => setShowBrowserModal(false)} />}
      <Nav onSignIn={handleSignIn} />
      <Hero onCta={handleSignIn} />
      <EditorShowcase />
      <Bento />
      <Steps />
      <Roles onCta={handleSignIn} />
      <CTA onCta={handleSignIn} />
      <Footer />
    </div>
  );
};
