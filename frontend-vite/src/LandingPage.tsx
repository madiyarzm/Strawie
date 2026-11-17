import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation, Trans } from "react-i18next";
import { motion, AnimatePresence } from "framer-motion";
import {
  Activity,
  ArrowRight,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  CloudUpload,
  EyeOff,
  FileText,
  LifeBuoy,
  Lock,
  Mail,
  PenLine,
  Play,
  ShieldCheck,
  Terminal,
  UserRound,
  XCircle,
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

const CONTACT_EMAIL = "madiyar.zmm@gmail.com";

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

/** Tiny single-pass highlighter for the marketing mocks. */
function highlight(src: string): Line {
  const out: Line = [];
  const re = /(#.*$)|("[^"]*"|'[^']*')|\b(def|return|for|in|if|else|import)\b|\b(print|round|len|range|split|sum)\b|\b(\d+(?:\.\d+)?)\b/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    if (m.index > last) out.push({ t: src.slice(last, m.index), c: PY.ink });
    const color = m[1] ? PY.comment : m[2] ? PY.string : m[3] ? PY.keyword : m[4] ? PY.fn : PY.number;
    out.push({ t: m[0], c: color });
    last = m.index + m[0].length;
  }
  if (last < src.length) out.push({ t: src.slice(last), c: PY.ink });
  return out;
}

const ctaPrimary =
  "group inline-flex items-center gap-2 px-5 py-3 rounded-full whitespace-nowrap " +
  "bg-apple-ink text-white text-[14px] font-semibold shadow-lift-md hover:shadow-lift-xl " +
  "hover:bg-apple-ink-2 hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98] " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-apple-ink/25 focus-visible:ring-offset-2 focus-visible:ring-offset-apple-bg " +
  "transition-all duration-200 ease-out";
const ctaSecondary =
  "inline-flex items-center gap-2 px-5 py-3 rounded-full whitespace-nowrap bg-white/80 backdrop-blur-md " +
  "border border-apple-line text-[14px] font-semibold text-apple-ink-2 shadow-lift-sm hover:shadow-lift-md " +
  "hover:bg-white hover:text-apple-ink hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98] " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-apple-ink/15 focus-visible:ring-offset-2 focus-visible:ring-offset-apple-bg " +
  "transition-all duration-200 ease-out";

// ── Glass nav ───────────────────────────────────────────────────────────
const Nav: React.FC<{ onSignIn: () => void }> = ({ onSignIn }) => {
  const { t } = useTranslation();
  // Condense the floating nav once the user scrolls past the hero.
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 16);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const link = "px-3 py-1.5 rounded-full hover:bg-apple-mist hover:text-apple-ink transition-colors duration-200";
  return (
    <header className={`fixed inset-x-0 z-50 flex justify-center px-3 sm:px-4 transition-all duration-300 ease-out ${scrolled ? "top-2" : "top-3 sm:top-4"}`}>
      <nav
        className={`flex items-center gap-1 sm:gap-2 rounded-full max-w-full
                   bg-white/70 backdrop-blur-xl border border-white/60
                   transition-all duration-300 ease-out
                   ${scrolled ? "px-2 sm:px-2.5 py-1.5 shadow-lift-md bg-white/80" : "px-2 sm:px-3 py-2 shadow-lift-glass"}`}
      >
        <a href="#top" className="pl-1.5 sm:pl-2 pr-1 sm:pr-3 shrink-0" aria-label="Strawie">
          <StrawieLogoSvg size={scrolled ? 23 : 26} />
        </a>
        <div className="hidden lg:flex items-center gap-1 text-[13px] text-apple-ink-3 font-medium">
          <a className={link} href="#lessons">{t("landing.nav.lessons")}</a>
          <a className={link} href="#features">{t("landing.nav.features")}</a>
          <a className={link} href="#how">{t("landing.nav.how")}</a>
          <a className={link} href="#faq">{t("landing.nav.faq")}</a>
        </div>
        <div className="hidden sm:block shrink-0"><LanguageSwitcher variant="light" /></div>
        {/* Public demo: no account needed. Plain <a> so it can be shared as a bare link. */}
        <a
          href="/demo"
          className="px-2.5 sm:px-3 py-1.5 text-[13px] font-semibold text-apple-ink-2 hover:text-apple-ink rounded-full whitespace-nowrap transition-colors duration-200
                     focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-apple-ink/15"
        >
          {t("landing.nav.demo")}
        </a>
        <button
          onClick={onSignIn}
          className="hidden sm:inline px-3 py-1.5 text-[13px] font-medium text-apple-ink-2 hover:text-apple-ink rounded-full whitespace-nowrap transition-colors duration-200
                     focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-apple-ink/15"
        >
          {t("landing.nav.signIn")}
        </button>
        <button
          onClick={onSignIn}
          className="group flex items-center gap-1.5 px-3.5 sm:px-4 py-1.5 rounded-full whitespace-nowrap shrink-0
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

// ── Hero: a live lesson page ────────────────────────────────────────────
const HERO_CODE = [
  "def split(total, people):",
  "    return round(total / people, 2)",
  "",
];
const HERO_TYPED = "print(split(1260, 3))";

const NotebookHeroCard: React.FC = () => {
  const { t } = useTranslation();
  const [typed, setTyped] = useState(0);
  const [phase, setPhase] = useState<"typing" | "ran" | "graded">("typing");

  useEffect(() => {
    if (phase === "typing") {
      if (typed < HERO_TYPED.length) {
        const id = setTimeout(() => setTyped(n => n + 1), 75);
        return () => clearTimeout(id);
      }
      const id = setTimeout(() => setPhase("ran"), 500);
      return () => clearTimeout(id);
    }
    if (phase === "ran") {
      const id = setTimeout(() => setPhase("graded"), 900);
      return () => clearTimeout(id);
    }
    const id = setTimeout(() => { setTyped(0); setPhase("typing"); }, 3600);
    return () => clearTimeout(id);
  }, [typed, phase]);

  const lines: Line[] = [...HERO_CODE.map(highlight), highlight(HERO_TYPED.slice(0, typed))];

  return (
    <div className="rounded-[22px] bg-white border border-apple-line shadow-lift-xl overflow-hidden text-left">
      {/* window chrome */}
      <div className="flex items-center gap-3 px-4 h-10 border-b border-apple-line bg-apple-mist/50">
        <div className="flex gap-1.5 shrink-0">
          <span className="w-2.5 h-2.5 rounded-full bg-[#FF6058]" />
          <span className="w-2.5 h-2.5 rounded-full bg-[#FFBD2E]" />
          <span className="w-2.5 h-2.5 rounded-full bg-[#28C840]" />
        </div>
        <div className="flex-1 flex justify-center min-w-0">
          <div className="flex items-center gap-2 text-[11px] font-medium text-apple-ink-3 truncate">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse shrink-0" />
            <span className="truncate">{t("landing.hero.mockTitle")}</span>
          </div>
        </div>
        <div className="flex items-center -space-x-1.5 shrink-0">
          <PresenceDot color="#5B7FFF" name="T" />
          <PresenceDot color="#9B7BFF" name="B" />
          <PresenceDot color="#F97316" name="R" />
        </div>
      </div>

      <div className="px-5 sm:px-8 py-6 sm:py-7 bg-apple-bg/60">
        {/* text block: the task */}
        <div className="flex items-center gap-2.5 mb-2">
          <span className="w-6 h-6 rounded-full bg-apple-ink text-white text-[12px] font-bold grid place-items-center">1</span>
          <span className="text-[16px] font-bold text-apple-ink tracking-[-0.01em]">{t("landing.hero.mockTaskTitle")}</span>
          <AnimatePresence>
            {phase === "graded" && (
              <motion.span
                initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}
                className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-100"
              >
                {t("landing.hero.mockTests")}
              </motion.span>
            )}
          </AnimatePresence>
        </div>
        <p className="text-[14px] text-apple-ink-3 leading-[1.6] mb-4 max-w-[620px]">
          <Trans i18nKey="landing.hero.mockTaskBody" components={{ code: <code className="px-1 rounded bg-apple-mist text-apple-ink-2 font-mono text-[12.5px]" /> }} />
        </p>

        {/* code block */}
        <div className="rounded-[16px] bg-white border border-apple-line shadow-lift-sm overflow-hidden">
          <div className="grid grid-cols-[40px_minmax(0,1fr)]">
            <div className="pt-2.5 pl-2">
              <span className="w-[26px] h-[26px] rounded-full bg-apple-ink text-white grid place-items-center">
                <Play size={11} fill="currentColor" />
              </span>
            </div>
            <div className="flex font-mono text-[12.5px] sm:text-[13px] leading-[22px] py-3 overflow-x-auto">
              <div className="pr-3 text-right text-apple-ink-4/60 select-none">
                {lines.map((_, i) => <div key={i}>{i + 1}</div>)}
              </div>
              <div className="flex-1 relative pr-4 whitespace-pre">
                {lines.map((line, li) => (
                  <div key={li} className="relative min-h-[22px]">
                    {line.length === 0 ? <span>&nbsp;</span> : line.map((tok, ti) => <span key={ti} style={{ color: tok.c }}>{tok.t}</span>)}
                    {li === 1 && <CollabCursor color="#5B7FFF" label={t("landing.hero.mockTeacher")} offsetCh={35} />}
                    {li === 3 && phase === "typing" && <CollabCursor color="#9B7BFF" label="Berry" offsetCh={typed} />}
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className="border-t border-apple-line bg-apple-mist/40 px-5 py-2.5 pl-12 min-h-[42px] flex items-center gap-3 font-mono text-[12.5px]">
            {phase === "typing" ? (
              <span className="text-apple-ink-4 font-sans text-[12px]">{t("landing.hero.mockRunHint")}</span>
            ) : (
              <>
                <span className="text-apple-ink-2">420.0</span>
                {phase === "graded" && (
                  <motion.span
                    initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
                    className="ml-auto text-[11px] font-semibold font-sans text-berry-blue bg-berry-blue-soft px-2 py-0.5 rounded-full"
                  >
                    +40 XP
                  </motion.span>
                )}
              </>
            )}
          </div>
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
  // The wrapper inherits the code font, so `ch` matches the code's character
  // width; the caret and the label then sit at the same x.
  <span className="absolute top-0 bottom-0 pointer-events-none" style={{ left: `${offsetCh}ch` }}>
    <span className="absolute left-0 top-[3px] w-[2px] h-[18px] animate-cursorPulse" style={{ background: color }} />
    <span
      className="absolute left-0 -top-[12px] px-1.5 py-px rounded-[3px] rounded-bl-none text-[9px] font-semibold text-white whitespace-nowrap"
      style={{ background: color, fontFamily: "Plus Jakarta Sans, sans-serif" }}
    >
      {label}
    </span>
  </span>
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
        <div className="flex-1 py-4 px-5 relative whitespace-pre overflow-x-auto">
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

// ── Hero ────────────────────────────────────────────────────────────────
const Hero: React.FC<{ onCta: () => void }> = ({ onCta }) => {
  const { t } = useTranslation();
  return (
    <section id="top" className="relative pt-32 sm:pt-36 pb-20 sm:pb-28 px-4 sm:px-6 overflow-hidden">
      <div className="absolute inset-0 -z-10">
        <div className="absolute top-32 left-1/2 -translate-x-1/2 w-[1200px] max-w-[200vw] h-[640px] bg-berry-blue-soft/35 blur-[120px] rounded-full" />
        <div className="absolute top-64 right-[-10%] w-[520px] h-[520px] bg-berry-purple-soft/30 blur-[120px] rounded-full" />
      </div>

      <div className="max-w-[1180px] mx-auto">
        <motion.div initial="hidden" animate="show" className="text-center max-w-[840px] mx-auto">
          <motion.h1
            custom={1}
            variants={fadeUp}
            className="text-[clamp(38px,6vw,76px)] leading-[1.04] tracking-[-0.04em] font-[800] text-apple-ink"
          >
            <Trans
              i18nKey="landing.hero.title"
              components={{ grad: <span className="bg-gradient-to-r from-berry-blue to-berry-purple bg-clip-text text-transparent" /> }}
            />
          </motion.h1>
          <motion.p
            custom={2}
            variants={fadeUp}
            className="mt-6 sm:mt-7 text-[16px] sm:text-[18px] leading-[1.55] text-apple-ink-3 max-w-[640px] mx-auto"
          >
            {t("landing.hero.subtitle")}
          </motion.p>
          <motion.div custom={3} variants={fadeUp} className="mt-9 sm:mt-10 flex flex-wrap items-center justify-center gap-3">
            <button onClick={onCta} className={ctaPrimary}>
              {t("landing.hero.ctaPrimary")}
              <ArrowRight size={16} strokeWidth={2.5} className="transition-transform duration-200 group-hover:translate-x-0.5" />
            </button>
            <a href="/demo" className={ctaSecondary}>
              <Play size={13} fill="currentColor" />
              {t("landing.hero.ctaDemo")}
            </a>
          </motion.div>
          <motion.div custom={4} variants={fadeUp} className="mt-4 text-[13px] text-apple-ink-4">
            {t("landing.hero.studentPrompt")}{" "}
            <button
              onClick={onCta}
              className="font-semibold text-apple-ink-2 underline decoration-apple-line decoration-2 underline-offset-4 hover:decoration-apple-ink/40 transition-colors"
            >
              {t("landing.hero.ctaJoin")}
            </button>
          </motion.div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 60, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ ...SPRING, delay: 0.45 }}
          className="mt-14 sm:mt-20 max-w-[900px] mx-auto"
        >
          <NotebookHeroCard />
        </motion.div>
      </div>
    </section>
  );
};

// ── Together / Solo ─────────────────────────────────────────────────────
type SoloStatus = "ran" | "typing" | "hand";
const SOLO_STUDENTS: { name: string; color: string; code: string[]; status: SoloStatus }[] = [
  { name: "Berry", color: "#9B7BFF", code: ["for i in range(1, 4):", "    print(i * i)"], status: "ran" },
  { name: "Raspie", color: "#F97316", code: ["for i in range(1, 4):", "    print(i *"], status: "typing" },
  { name: "Mint", color: "#10B981", code: ["for i in range(1, 4)", "    print(i)"], status: "hand" },
];

const SoloStatusPill: React.FC<{ status: SoloStatus }> = ({ status }) => {
  const { t } = useTranslation();
  if (status === "ran")
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-100">
        <Check size={11} strokeWidth={3} /> {t("landing.lessons.statusRan")}
      </span>
    );
  if (status === "typing")
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-apple-mist text-apple-ink-3 border border-apple-line">
        <span className="w-1.5 h-1.5 rounded-full bg-berry-blue animate-pulse" /> {t("landing.lessons.statusTyping")}
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-100">
      <LifeBuoy size={11} strokeWidth={2.5} /> {t("landing.lessons.statusHand")}
    </span>
  );
};

const SoloView: React.FC = () => {
  const { t } = useTranslation();
  return (
    <div className="rounded-[22px] bg-white border border-apple-line shadow-lift-xl overflow-hidden">
      <div className="flex items-center gap-3 px-4 h-10 border-b border-apple-line bg-apple-mist/50">
        <div className="flex gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-[#FF6058]" />
          <span className="w-2.5 h-2.5 rounded-full bg-[#FFBD2E]" />
          <span className="w-2.5 h-2.5 rounded-full bg-[#28C840]" />
        </div>
        <div className="flex-1 flex justify-center min-w-0">
          <span className="text-[11px] font-medium text-apple-ink-3 truncate">{t("landing.lessons.soloHeader", { count: 3 })}</span>
        </div>
        <span className="w-[52px]" />
      </div>
      <div className="p-4 sm:p-5 bg-apple-bg/60 grid grid-cols-1 sm:grid-cols-3 gap-3">
        {SOLO_STUDENTS.map((s, i) => (
          <motion.div
            key={s.name}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...SPRING, delay: i * 0.07 }}
            className={`rounded-[16px] bg-white border shadow-lift-sm overflow-hidden ${s.status === "hand" ? "border-amber-200 ring-2 ring-amber-100" : "border-apple-line"}`}
          >
            <div className="flex items-center gap-2 px-3 h-9 border-b border-apple-line">
              <span className="w-5 h-5 rounded-full grid place-items-center text-[9px] font-bold text-white" style={{ background: s.color }}>
                {s.name[0]}
              </span>
              <span className="text-[12px] font-semibold text-apple-ink-2">{s.name}</span>
            </div>
            <div className="px-3 py-2.5 font-mono text-[11.5px] leading-[19px] whitespace-pre overflow-hidden">
              {s.code.map((l, li) => (
                <div key={li}>{highlight(l).map((tok, ti) => <span key={ti} style={{ color: tok.c }}>{tok.t}</span>)}</div>
              ))}
            </div>
            <div className="px-3 pb-3">
              <SoloStatusPill status={s.status} />
            </div>
          </motion.div>
        ))}
      </div>
      <div className="border-t border-apple-line bg-apple-mist/40 px-5 py-3 text-[12px] text-apple-ink-3">
        {t("landing.lessons.soloFooter")}
      </div>
    </div>
  );
};

const TogetherSolo: React.FC = () => {
  const { t } = useTranslation();
  const [mode, setMode] = useState<"together" | "solo">("together");
  const [auto, setAuto] = useState(true);

  // Flip between the two modes on its own until the visitor picks one.
  useEffect(() => {
    if (!auto) return;
    const id = setTimeout(() => setMode(m => (m === "together" ? "solo" : "together")), 5200);
    return () => clearTimeout(id);
  }, [auto, mode]);

  const pick = (m: "together" | "solo") => { setAuto(false); setMode(m); };
  const seg = (active: boolean) =>
    `px-4 py-1.5 rounded-full text-[13px] font-semibold transition-all duration-200 ${
      active ? "bg-white text-apple-ink shadow-lift-sm" : "text-apple-ink-3 hover:text-apple-ink"
    }`;

  return (
    <section id="lessons" className="px-4 sm:px-6 py-20 sm:py-28 bg-gradient-to-b from-apple-bg to-white overflow-hidden scroll-mt-20">
      <div className="max-w-[1180px] mx-auto">
        <SectionHeader eyebrow={t("landing.lessons.eyebrow")} title={t("landing.lessons.title")} sub={t("landing.lessons.subtitle")} />
        <div className="flex justify-center -mt-8 mb-10">
          <div role="tablist" className="inline-flex p-1 rounded-full bg-apple-mist border border-apple-line">
            <button role="tab" aria-selected={mode === "together"} onClick={() => pick("together")} className={seg(mode === "together")}>
              {t("landing.lessons.together")}
            </button>
            <button role="tab" aria-selected={mode === "solo"} onClick={() => pick("solo")} className={seg(mode === "solo")}>
              {t("landing.lessons.solo")}
            </button>
          </div>
        </div>
        <div className="max-w-[940px] mx-auto">
          <HangingMascots />
          <div className="relative -mt-12 sm:-mt-14 md:-mt-16">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={mode}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.25 }}
              >
                {mode === "together" ? <CollabEditorView /> : <SoloView />}
              </motion.div>
            </AnimatePresence>
          </div>
          <p className="text-center text-[13px] text-apple-ink-4 mt-5">
            {mode === "together" ? t("landing.lessons.togetherHint") : t("landing.lessons.soloHint")}
          </p>
        </div>
      </div>
    </section>
  );
};

// ── Bento ───────────────────────────────────────────────────────────────
const TileHead: React.FC<{ icon: React.ReactNode; tag: string; title: string; tone: string; big?: boolean }> = ({ icon, tag, title, tone, big }) => (
  <>
    <div className={`flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wider mb-2 ${tone}`}>
      {icon} {tag}
    </div>
    <h3 className={`${big ? "text-[24px]" : "text-[20px]"} font-[800] tracking-[-0.02em] text-apple-ink mb-2`}>{title}</h3>
  </>
);

const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

const Bento: React.FC = () => {
  const { t } = useTranslation();
  const tests: { name: string; state: "pass" | "hidden" | "fail" }[] = [
    { name: "split(1260, 3) == 420.0", state: "pass" },
    { name: "split(10, 4) == 2.5", state: "pass" },
    { name: t("landing.features.homework.hiddenTest"), state: "hidden" },
    { name: "split(9, 0)", state: "fail" },
  ];
  return (
    <section id="features" className="px-4 sm:px-6 py-20 sm:py-28 scroll-mt-20">
      <div className="max-w-[1180px] mx-auto">
        <SectionHeader eyebrow={t("landing.features.eyebrow")} title={t("landing.features.title")} sub={t("landing.features.subtitle")} />

        <div className="grid grid-cols-1 md:grid-cols-6 gap-4">
          {/* Lesson pages */}
          <BentoTile className="md:col-span-4 md:row-span-2 md:min-h-[440px] flex flex-col" delay={0}>
            <TileHead icon={<FileText size={14} />} tag={t("landing.features.pages.tag")} title={t("landing.features.pages.title")} tone="text-berry-blue" big />
            <p className="text-[14px] text-apple-ink-3 leading-relaxed mb-6 max-w-[440px]">{t("landing.features.pages.body")}</p>
            <div className="mt-auto md:ml-16 md:-mr-7 md:-mb-7">
              <div className="rounded-[18px] md:rounded-r-none md:rounded-b-none bg-apple-bg border border-apple-line shadow-lift-md p-5 space-y-3">
                <div>
                  <div className="text-[14px] font-bold text-apple-ink">{t("landing.features.pages.mockHeading")}</div>
                  <div className="text-[12.5px] text-apple-ink-3 leading-relaxed">{t("landing.features.pages.mockText")}</div>
                </div>
                <div className="rounded-[12px] bg-white border border-apple-line overflow-hidden">
                  <div className="px-4 py-2.5 font-mono text-[12px] leading-[20px] whitespace-pre overflow-x-auto">
                    {["name = input(\"Your name? \")", "print(\"Hi,\", name)"].map((l, i) => (
                      <div key={i}>{highlight(l).map((tok, ti) => <span key={ti} style={{ color: tok.c }}>{tok.t}</span>)}</div>
                    ))}
                  </div>
                  <div className="border-t border-apple-line bg-apple-mist/40 px-4 py-1.5 font-mono text-[11.5px] text-apple-ink-2">
                    <span className="text-apple-ink-4">Your name? </span>Berry<br />Hi, Berry
                  </div>
                </div>
                <div className="text-[12.5px] text-apple-ink-3 leading-relaxed">{t("landing.features.pages.mockText2")}</div>
              </div>
            </div>
          </BentoTile>

          {/* Homework */}
          <BentoTile className="md:col-span-2" delay={0.05}>
            <TileHead icon={<CheckCircle2 size={14} />} tag={t("landing.features.homework.tag")} title={t("landing.features.homework.title")} tone="text-emerald-600" />
            <div className="mt-3 space-y-1.5 text-[11.5px] font-mono">
              {tests.map(r => (
                <div
                  key={r.name}
                  className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg border ${
                    r.state === "fail" ? "bg-rose-50 border-rose-100 text-rose-700" : "bg-emerald-50 border-emerald-100 text-emerald-700"
                  }`}
                >
                  {r.state === "fail" ? <XCircle size={12} className="shrink-0" /> : r.state === "hidden" ? <EyeOff size={12} className="shrink-0" /> : <CheckCircle2 size={12} className="shrink-0" />}
                  <span className={`truncate ${r.state === "hidden" ? "font-sans" : ""}`}>{r.name}</span>
                  {r.state === "fail" && <span className="ml-auto font-sans text-[10px] font-semibold shrink-0">ZeroDivisionError</span>}
                </div>
              ))}
            </div>
          </BentoTile>

          {/* Private */}
          <BentoTile className="md:col-span-2" delay={0.1}>
            <TileHead icon={<Lock size={14} />} tag={t("landing.features.private.tag")} title={t("landing.features.private.title")} tone="text-berry-purple" />
            <p className="text-[13px] text-apple-ink-3 leading-relaxed mb-4">{t("landing.features.private.body")}</p>
            <div className="flex items-center gap-2">
              <span className="w-7 h-7 rounded-full grid place-items-center text-[11px] font-bold text-white" style={{ background: "#9B7BFF" }}>B</span>
              <span className="flex-1 h-px border-t border-dashed border-berry-purple/40" />
              <span className="w-8 h-8 rounded-full grid place-items-center bg-berry-purple-soft text-berry-purple"><Lock size={14} /></span>
              <span className="flex-1 h-px border-t border-dashed border-berry-purple/40" />
              <span className="w-7 h-7 rounded-full grid place-items-center text-[11px] font-bold text-white" style={{ background: "#5B7FFF" }}>T</span>
            </div>
          </BentoTile>

          {/* Whiteboard */}
          <BentoTile className="md:col-span-2" delay={0.15}>
            <TileHead icon={<PenLine size={14} />} tag={t("landing.features.drawing.tag")} title={t("landing.features.drawing.title")} tone="text-berry-coral" />
            <div className="relative mt-3 rounded-xl border border-apple-line bg-apple-mist/30 h-[104px] overflow-hidden">
              <svg className="absolute inset-0 w-full h-full" viewBox="0 0 220 104">
                <rect x="14" y="30" width="62" height="40" rx="8" fill="none" stroke="#5B7FFF" strokeWidth="2" />
                <text x="45" y="55" textAnchor="middle" fontSize="12" fontFamily="ui-monospace, monospace" fill="#1F2937">x = 5</text>
                <motion.path
                  d="M 82 50 L 136 50" stroke="#9B7BFF" strokeWidth="2" fill="none" strokeLinecap="round"
                  initial={{ pathLength: 0 }} whileInView={{ pathLength: 1 }} viewport={{ once: false }}
                  transition={{ duration: 0.9, ease: "easeInOut", repeat: Infinity, repeatDelay: 1.6 }}
                />
                <path d="M 130 44 L 138 50 L 130 56" stroke="#9B7BFF" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                <ellipse cx="176" cy="50" rx="32" ry="22" fill="none" stroke="#F97316" strokeWidth="2" />
                <text x="176" y="55" textAnchor="middle" fontSize="12" fontFamily="ui-monospace, monospace" fill="#1F2937">x * 2</text>
              </svg>
            </div>
            <p className="text-[12px] text-apple-ink-3 mt-2 leading-snug">{t("landing.features.drawing.body")}</p>
          </BentoTile>

          {/* Schedule */}
          <BentoTile className="md:col-span-2" delay={0.2}>
            <TileHead icon={<CalendarDays size={14} />} tag={t("landing.features.schedule.tag")} title={t("landing.features.schedule.title")} tone="text-berry-blue" />
            <div className="mt-3 flex gap-1">
              {DAYS.map(d => {
                const on = d === "tue" || d === "thu";
                return (
                  <span
                    key={d}
                    className={`flex-1 h-9 rounded-lg grid place-items-center text-[11px] font-semibold border ${
                      on ? "bg-apple-ink text-white border-apple-ink" : "bg-apple-mist/60 text-apple-ink-4 border-apple-line"
                    }`}
                  >
                    {t(`landing.features.schedule.days.${d}`)}
                  </span>
                );
              })}
            </div>
            <div className="mt-3 flex items-center gap-2 text-[12px] text-apple-ink-3">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              {t("landing.features.schedule.next")}
            </div>
          </BentoTile>

          {/* Runs in the browser */}
          <BentoTile className="md:col-span-2" delay={0.25}>
            <TileHead icon={<Terminal size={14} />} tag={t("landing.features.browser.tag")} title={t("landing.features.browser.title")} tone="text-apple-ink-3" />
            <div className="mt-3 rounded-xl bg-apple-ink p-3 font-mono text-[11px]">
              <div className="text-zinc-400">Python 3 · {t("landing.features.browser.where")}</div>
              <div className="text-emerald-400 mt-1">&gt;&gt;&gt; sum(range(101))</div>
              <div className="text-zinc-200">5050</div>
            </div>
            <p className="text-[12px] text-apple-ink-3 mt-2 leading-snug">{t("landing.features.browser.body")}</p>
          </BentoTile>

          {/* XP & streaks */}
          <BentoTile className="md:col-span-4" delay={0.28}>
            <div className="flex items-center justify-between mb-3 gap-4">
              <div>
                <div className="flex items-center gap-2 text-[12px] font-semibold text-berry-amber uppercase tracking-wider mb-1">
                  <Activity size={14} /> {t("landing.features.streaks.tag")}
                </div>
                <h3 className="text-[20px] font-[800] tracking-[-0.02em] text-apple-ink">{t("landing.features.streaks.title")}</h3>
              </div>
              <div className="text-right shrink-0">
                <div className="text-[12px] font-bold text-apple-ink">Lv 3 · Coder</div>
                <div className="text-[11px] text-apple-ink-4">720 / 1500 XP</div>
              </div>
            </div>
            <div className="h-1.5 rounded-full bg-apple-mist overflow-hidden mb-4">
              <motion.div
                className="h-full rounded-full bg-gradient-to-r from-berry-blue to-berry-purple"
                initial={{ width: "0%" }}
                whileInView={{ width: "48%" }}
                viewport={{ once: true }}
                transition={{ duration: 1.1, ease: [0.25, 0.46, 0.45, 0.94], delay: 0.2 }}
              />
            </div>
            <div className="flex gap-[3px] overflow-hidden">
              {Array.from({ length: 16 }).map((_, w) => (
                <div key={w} className="flex flex-col gap-[3px]">
                  {Array.from({ length: 7 }).map((_, d) => {
                    const r = Math.abs(Math.sin((w + 1) * (d + 2) * 13.7));
                    const lvl = w > 10 ? Math.floor(r * 4) : Math.floor(r * 3);
                    const palette = ["bg-apple-mist", "bg-berry-blue-soft", "bg-berry-blue/40", "bg-berry-blue"];
                    return (
                      <motion.div
                        key={d}
                        className={`w-3 h-3 rounded-[3px] ${palette[lvl]}`}
                        initial={{ opacity: 0, scale: 0.4 }}
                        whileInView={{ opacity: 1, scale: 1 }}
                        viewport={{ once: true }}
                        transition={{ duration: 0.25, delay: (w * 7 + d) * 0.01 }}
                      />
                    );
                  })}
                </div>
              ))}
            </div>
          </BentoTile>

          {/* Saved */}
          <BentoTile className="md:col-span-2" delay={0.3}>
            <TileHead icon={<CloudUpload size={14} />} tag={t("landing.features.saved.tag")} title={t("landing.features.saved.title")} tone="text-emerald-600" />
            <p className="text-[13px] text-apple-ink-3 leading-relaxed mb-4">{t("landing.features.saved.body")}</p>
            <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-100">
              <Check size={11} strokeWidth={3} /> {t("landing.features.saved.pill")}
            </span>
          </BentoTile>
        </div>
      </div>
    </section>
  );
};

// ── How it works ───────────────────────────────────────────────────────
const Steps: React.FC = () => {
  const { t } = useTranslation();
  const steps = [
    { n: "01", key: "step1", mascot: strawieTeaching, cls: "w-16 h-16 object-contain" },
    { n: "02", key: "step2", mascot: raspieSliding, cls: "h-16 w-auto max-w-[7rem] object-contain object-left" },
    { n: "03", key: "step3", mascot: berryAsking, cls: "w-16 h-16 object-contain" },
    { n: "04", key: "step4", mascot: berryBuildSuccess, cls: "w-16 h-16 object-contain" },
  ];
  return (
    <section id="how" className="px-4 sm:px-6 py-20 sm:py-28 bg-apple-mist/40 scroll-mt-20">
      <div className="max-w-[1180px] mx-auto">
        <SectionHeader eyebrow={t("landing.steps.eyebrow")} title={t("landing.steps.title")} sub={t("landing.steps.subtitle")} />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {steps.map((s, i) => (
            <motion.div
              key={s.n}
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.4 }}
              transition={{ ...SPRING, delay: i * 0.06 }}
              className="rounded-[20px] bg-white border border-apple-line shadow-lift-sm p-6"
            >
              <img src={s.mascot} alt="" className={`${s.cls} drop-shadow-sm mb-3`} />
              <div className="font-mono text-[12px] font-semibold text-apple-ink-4 mb-3">{s.n}</div>
              <h3 className="text-[17px] font-[700] text-apple-ink mb-1.5 tracking-[-0.01em]">{t(`landing.steps.${s.key}Title`)}</h3>
              <p className="text-[13px] text-apple-ink-3 leading-[1.55]">{t(`landing.steps.${s.key}Desc`)}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
};

// ── Roles ──────────────────────────────────────────────────────────────
const Roles: React.FC<{ onCta: () => void }> = ({ onCta }) => {
  const { t } = useTranslation();
  const roles = [
    { key: "teacher", img: strawieTeaching, accent: "text-berry-blue" },
    { key: "student", img: berryFocused, accent: "text-berry-purple" },
  ] as const;
  return (
    <section className="px-4 sm:px-6 py-20 sm:py-28">
      <div className="max-w-[1180px] mx-auto">
        <SectionHeader eyebrow={t("landing.roles.eyebrow")} title={t("landing.roles.title")} />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {roles.map((r, i) => (
            <motion.div
              key={r.key}
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.3 }}
              transition={{ ...SPRING, delay: i * 0.1 }}
              className="relative rounded-[28px] bg-white border border-apple-line shadow-lift-md p-6 sm:p-8 overflow-hidden flex flex-col"
            >
              <div className="flex items-center gap-4 mb-6">
                <div className="w-20 h-20 flex items-end justify-center shrink-0">
                  <img src={r.img} alt="" className="w-full h-full object-contain drop-shadow-md" />
                </div>
                <div>
                  <div className={`text-[11px] font-semibold uppercase tracking-wider ${r.accent}`}>{t(`landing.roles.${r.key}Label`)}</div>
                  <h3 className="text-[24px] font-[800] tracking-[-0.02em] text-apple-ink">{t(`landing.roles.${r.key}Heading`)}</h3>
                </div>
              </div>
              <ul className="space-y-3 flex-1">
                {[1, 2, 3, 4, 5].map(n => (
                  <li key={n} className="flex items-start gap-3 text-[14px] text-apple-ink-2">
                    <CheckCircle2 size={16} className={`mt-0.5 shrink-0 ${r.accent}`} strokeWidth={2.2} />
                    {t(`landing.roles.${r.key}Bullet${n}`)}
                  </li>
                ))}
              </ul>
              <button
                onClick={onCta}
                className="group mt-7 w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-full bg-apple-ink text-white text-[13px] font-semibold
                           shadow-lift-sm hover:shadow-lift-md hover:bg-apple-ink-2 hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98]
                           focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-apple-ink/25 focus-visible:ring-offset-2 transition-all duration-200 ease-out"
              >
                {t(`landing.roles.${r.key}Button`)}
                <ArrowRight size={14} strokeWidth={2.5} className="transition-transform duration-200 group-hover:translate-x-0.5" />
              </button>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
};

// ── Safe by design ─────────────────────────────────────────────────────
const Trust: React.FC = () => {
  const { t } = useTranslation();
  const items = [
    { key: "noServer", icon: <ShieldCheck size={18} /> },
    { key: "private", icon: <Lock size={18} /> },
    { key: "noAds", icon: <EyeOff size={18} /> },
    { key: "google", icon: <UserRound size={18} /> },
  ];
  return (
    <section className="px-4 sm:px-6 py-20 sm:py-24 bg-apple-mist/40">
      <div className="max-w-[1180px] mx-auto">
        <SectionHeader eyebrow={t("landing.trust.eyebrow")} title={t("landing.trust.title")} sub={t("landing.trust.subtitle")} />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {items.map((it, i) => (
            <motion.div
              key={it.key}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.4 }}
              transition={{ ...SPRING, delay: i * 0.05 }}
              className="rounded-[20px] bg-white border border-apple-line shadow-lift-sm p-6"
            >
              <span className="w-10 h-10 rounded-xl grid place-items-center bg-apple-mist text-apple-ink-2 mb-4">{it.icon}</span>
              <h3 className="text-[16px] font-[700] text-apple-ink mb-1.5 tracking-[-0.01em]">{t(`landing.trust.${it.key}Title`)}</h3>
              <p className="text-[13px] text-apple-ink-3 leading-[1.55]">{t(`landing.trust.${it.key}Body`)}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
};

// ── FAQ ────────────────────────────────────────────────────────────────
const FAQ_KEYS = ["install", "accounts", "who", "python", "own", "languages"] as const;

const Faq: React.FC = () => {
  const { t } = useTranslation();
  const [open, setOpen] = useState<string | null>(FAQ_KEYS[0]);
  return (
    <section id="faq" className="px-4 sm:px-6 py-20 sm:py-28 scroll-mt-20">
      <div className="max-w-[760px] mx-auto">
        <SectionHeader eyebrow={t("landing.faq.eyebrow")} title={t("landing.faq.title")} />
        <div className="rounded-[24px] bg-white border border-apple-line shadow-lift-sm divide-y divide-apple-line overflow-hidden">
          {FAQ_KEYS.map(k => {
            const isOpen = open === k;
            return (
              <div key={k}>
                <button
                  onClick={() => setOpen(isOpen ? null : k)}
                  aria-expanded={isOpen}
                  className="w-full flex items-center justify-between gap-4 px-5 sm:px-6 py-4 text-left text-[15px] font-semibold text-apple-ink hover:bg-apple-mist/40 transition-colors"
                >
                  {t(`landing.faq.${k}Q`)}
                  <ChevronDown size={16} className={`shrink-0 text-apple-ink-4 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`} />
                </button>
                <AnimatePresence initial={false}>
                  {isOpen && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.22 }}
                      className="overflow-hidden"
                    >
                      <p className="px-5 sm:px-6 pb-5 -mt-1 text-[14px] text-apple-ink-3 leading-[1.6]">{t(`landing.faq.${k}A`)}</p>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
};

// ── CTA ────────────────────────────────────────────────────────────────
const CTA: React.FC<{ onCta: () => void }> = ({ onCta }) => {
  const { t } = useTranslation();
  return (
    <section className="px-4 sm:px-6 pb-24 sm:pb-32 pt-4">
      <div className="max-w-[920px] mx-auto">
        <div className="relative rounded-[32px] bg-white border border-apple-line shadow-lift-xl px-6 py-12 sm:p-12 text-center overflow-hidden">
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
            <h2 className="text-[clamp(30px,4vw,52px)] leading-[1.05] tracking-[-0.03em] font-[800] text-apple-ink">{t("landing.cta.title")}</h2>
            <p className="mt-4 text-[16px] text-apple-ink-3 max-w-[480px] mx-auto">{t("landing.cta.subtitle")}</p>
            <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
              <button onClick={onCta} className={ctaPrimary}>
                {t("landing.cta.button")}
                <ArrowRight size={16} strokeWidth={2.5} className="transition-transform duration-200 group-hover:translate-x-0.5" />
              </button>
              <a href="/demo" className={ctaSecondary}>
                <Play size={13} fill="currentColor" />
                {t("landing.cta.demo")}
              </a>
            </div>
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
  const link = "hover:text-apple-ink transition-colors";
  return (
    <>
      <footer className="px-4 sm:px-6 py-10 border-t border-apple-line bg-white">
        <div className="max-w-[1180px] mx-auto flex flex-col sm:flex-row items-center justify-between gap-5">
          <div className="flex items-center gap-3">
            <StrawieLogoSvg size={24} />
            <div className="sm:hidden"><LanguageSwitcher variant="light" /></div>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-[12px] text-apple-ink-4">
            <a href="/demo" className={link}>{t("landing.footer.demo")}</a>
            <button onClick={() => setShowTerms(true)} className={link}>{t("landing.footer.terms")}</button>
            <button onClick={() => setShowPrivacy(true)} className={link}>{t("landing.footer.privacy")}</button>
            <a href={`mailto:${CONTACT_EMAIL}`} className={`${link} inline-flex items-center gap-1`}>
              <Mail size={12} /> {t("landing.footer.contact")}
            </a>
            <span>{t("landing.footer.copyright", { year: new Date().getFullYear() })}</span>
          </div>
        </div>
      </footer>
      {showTerms && <TermsModal onClose={() => setShowTerms(false)} />}
      {showPrivacy && <PrivacyModal onClose={() => setShowPrivacy(false)} />}
    </>
  );
};

// ── Page ───────────────────────────────────────────────────────────────
export const LandingPage: React.FC = () => {
  const navigate = useNavigate();
  const [showBrowserModal, setShowBrowserModal] = useState(false);

  useEffect(() => {
    // `?preview` keeps us on the marketing page even when logged in, so the
    // landing can be reviewed without logging out.
    if (new URLSearchParams(window.location.search).has("preview")) return;
    // Cookie auth: 401 from /me means not logged in, so stay here.
    getMe()
      .then(() => navigate("/app", { replace: true }))
      .catch(() => {});
  }, [navigate]);

  const handleSignIn = isInAppBrowser() ? () => setShowBrowserModal(true) : googleLogin;

  return (
    <div
      data-theme="light"
      className="min-h-screen bg-apple-bg text-apple-ink antialiased overflow-x-clip"
      style={{ background: "radial-gradient(1200px 800px at 50% -200px, #FFFFFF 0%, #FAFAF7 60%, #FAFAF7 100%)" }}
    >
      {showBrowserModal && <OpenInBrowserModal onClose={() => setShowBrowserModal(false)} />}
      <Nav onSignIn={handleSignIn} />
      <Hero onCta={handleSignIn} />
      <TogetherSolo />
      <Bento />
      <Steps />
      <Roles onCta={handleSignIn} />
      <Trust />
      <Faq />
      <CTA onCta={handleSignIn} />
      <Footer />
    </div>
  );
};
