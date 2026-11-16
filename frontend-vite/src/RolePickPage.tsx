import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowRight } from "lucide-react";
import { chooseRole, getMe } from "./lib/api";
import { StrawieLogoSvg } from "./components/Logo";
import strawieTeaching from "./assets/mascots/characters/strawie-teaching.png";
import berryFocused from "./assets/mascots/characters/berry-focused.png";

/**
 * First-time role selection screen.
 *
 * Routing logic:
 *   * If the user isn't logged in (401 from /me), go to landing.
 *   * If the user is already role-locked, skip straight to /app.
 *   * Otherwise show two cards: Teacher vs Student. Choice is final.
 */
export const RolePickPage: React.FC = () => {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [name, setName] = useState<string>("");
  const [submitting, setSubmitting] = useState<"teacher" | "student" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    getMe()
      .then((me) => {
        if (me?.role_locked) {
          navigate("/app", { replace: true });
          return;
        }
        setName(me?.name ?? "");
        setReady(true);
      })
      .catch(() => navigate("/", { replace: true }));
  }, [navigate]);

  const pick = async (role: "teacher" | "student") => {
    setSubmitting(role);
    setError(null);
    try {
      await chooseRole(role);
      navigate("/app", { replace: true });
    } catch {
      setError(t("auth.rolePick.error"));
      setSubmitting(null);
    }
  };

  if (!ready) {
    return (
      <div className="min-h-screen bg-apple-bg flex items-center justify-center">
        <span className="h-5 w-5 rounded-full border-2 border-apple-ink border-t-transparent animate-spin" />
      </div>
    );
  }

  // Same visual language as the landing page: warm canvas, white floating
  // cards, ink CTA, mascots doing the explaining.
  const cards = [
    { role: "teacher" as const, title: t("auth.rolePick.teacherTitle"), desc: t("auth.rolePick.teacherDesc"), img: strawieTeaching, tint: "bg-berry-blue-soft" },
    { role: "student" as const, title: t("auth.rolePick.studentTitle"), desc: t("auth.rolePick.studentDesc"), img: berryFocused, tint: "bg-berry-purple-soft" },
  ];

  return (
    <div className="relative min-h-screen bg-apple-bg text-apple-ink flex flex-col items-center justify-center px-6 py-16 overflow-hidden">
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute top-10 left-1/2 -translate-x-1/2 w-[900px] h-[480px] bg-berry-blue-soft/50 blur-[120px] rounded-full" />
        <div className="absolute bottom-0 right-[-10%] w-[480px] h-[480px] bg-berry-purple-soft/50 blur-[120px] rounded-full" />
      </div>

      <div className="relative mb-8"><StrawieLogoSvg size={30} /></div>

      <div className="relative max-w-2xl w-full text-center mb-12 st-fade-up">
        <h1 className="text-4xl sm:text-5xl font-bold tracking-tight mb-4">
          {name ? t("auth.rolePick.welcomeNamed", { name }) : t("auth.rolePick.welcome")}
        </h1>
        <p className="text-apple-ink-3 text-lg">
          {t("auth.rolePick.subtitle")}
        </p>
      </div>

      <div className="relative grid gap-5 sm:grid-cols-2 w-full max-w-3xl">
        {cards.map((c, i) => (
          <button
            key={c.role}
            onClick={() => pick(c.role)}
            disabled={submitting !== null}
            style={{ animationDelay: `${80 + i * 80}ms` }}
            className="st-fade-up group relative text-left p-7 rounded-[28px] bg-white border border-apple-line shadow-lift-md
                       hover:shadow-lift-xl hover:-translate-y-1 active:translate-y-0 active:scale-[0.99]
                       transition-all duration-300 ease-out disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:translate-y-0"
          >
            <div className={`mb-5 h-28 rounded-[20px] ${c.tint} grid place-items-center overflow-hidden`}>
              <img src={c.img} alt="" className="h-24 w-auto object-contain transition-transform duration-300 group-hover:scale-105 group-hover:-rotate-2" />
            </div>
            <div className="text-xl font-semibold mb-1.5">{c.title}</div>
            <div className="text-[14px] leading-relaxed text-apple-ink-3 mb-5">{c.desc}</div>
            <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-apple-ink">
              {submitting === c.role ? t("auth.rolePick.settingUp") : (
                <>
                  {c.title}
                  <ArrowRight size={14} strokeWidth={2.5} className="transition-transform duration-200 group-hover:translate-x-1" />
                </>
              )}
            </span>
          </button>
        ))}
      </div>

      {error && (
        <div className="relative mt-6 text-sm text-rose-600">{error}</div>
      )}

      <div className="relative mt-10 text-xs text-apple-ink-4 max-w-xl text-center">
        {t("auth.rolePick.footnote")}
      </div>
    </div>
  );
};
