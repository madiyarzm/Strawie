import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import i18n from "./i18n";
import { CodeEditor } from "./components/CodeEditor";
import type { PeerInfo } from "./hooks/useCollab";
import { DrawingCanvas } from "./components/DrawingCanvas";
import { SimpleInputModal } from "./components/SimpleInputModal";
import {
  addSubmissionFeedback,
  createAssignment,
  createClassroom,
  createGroup,
  createSubmission,
  deleteClassroom,
  deleteGroup,
  getHint,
  getMe,
  getMyActivity,
  getClassroomActiveCounts,
  getMyCosmetics,
  getMyStats,
  joinGroup,
  leaveGroup,
  listAllUsers,
  listAssignments,
  listClassrooms,
  listGroupMembers,
  listGroups,
  listSubmissions,
  logout,
  updateMyCosmetics,
  updateUserRole,
  getAdminStats,
  toggleUserBan,
  getFlaggedSubmissions,
  getAdminInviteCodes,
  revokeInviteCode,
  getAdminGroups,
} from "./lib/api";
import { Play, Square, X, Users, Shield, LifeBuoy, Home, LogOut, Trophy, Flame, Gem, Zap, PenLine, Crown, Star, Trash2, ChevronLeft, ChevronRight, Search, Ban, AlertTriangle, Eye, Key, BarChart3, FolderOpen, Clock, Sun, Moon, Inbox, ArrowLeft, Plus, LogIn, PanelLeftClose, PanelLeftOpen, ChevronsUpDown, Code2, Lightbulb, Check, TerminalSquare, Eraser } from "lucide-react";
import { Confetti } from "./components/Confetti";
import {
  onPyodideProgress,
  runForSubmission,
  startRun,
  warmupPyodide,
} from "./lib/pyodideRunner";
import type { RunHandle } from "./lib/pyodideRunner";
import { ChalkLogo } from "./components/Logo";
import { SUPPORTED_LANGUAGES } from "./i18n";
import { GroupScreen, GroupSheet, HomeScreen } from "./lessons/HomeScreens";
import type { Nav as LessonNav } from "./lessons/HomeScreens";
import { HomeworkScreen, LessonScreen, ReviewScreen } from "./lessons/LessonScreens";
import type { Group as LessonGroup } from "./lessons/api";
import { Avatar } from "./components/Avatar";
import { Badge } from "./components/Badge";
import { ActivityGraph } from "./components/ActivityGraph";

// ─── Deadline utilities ────────────────────────────────────────────────────

type DeadlineUrgency = "none" | "green" | "yellow" | "orange" | "red" | "overdue";

function getDeadlineUrgency(dueAt: string | null): DeadlineUrgency {
  if (!dueAt) return "none";
  const diff = new Date(dueAt).getTime() - Date.now();
  if (diff < 0) return "overdue";
  const hours = diff / 3_600_000;
  if (hours < 24) return "red";
  const days = hours / 24;
  if (days < 3) return "orange";
  if (days < 7) return "yellow";
  return "green";
}

function formatDueDate(dueAt: string): string {
  return new Date(dueAt).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatTimeRemaining(dueAt: string): string {
  const diff = new Date(dueAt).getTime() - Date.now();
  if (diff <= 0) return i18n.t("app.deadline.overdueShort");
  const hours = Math.floor(diff / 3_600_000);
  if (hours < 24) return i18n.t("app.deadline.hoursRemaining", { count: hours });
  const days = Math.floor(hours / 24);
  return i18n.t("app.deadline.daysRemaining", { count: days });
}

function isSubmittedLate(submittedAt: string, dueAt: string | null): boolean {
  if (!dueAt) return false;
  return new Date(submittedAt) > new Date(dueAt);
}

// ─── DeadlineBadge ─────────────────────────────────────────────────────────

const URGENCY_STYLES: Record<DeadlineUrgency, { bg: string; color: string }> = {
  none:    { bg: "var(--bg-3)", color: "var(--muted)" },
  green:   { bg: "var(--mint-muted)", color: "var(--mint)" },
  yellow:  { bg: "var(--amber-muted)", color: "var(--amber)" },
  orange:  { bg: "var(--amber-muted)", color: "var(--amber)" },
  red:     { bg: "var(--rose-muted)", color: "var(--rose)" },
  overdue: { bg: "var(--rose-muted)", color: "var(--rose)" },
};

const DeadlineBadge: React.FC<{ dueAt: string; className?: string }> = ({ dueAt, className = "" }) => {
  const { t } = useTranslation();
  const urgency = getDeadlineUrgency(dueAt);
  const s = URGENCY_STYLES[urgency];
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 text-[11px] rounded-full font-mono font-medium ${className}`}
      style={{ background: s.bg, color: s.color }}
    >
      {urgency === "overdue" ? t("app.deadline.overdue") : t("app.deadline.due", { date: formatDueDate(dueAt) })}
    </span>
  );
};

// ─── CreateAssignmentModal ──────────────────────────────────────────────────

interface CreateAssignmentModalData {
  title: string;
  description: string;
  templateCode: string;
  testCode: string | null;
  dueAt: string | null;
}

interface CreateAssignmentModalProps {
  onConfirm: (data: CreateAssignmentModalData) => void;
  onCancel: () => void;
}

const CreateAssignmentModal: React.FC<CreateAssignmentModalProps> = ({ onConfirm, onCancel }) => {
  const { t } = useTranslation();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [templateCode, setTemplateCode] = useState("# Write your solution here\n\n");
  const [isHomework, setIsHomework] = useState(false);
  const [dueDate, setDueDate] = useState("");
  const [dueTime, setDueTime] = useState("23:59");
  const [showTestCode, setShowTestCode] = useState(false);
  const [testCode, setTestCode] = useState("# assert your_function() == expected_output\n");
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    titleRef.current?.focus();
    const handleKey = (e: KeyboardEvent) => { if (e.key === "Escape") onCancel(); };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onCancel]);

  const dueAt = isHomework && dueDate
    ? new Date(`${dueDate}T${dueTime}`).toISOString()
    : null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    onConfirm({ title: title.trim(), description, templateCode, testCode: showTestCode ? testCode : null, dueAt });
  };

  return (
    <div className="st-backdrop fixed inset-0 z-50 flex items-center justify-center p-4" onMouseDown={e => { if (e.target === e.currentTarget) onCancel(); }}>
      <div
        className="st-pop-in w-full max-w-lg rounded-[22px] max-h-[90vh] overflow-y-auto"
        style={{ background: "var(--bg)", border: "1px solid var(--border)", boxShadow: "var(--shadow-lg)" }}
      >
        <div className="flex items-center justify-between px-6 pt-5 pb-3">
          <h2 className="text-[17px] font-semibold" style={{ letterSpacing: "-0.01em" }}>{t("app.createAssignment.title")}</h2>
          <button type="button" onClick={onCancel} className="st-icon-btn">
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 pb-6 pt-1 space-y-4">
          <div className="space-y-1.5">
            <label className="block text-xs font-medium" style={{ color: "var(--muted)" }}>{t("app.createAssignment.type")}</label>
            <div className="grid grid-cols-2 gap-2">
              {[
                { hw: false, emoji: "💻", title: t("app.createAssignment.exerciseTitle"), desc: t("app.createAssignment.exerciseDesc"), accent: "var(--indigo)" },
                { hw: true, emoji: "📋", title: t("app.createAssignment.homeworkTitle"), desc: t("app.createAssignment.homeworkDesc"), accent: "var(--mint)" },
              ].map(opt => (
                <button
                  key={String(opt.hw)}
                  type="button"
                  onClick={() => setIsHomework(opt.hw)}
                  className="flex flex-col items-start gap-1 px-3.5 py-3 rounded-[14px] border text-left transition-all"
                  style={{
                    borderColor: isHomework === opt.hw ? "var(--text)" : "var(--border)",
                    background: isHomework === opt.hw ? "var(--bg)" : "var(--bg-2)",
                    boxShadow: isHomework === opt.hw ? "var(--shadow-md)" : "none",
                  }}
                >
                  <span className="text-lg leading-none">{opt.emoji}</span>
                  <span className="text-[13px] font-semibold" style={{ color: "var(--text)" }}>{opt.title}</span>
                  <span className="text-[10px] leading-snug" style={{ color: "var(--subtle)" }}>{opt.desc}</span>
                </button>
              ))}
            </div>
          </div>

          {isHomework && (
            <div className="flex items-center gap-2 p-3 rounded-[14px]" style={{ background: "var(--bg-2)", border: "1px solid var(--border)" }}>
              <span className="text-xs font-medium shrink-0" style={{ color: "var(--text-2)" }}>{t("app.createAssignment.due")}</span>
              <input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="st-input flex-1 rounded-[10px] px-2 py-1.5 text-xs"
              />
              <input
                type="time"
                value={dueTime}
                onChange={(e) => setDueTime(e.target.value)}
                className="st-input w-24 rounded-[10px] px-2 py-1.5 text-xs"
              />
            </div>
          )}

          <div className="space-y-1">
            <label className="block text-xs" style={{ color: "var(--muted)" }}>{t("app.createAssignment.titleLabel")} <span style={{ color: "var(--rose)" }}>*</span></label>
            <input
              ref={titleRef}
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t("app.createAssignment.titlePlaceholder")}
              className="st-input w-full rounded-[12px] px-3 py-2 text-sm placeholder:opacity-40"
                            required
            />
          </div>

          <div className="space-y-1">
            <label className="block text-xs" style={{ color: "var(--muted)" }}>{t("app.createAssignment.instructions")}</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t("app.createAssignment.instructionsPlaceholder")}
              rows={3}
              className="st-input w-full rounded-[12px] px-3 py-2 text-sm placeholder:opacity-40 resize-none"
                          />
          </div>

          <div className="space-y-1">
            <label className="block text-xs" style={{ color: "var(--muted)" }}>{t("app.createAssignment.starterCode")}</label>
            <textarea
              value={templateCode}
              onChange={(e) => setTemplateCode(e.target.value)}
              rows={5}
              className="st-input w-full rounded-[12px] px-3 py-2 text-xs font-mono resize-none"
                          />
          </div>

          <div
            className="space-y-2 rounded-[10px] p-3"
            style={{ background: "var(--bg-3)", border: "1px solid var(--border)" }}
          >
            <div className="flex items-center justify-between">
              <div>
                <span className="text-xs font-medium">{t("app.createAssignment.autoGradingTests")}</span>
                <p className="text-[10px] mt-0.5" style={{ color: "var(--subtle)" }}>
                  {t("app.createAssignment.autoGradingDesc")}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowTestCode(v => !v)}
                className="relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors"
                style={{ background: showTestCode ? "var(--indigo)" : "var(--border-2)" }}
                role="switch"
                aria-checked={showTestCode}
              >
                <span
                  className="inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform"
                  style={{ transform: showTestCode ? "translateX(18px)" : "translateX(2px)" }}
                />
              </button>
            </div>
            {showTestCode && (
              <textarea
                value={testCode}
                onChange={(e) => setTestCode(e.target.value)}
                rows={4}
                placeholder="# assert my_function(2) == 4"
                className="st-input w-full rounded-[12px] px-3 py-2 text-xs font-mono placeholder:opacity-40 resize-none"
                              />
            )}
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onCancel} className="st-btn st-btn-ghost">
              {t("common.cancel")}
            </button>
            <button
              type="submit"
              disabled={!title.trim() || (isHomework && !dueDate)}
              className="st-btn st-btn-primary"
            >
              {isHomework ? t("app.createAssignment.createHomework") : t("app.createAssignment.createExercise")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};


// ─── XP Bar ────────────────────────────────────────────────────────────────

function xpLevel(xp: number): { level: number; title: string; next: number; prev: number } {
  const thresholds = [
    { level: 1, title: "Novice", xp: 0 },
    { level: 2, title: "Apprentice", xp: 300 },
    { level: 3, title: "Coder", xp: 700 },
    { level: 4, title: "Hacker", xp: 1500 },
    { level: 5, title: "Expert", xp: 3000 },
    { level: 6, title: "Master", xp: 5500 },
    { level: 7, title: "Legend", xp: 10000 },
  ];
  let current = thresholds[0];
  let next = thresholds[1];
  for (let i = 0; i < thresholds.length - 1; i++) {
    if (xp >= thresholds[i].xp && xp < thresholds[i + 1].xp) {
      current = thresholds[i];
      next = thresholds[i + 1];
      break;
    }
    if (xp >= thresholds[thresholds.length - 1].xp) {
      current = thresholds[thresholds.length - 1];
      next = thresholds[thresholds.length - 1];
    }
  }
  return { level: current.level, title: current.title, next: next.xp, prev: current.xp };
}


// ─── App types ─────────────────────────────────────────────────────────────

type View = "home" | "group" | "lesson" | "homework" | "review" | "dashboard" | "classroom" | "assignment" | "submissions" | "workspace";

// Synthetic assignment id for a student's personal scratchpad. It is never
// persisted — the workspace has no classroom, no collab room, no submissions.
const WORKSPACE_ID = "__workspace__";

type EditorFile = {
  id: string;
  name: string;
  content: string;
};

// Shared empty-state block: a soft icon chip, a one-line title, an optional
// hint, and an optional action — so "nothing here yet" reads as intentional.
const EmptyState: React.FC<{
  icon: React.ReactNode;
  title: string;
  hint?: string;
  action?: React.ReactNode;
}> = ({ icon, title, hint, action }) => (
  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, textAlign: "center", padding: "40px 20px" }}>
    <div style={{ display: "grid", placeItems: "center", width: 42, height: 42, borderRadius: 12, background: "var(--bg-2)", border: "1px solid var(--border)", color: "var(--subtle)" }}>
      {icon}
    </div>
    <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-2)" }}>{title}</div>
    {hint && <div style={{ fontSize: 12, color: "var(--text-3)", maxWidth: 260, lineHeight: 1.5 }}>{hint}</div>}
    {action && <div style={{ marginTop: 4 }}>{action}</div>}
  </div>
);


// ─── UserMenu ────────────────────────────────────────────────────────────────
// Account row at the bottom of the sidebar. Language, appearance, admin
// tools and logout live behind it instead of permanently taking up space.

interface UserMenuProps {
  user: any;
  role: "teacher" | "student";
  collapsed: boolean;
  isAdmin: boolean;
  theme: "light" | "dark";
  onThemeChange: (t: "light" | "dark") => void;
  onViewAs: (r: "teacher" | "student") => void;
  onOpenAdmin: () => void;
  onLogout: () => void;
}

const UserMenu: React.FC<UserMenuProps> = ({ user, role, collapsed, isAdmin, theme, onThemeChange, onViewAs, onOpenAdmin, onLogout }) => {
  const { t, i18n: i18nInst } = useTranslation();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const lang = i18nInst.language?.split("-")[0] ?? "en";

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!rootRef.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  return (
    <div ref={rootRef} style={{ position: "relative" }}>
      {open && (
        <div
          className="st-menu"
          role="menu"
          style={{ position: "absolute", bottom: "calc(100% + 8px)", left: 0, width: 248, zIndex: 60 }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px 10px" }}>
            <Avatar name={user?.name || user?.email || "?"} size={32} pulse={false} />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{user?.name}</div>
              <div style={{ fontSize: 12, color: "var(--text-3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{user?.email}</div>
            </div>
          </div>
          <div className="st-menu-sep" />

          <div className="st-menu-label">{t("app.menu.language")}</div>
          <div style={{ padding: "0 6px 6px" }}>
            <div className="st-seg" style={{ width: "100%" }}>
              {SUPPORTED_LANGUAGES.map(l => (
                <button key={l.code} type="button" aria-pressed={lang === l.code} onClick={() => void i18nInst.changeLanguage(l.code)} style={{ flex: 1, justifyContent: "center" }} title={l.name}>
                  {l.label}
                </button>
              ))}
            </div>
          </div>

          <div className="st-menu-label">{t("app.menu.appearance")}</div>
          <div style={{ padding: "0 6px 6px" }}>
            <div className="st-seg" style={{ width: "100%" }}>
              {(["light", "dark"] as const).map(m => (
                <button key={m} type="button" aria-pressed={theme === m} onClick={() => onThemeChange(m)} style={{ flex: 1, justifyContent: "center" }}>
                  {m === "light" ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
                  {t(`app.menu.${m}`)}
                </button>
              ))}
            </div>
          </div>

          {isAdmin && (
            <>
              <div className="st-menu-label">{t("app.sidebar.viewAs")}</div>
              <div style={{ padding: "0 6px 6px" }}>
                <div className="st-seg" style={{ width: "100%" }}>
                  {(["teacher", "student"] as const).map(r => (
                    <button key={r} type="button" aria-pressed={role === r} onClick={() => onViewAs(r)} style={{ flex: 1, justifyContent: "center" }}>
                      {t(`common.${r}`)}
                    </button>
                  ))}
                </div>
              </div>
              <button type="button" className="st-menu-item" onClick={() => { setOpen(false); onOpenAdmin(); }}>
                <Shield className="h-4 w-4" style={{ color: "var(--text-3)" }} />
                {t("app.sidebar.users")}
              </button>
            </>
          )}

          <div className="st-menu-sep" />
          <button type="button" className="st-menu-item" onClick={onLogout}>
            <LogOut className="h-4 w-4" style={{ color: "var(--text-3)" }} />
            {t("app.sidebar.logout")}
          </button>
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={collapsed ? (user?.name || "") : undefined}
        className="sidebar-nav-item"
        data-active={open}
        data-disabled={false}
        style={{
          display: "flex", alignItems: "center", gap: 10, width: "100%",
          padding: collapsed ? "6px 0" : "6px 8px", justifyContent: collapsed ? "center" : "flex-start",
          borderRadius: 12, border: "none", cursor: "pointer", textAlign: "left",
          background: open ? "var(--bg-3)" : "transparent",
        }}
      >
        <Avatar name={user?.name || user?.email || "?"} size={30} pulse={false} />
        {!collapsed && (
          <>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{user?.name}</div>
              <div style={{ fontSize: 11.5, color: "var(--text-3)" }}>{t(`common.${role}`)}</div>
            </div>
            <ChevronsUpDown className="h-4 w-4" style={{ color: "var(--subtle)", flexShrink: 0 }} />
          </>
        )}
      </button>
    </div>
  );
};

export const MentorApp: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [authChecked, setAuthChecked] = useState(false);
  // Set when loading the app failed for a reason other than "not signed in".
  const [initError, setInitError] = useState<string | null>(null);
  const [view, setView] = useState<View>("home");
  // New schedule-driven screens (src/lessons).
  const [navGroupId, setNavGroupId] = useState<string | null>(null);
  const [navLessonId, setNavLessonId] = useState<string | null>(null);
  const [groupSheet, setGroupSheet] = useState<{ group: LessonGroup | null } | null>(null);
  const [groupRefresh, setGroupRefresh] = useState(0);
  const [user, setUser] = useState<any | null>(null);

  const [groups, setGroups] = useState<any[]>([]);
  const [expandedGroupId, setExpandedGroupId] = useState<string | null>(null);
  const [groupClassrooms, setGroupClassrooms] = useState<Record<string, any[]>>({});

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [currentClassroom, setCurrentClassroom] = useState<any | null>(null);
  const [assignments, setAssignments] = useState<any[]>([]);
  const [currentAssignment, setCurrentAssignment] = useState<any | null>(null);
  const [submissions, setSubmissions] = useState<any[]>([]);
  const [selectedSubmission, setSelectedSubmission] = useState<any | null>(null);
  const [files, setFiles] = useState<EditorFile[]>([]);
  const [activeFileId, setActiveFileId] = useState<string | null>(null);
  const [code, setCode] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [submissionsByAssignment, setSubmissionsByAssignment] = useState<Record<string, any[]>>({});
  const [groupMembers, setGroupMembers] = useState<any[]>([]);

  const [showCreateGroupModal, setShowCreateGroupModal] = useState(false);
  const [showJoinGroupModal, setShowJoinGroupModal] = useState(false);
  const [showCreateClassroomModal, setShowCreateClassroomModal] = useState<string | null>(null);
  const [showAddFileModal, setShowAddFileModal] = useState(false);

  const [showAdminPanel, setShowAdminPanel] = useState(false);
  const [adminTab, setAdminTab] = useState<"overview" | "users" | "groups" | "security">("overview");
  const [adminUsers, setAdminUsers] = useState<any[]>([]);
  const [adminLoading, setAdminLoading] = useState(false);
  const [adminStats, setAdminStats] = useState<any>(null);
  const [adminFlagged, setAdminFlagged] = useState<any[]>([]);
  const [adminInviteCodes, setAdminInviteCodes] = useState<any[]>([]);
  const [adminGroups, setAdminGroups] = useState<any[]>([]);
  const [adminSearch, setAdminSearch] = useState("");
  const [adminExpandedFlag, setAdminExpandedFlag] = useState<string | null>(null);

  const [xp, setXp] = useState<number | null>(null);
  const [activityDays, setActivityDays] = useState<{ date: string; count: number }[]>([]);
  const [showConfetti, setShowConfetti] = useState(false);
  const [cosmetics, setCosmeticsState] = useState<{ frame?: string; background?: string; aura?: string }>({});
  const [classroomActiveCounts, setClassroomActiveCounts] = useState<Record<string, number>>({});

  const refreshStats = async () => {
    try {
      const stats = await getMyStats();
      if (stats) setXp(stats.xp);
    } catch {
      /* ignore */
    }
  };

  const saveCosmetics = async (next: { frame?: string; background?: string; aura?: string }) => {
    setCosmeticsState(next);
    try {
      await updateMyCosmetics(next);
    } catch {
      /* swallow — keep local state */
    }
  };

  const [failedAttempts, setFailedAttempts] = useState(0);
  const [hint, setHint] = useState<string | null>(null);
  // Code a student typed before rooms were saved on the server lived only in
  // their browser (localStorage). Offer it once so nothing is lost; never
  // written into the shared file automatically.
  const [legacyDraft, setLegacyDraft] = useState<{ key: string; code: string } | null>(null);
  const [hintLoading, setHintLoading] = useState(false);

  const [viewAsRole, setViewAsRole] = useState<"teacher" | "student" | null>(null);
  // Light by default (matches the landing page); dark is an opt-in that
  // sticks across visits.
  const [theme, setTheme] = useState<"dark" | "light">(() => {
    try { return localStorage.getItem("strawie:theme") === "dark" ? "dark" : "light"; } catch { return "light"; }
  });

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    try { localStorage.setItem("strawie:theme", theme); } catch { /* storage disabled */ }
  }, [theme]);

  useEffect(() => {
    const init = async () => {
      // With cookie auth there's no client-side token to inspect; the only
      // way to know if we're logged in is to ask the server. A 401 from
      // getMe() means the cookie is missing/expired → bounce to landing.
      try {
        const me = await getMe();
        // If the user hasn't picked their role yet, force them through the
        // welcome screen first. Defense in depth — AuthCallback already
        // handles the fresh-login path, this catches users who type /app.
        if (me && me.role_locked === false) {
          navigate("/welcome/role", { replace: true });
          return;
        }
        setUser(me);
        const [grps, stats, activity, cos] = await Promise.all([
          listGroups(),
          getMyStats().catch(() => null),
          getMyActivity().catch(() => null),
          getMyCosmetics().catch(() => null),
        ]);
        setGroups(grps || []);
        if (stats) setXp(stats.xp);
        if (activity) setActivityDays(activity.days);
        if (cos && typeof cos === "object") setCosmeticsState(cos as any);
        if (grps && grps.length > 0) {
          const clsResults = await Promise.all(grps.map((g: any) => listClassrooms(g.id).catch(() => [])));
          const clsMap: Record<string, any[]> = {};
          grps.forEach((g: any, idx: number) => { clsMap[g.id] = clsResults[idx] || []; });
          setGroupClassrooms(clsMap);
        }
        // Arrived through an invite link (/join/<code>) before signing in.
        let pendingJoin: string | null = null;
        try { pendingJoin = sessionStorage.getItem("strawie:join"); sessionStorage.removeItem("strawie:join"); } catch { /* storage off */ }
        if (pendingJoin) {
          try {
            const joined = await joinGroup(pendingJoin);
            const fresh = await listGroups();
            setGroups(fresh || []);
            const gid = joined?.group_id ?? joined?.id;
            if (gid) { setNavGroupId(String(gid)); setView("group"); }
          } catch { /* invalid code: just land on home */ }
        }
        setAuthChecked(true);
      } catch (e) {
        // Only "not signed in" goes back to the landing page. Any other
        // failure (server error, network) shows an error with a retry,
        // otherwise landing (signed in → /app) and /app (error → landing)
        // would bounce between each other forever.
        if ((e as Error)?.message === "Unauthorized") {
          navigate("/", { replace: true });
        } else {
          setInitError((e as Error)?.message || "Request failed");
        }
      }
    };
    void init();
  }, [navigate]);

  useEffect(() => {
    if (!currentAssignment) return;
    const id = setInterval(async () => {
      try {
        const subs = await listSubmissions(currentAssignment.id);
        setSubmissions(subs || []);
        setSelectedSubmission((prev: any) =>
          prev ? (subs || []).find((s: any) => s.id === prev.id) ?? prev : null,
        );
      } catch { /* ignore polling errors */ }
    }, 5_000);
    return () => clearInterval(id);
  }, [currentAssignment]);

  useEffect(() => {
    if (!authChecked) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const counts = await getClassroomActiveCounts();
        if (!cancelled) setClassroomActiveCounts(counts || {});
      } catch { /* ignore */ }
    };
    void tick();
    const id = setInterval(tick, 10_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [authChecked]);

  const handleLogout = async () => {
    await logout();
    navigate("/", { replace: true });
  };
  const handleCreateGroup = () => setShowCreateGroupModal(true);

  const handleCreateGroupConfirm = async (name: string) => {
    setShowCreateGroupModal(false);
    setError(null);
    try {
      const grp = await createGroup(name, "");
      setGroups(prev => [...prev, grp]);
    } catch (e: any) { setError(e.message || t("app.errors.createGroup")); }
  };

  const handleJoinGroup = () => setShowJoinGroupModal(true);

  const handleJoinGroupConfirm = async (code: string) => {
    setShowJoinGroupModal(false);
    setError(null);
    try {
      await joinGroup(code);
      const grps = await listGroups();
      setGroups(grps || []);
    } catch (e: any) { setError(e.message || t("app.errors.joinGroup")); }
  };

  const toggleGroup = async (groupId: string) => {
    if (expandedGroupId === groupId) { setExpandedGroupId(null); return; }
    setExpandedGroupId(groupId);
    if (!groupClassrooms[groupId]) {
      try {
        const cls = await listClassrooms(groupId);
        setGroupClassrooms(prev => ({ ...prev, [groupId]: cls || [] }));
      } catch (e: any) { setError(e.message || t("app.errors.loadClassrooms")); }
    }
  };

  const handleCreateClassroom = (groupId: string) => setShowCreateClassroomModal(groupId);

  const handleCreateClassroomConfirm = async (name: string) => {
    const groupId = showCreateClassroomModal;
    setShowCreateClassroomModal(null);
    if (!groupId) return;
    setError(null);
    try {
      const cls = await createClassroom(groupId, name, "");
      setGroupClassrooms(prev => ({ ...prev, [groupId]: [...(prev[groupId] || []), cls] }));
    } catch (e: any) { setError(e.message || t("app.errors.createClassroom")); }
  };

  const handleDeleteGroup = async (groupId: string, groupName: string) => {
    if (!window.confirm(t("app.confirm.deleteGroup", { name: groupName }))) return;
    setError(null);
    try {
      await deleteGroup(groupId);
      setGroups(prev => prev.filter(g => g.id !== groupId));
      setGroupClassrooms(prev => { const next = { ...prev }; delete next[groupId]; return next; });
      if (currentClassroom?.group_id === groupId) { setCurrentClassroom(null); setView("dashboard"); }
    } catch (e: any) { setError(e.message || t("app.errors.deleteGroup")); }
  };

  const handleLeaveGroup = async (groupId: string, groupName: string) => {
    if (!window.confirm(t("app.confirm.leaveGroup", { name: groupName, defaultValue: `Leave "${groupName}"? You'll lose access to its classrooms.` }))) return;
    setError(null);
    try {
      await leaveGroup(groupId);
      setGroups(prev => prev.filter(g => g.id !== groupId));
      setGroupClassrooms(prev => { const next = { ...prev }; delete next[groupId]; return next; });
      if (currentClassroom?.group_id === groupId) { setCurrentClassroom(null); setView("dashboard"); }
    } catch (e: any) { setError(e.message || t("app.errors.leaveGroup", { defaultValue: "Could not leave group" })); }
  };

  const handleDeleteClassroom = async (classroomId: string, classroomName: string, groupId: string) => {
    if (!window.confirm(t("app.confirm.deleteClassroom", { name: classroomName }))) return;
    setError(null);
    try {
      await deleteClassroom(classroomId);
      setGroupClassrooms(prev => ({ ...prev, [groupId]: (prev[groupId] || []).filter((c: any) => c.id !== classroomId) }));
      if (currentClassroom?.id === classroomId) { setCurrentClassroom(null); setView("dashboard"); }
    } catch (e: any) { setError(e.message || t("app.errors.deleteClassroom")); }
  };

  const openClassroom = async (cls: any) => {
    setCurrentClassroom(cls);
    setError(null);
    try {
      const asg = await listAssignments(cls.id);
      setAssignments(asg || []);
      if (asg?.length) {
        const results = await Promise.all(asg.map((a: any) => listSubmissions(a.id).catch(() => [])));
        const map: Record<string, any[]> = {};
        asg.forEach((a: any, i: number) => { map[a.id] = results[i] || []; });
        setSubmissionsByAssignment(map);
      } else {
        setSubmissionsByAssignment({});
      }
      if (cls.group_id) {
        try {
          const members = await listGroupMembers(cls.group_id);
          setGroupMembers((members || []).filter((m: any) => m.role === "student"));
        } catch { setGroupMembers([]); }
      } else {
        setGroupMembers([]);
      }
      setView("classroom");
    } catch (e: any) { setError(e.message || t("app.errors.loadAssignments")); }
  };

  const handleCreateAssignment = () => setShowCreateModal(true);

  const handleCreateAssignmentConfirm = async (data: CreateAssignmentModalData) => {
    if (!currentClassroom) return;
    setShowCreateModal(false);
    setError(null);
    try {
      const asg = await createAssignment(currentClassroom.id, data.title, data.description, data.templateCode, data.dueAt, data.testCode);
      setAssignments(prev => [...prev, asg]);
      setSubmissionsByAssignment(prev => ({ ...prev, [asg.id]: [] }));
    } catch (e: any) { setError(e.message || t("app.errors.createAssignment")); }
  };

  // Pre-server-save drafts used this key. Only read now (see legacyDraft).
  const legacyDraftKey = (assignmentId: string) => `chalk:draft:${user?.id || "anon"}:${assignmentId}`;

  const openAssignment = async (asg: any) => {
    setCurrentAssignment(asg);
    setSelectedSubmission(null);
    const defaultName = (asg.title || "main").replace(/\s+/g, "_").toLowerCase() + ".py";
    const template = asg.template_code || "# Write your code here\n\n";
    setError(null);
    setFailedAttempts(0);
    setHint(null);

    let subs: any[] = [];
    try {
      subs = await listSubmissions(asg.id) || [];
    } catch (e: any) {
      setError(e.message || t("app.errors.loadSubmissions"));
    }
    setSubmissions(subs);

    // The file's content comes from the server (saved room, or starter code
    // for a new one). The template is only shown until that arrives.
    let legacy: { key: string; code: string } | null = null;
    try {
      const key = legacyDraftKey(asg.id);
      const draft = localStorage.getItem(key);
      if (draft && draft.trim() && draft.trim() !== template.trim()) legacy = { key, code: draft };
    } catch { /* localStorage disabled (e.g. incognito) */ }
    setLegacyDraft(legacy);

    const initialFile: EditorFile = { id: asg.id || "main", name: defaultName, content: template };
    setFiles([initialFile]);
    setActiveFileId(initialFile.id);
    setCode(template);

    if (effectiveRole === "teacher" && asg.due_at && currentClassroom?.group_id) {
      try {
        const members = await listGroupMembers(currentClassroom.group_id);
        setGroupMembers((members || []).filter((m: any) => m.role === "student"));
      } catch { setGroupMembers([]); }
    } else { setGroupMembers([]); }
    setView("assignment");
  };

  // Open the student's personal workspace — an ephemeral, solo scratchpad.
  // Seeds a starter file only the first time so navigating away and back
  // keeps the code for the session (a full refresh clears it, by design).
  const openWorkspace = () => {
    setSelectedSubmission(null);
    setError(null);
    if (!files.some(f => f.id === "workspace-main")) {
      const starter = t("app.workspace.starter");
      const file: EditorFile = { id: "workspace-main", name: "main.py", content: starter };
      setFiles([file]);
      setActiveFileId(file.id);
      setCode(starter);
    }
    setView("workspace");
  };

  const handleAddFile = () => { if (currentAssignment || view === "workspace") setShowAddFileModal(true); };

  const handleAddFileConfirm = (name: string) => {
    setShowAddFileModal(false);
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const file: EditorFile = { id, name, content: "" };
    setFiles(prev => [...prev, file]);
    setActiveFileId(id);
    setCode("");
  };

  const handleSelectFile = (id: string) => {
    const file = files.find(f => f.id === id);
    if (!file) return;
    setActiveFileId(id);
    setCode(file.content);
  };

  const handleCodeChange = (value: string) => {
    setCode(value);
    if (!activeFileId) return;
    setFiles(prev => prev.map(f => f.id === activeFileId ? { ...f, content: value } : f));
    // No local draft: the server saves the shared file (see collab_manager).
  };

  const handleSubmit = async (stdinLines: string[] = []) => {
    if (!currentAssignment) return;
    setLoading(true);
    setError(null);
    try {
      const result = await runForSubmission(code, currentAssignment.test_code, stdinLines);
      const resultJson: Record<string, unknown> = {
        stdout: result.stdout,
        stderr: result.stderr,
        exit_code: result.exit_code,
        test_passed: result.test_passed,
        test_output: result.test_output,
      };
      const sub = await createSubmission(currentAssignment.id, code, result.status, resultJson);
      setSubmissions(prev => [sub, ...prev]);
      if (sub.status === "success") {
        setShowConfetti(true);
        const r = sub.result_json || {};
        const passed = typeof r.passed === "number" ? r.passed : 0;
        const earned = passed > 0 ? passed * 40 : r.test_passed === true ? 40 : 5;
        setXp(prev => (prev ?? 0) + earned);
        setFailedAttempts(0);
        setHint(null);
      } else {
        setFailedAttempts(prev => prev + 1);
      }
      void refreshStats();
    } catch (e: any) { setError(e.message || t("app.errors.submit")); } finally { setLoading(false); }
  };

  const isAdmin = user?.email === "madiyar.zmm@gmail.com";
  const effectiveRole: "teacher" | "student" = (isAdmin && viewAsRole) ? viewAsRole : (user?.role || "student");
  const canCreate = effectiveRole === "teacher";

  // ── Demo overrides ────────────────────────────────────────────────────────
  // For the a16z demo we present Haewon's account as an established student.
  // Pure client-side: no DB writes, no impact on anyone else, easy to remove.
  const isDemoStudent = user?.email === "parkhaewon0617@gmail.com";
  const demoActivityDays = useMemo(() => {
    // Hand-picked active-day pattern over the past 90 days. Looks like a
    // student who codes 3–5 sessions/week with a recent uptick.
    const pattern: Array<[number, number]> = [
      [88, 1], [85, 2], [82, 1], [78, 3], [76, 2],
      [73, 1], [70, 2], [67, 4], [64, 2], [60, 3],
      [57, 5], [54, 2], [50, 1], [46, 3], [42, 4],
      [38, 2], [35, 5], [32, 3], [29, 2], [25, 4],
      [22, 6], [19, 2], [16, 3], [13, 5], [10, 4],
      [8, 3], [7, 5], [5, 6], [3, 4], [2, 5], [1, 3], [0, 2],
    ];
    const active = new Map(pattern.map(([off, count]) => [off, count]));
    const today = new Date();
    const out: { date: string; count: number }[] = [];
    for (let i = 89; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      out.push({ date: d.toISOString().slice(0, 10), count: active.get(i) ?? 0 });
    }
    return out;
  }, []);
  const displayXp = isDemoStudent ? 6500 : xp;
  const displayActivityDays = isDemoStudent ? demoActivityDays : activityDays;

  const handleOpenAdminPanel = async () => {
    setShowAdminPanel(true);
    setAdminTab("overview");
    setAdminLoading(true);
    try {
      const [users, stats, flagged, codes, groups] = await Promise.all([
        listAllUsers(),
        getAdminStats(),
        getFlaggedSubmissions(),
        getAdminInviteCodes(),
        getAdminGroups(),
      ]);
      setAdminUsers(users || []);
      setAdminStats(stats);
      setAdminFlagged(flagged || []);
      setAdminInviteCodes(codes || []);
      setAdminGroups(groups || []);
    } catch (e: any) { setError(e.message || t("app.errors.loadUsers")); } finally { setAdminLoading(false); }
  };

  const handleToggleRole = async (userId: string, currentRole: string) => {
    const newRole = currentRole === "teacher" ? "student" : "teacher";
    try {
      const updated = await updateUserRole(userId, newRole as "teacher" | "student");
      setAdminUsers(prev => prev.map(u => u.id === userId ? { ...u, role: updated.role } : u));
    } catch (e: any) { setError(e.message || t("app.errors.updateRole")); }
  };

  const handleToggleBan = async (userId: string, currentlyBanned: boolean) => {
    try {
      const updated = await toggleUserBan(userId, !currentlyBanned, !currentlyBanned ? "Banned by admin" : undefined);
      setAdminUsers(prev => prev.map(u => u.id === userId ? { ...u, is_banned: updated.is_banned, ban_reason: updated.ban_reason } : u));
    } catch (e: any) { setError(e.message || "Failed to update ban status"); }
  };

  const handleRevokeCode = async (groupId: string) => {
    try {
      await revokeInviteCode(groupId);
      setAdminInviteCodes(prev => prev.filter(c => c.group_id !== groupId));
    } catch (e: any) { setError(e.message || "Failed to revoke invite code"); }
  };

  const handleGetHint = async () => {
    if (!currentAssignment) return;
    setHintLoading(true);
    try {
      const h = await getHint(currentAssignment.id, code, failedAttempts);
      setHint(h);
      setXp(prev => Math.max(0, (prev ?? 0) - 5));
    } catch { setHint(t("app.assignment.hintFallback")); } finally { setHintLoading(false); }
  };

  const handleSaveFeedback = async (submissionId: string, feedback: string) => {
    const updated = await addSubmissionFeedback(submissionId, feedback);
    setSelectedSubmission(updated);
    setSubmissions(prev => prev.map(s => s.id === submissionId ? { ...s, feedback: updated.feedback } : s));
  };

  const isWorkspaceView = view === "workspace";

  // In the workspace there is no real assignment row; we hand AssignmentView
  // a synthetic one. The collab room ids stay undefined so the editor and
  // canvas run fully local (solo, no WebSocket).
  const workspaceAssignment = {
    id: WORKSPACE_ID,
    title: t("app.workspace.title"),
    description: null,
    template_code: null,
    test_code: null,
    due_at: null,
  };
  const activeAssignment = isWorkspaceView ? workspaceAssignment : currentAssignment;

  const roomIdForEditor = !isWorkspaceView && currentClassroom && currentAssignment && activeFileId
    ? `${currentClassroom.id}:${currentAssignment.id}:${activeFileId}` : undefined;

  const drawingRoomId = !isWorkspaceView && currentClassroom && currentAssignment
    ? `drawing:${currentClassroom.id}:${currentAssignment.id}` : undefined;

  const lessonNav: LessonNav = {
    openLesson: id => { setNavLessonId(id); setView("lesson"); },
    openHomework: id => { setNavLessonId(id); setView("homework"); },
    openReview: id => { setNavLessonId(id ?? null); setView("review"); },
    openGroup: id => { setNavGroupId(id); setView("group"); },
    newGroup: () => setGroupSheet({ group: null }),
    joinGroup: () => setShowJoinGroupModal(true),
  };
  const me = {
    id: String(user?.id ?? ""),
    displayName: `${(isAdmin || effectiveRole === "teacher") ? t("common.teacher") : t("common.student")} ${(user?.name || "").split(" ")[0]}`.trim(),
    role: effectiveRole,
  };

  if (initError) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6" style={{ background: "var(--bg-2)" }}>
        <div className="st-card" style={{ padding: 28, maxWidth: 420, textAlign: "center", display: "flex", flexDirection: "column", gap: 12, alignItems: "center" }}>
          <h1 style={{ fontSize: 18, fontWeight: 700 }}>{t("app.loadError.title", { defaultValue: "Strawie couldn't load" })}</h1>
          <p style={{ fontSize: 14, color: "var(--text-3)" }}>{t("app.loadError.body", { defaultValue: "The server had a problem. Try again in a moment." })}</p>
          <code style={{ fontSize: 12, color: "var(--text-3)" }}>{initError}</code>
          <button type="button" className="st-btn st-btn-primary" onClick={() => window.location.reload()}>{t("app.loadError.retry", { defaultValue: "Try again" })}</button>
        </div>
      </div>
    );
  }

  if (!authChecked) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "var(--bg)" }}>
        <div className="flex items-center gap-3 text-sm" style={{ color: "var(--muted)" }}>
          <span
            className="h-4 w-4 rounded-full border-2 border-t-transparent animate-spin"
            style={{ borderColor: "var(--indigo)", borderTopColor: "transparent" }}
          />
          {t("common.loading")}
        </div>
      </div>
    );
  }

  // ── nav items per role ────────────────────────────────────────────────────
  const HOME_ICON = "M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6";
  const REVIEW_ICON = "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4";
  const PROFILE_ICON = "M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z";
  const teacherNav = [
    { id: "home" as View, label: t("lessons.nav.home", { defaultValue: "Home" }), icon: HOME_ICON },
    { id: "review" as View, label: t("lessons.review.title", { defaultValue: "Review" }), icon: REVIEW_ICON },
    { id: "dashboard" as View, label: t("lessons.nav.overview", { defaultValue: "Overview" }), icon: "M4 5a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1V5zm10 0a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1V5zM4 15a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1v-4zm10 0a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z" },
    { id: "classroom" as View, label: t("app.nav.classroom"), icon: "M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" },
    { id: "submissions" as View, label: t("app.nav.submissions"), icon: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" },
  ];
  const studentNav = [
    { id: "home" as View, label: t("lessons.nav.home", { defaultValue: "Home" }), icon: HOME_ICON },
    { id: "dashboard" as View, label: t("lessons.nav.profile", { defaultValue: "Profile" }), icon: PROFILE_ICON },
    { id: "workspace" as View, label: t("app.nav.workspace"), icon: "M4 6a2 2 0 012-2h12a2 2 0 012 2v12a2 2 0 01-2 2H6a2 2 0 01-2-2V6zm0 3h16" },
    { id: "classroom" as View, label: t("app.nav.classroom"), icon: "M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" },
    { id: "assignment" as View, label: t("app.nav.editor"), icon: "M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" },
  ];
  const navItems = effectiveRole === "teacher" ? teacherNav : studentNav;
  // classroom nav item links to classroom view only if a classroom is selected
  const handleNavClick = (id: View) => {
    if (id === "workspace") { openWorkspace(); return; }
    if (id === "review") { setNavLessonId(null); setView("review"); return; }
    if (id === "classroom" && !currentClassroom) return;
    if (id === "assignment" && !currentAssignment) return;
    if (id === "submissions" && !currentClassroom) return;
    setView(id);
  };

  return (
    <div className="min-h-screen flex" style={{ background: "var(--bg)", color: "var(--text)" }}>

      {/* ── Sidebar ─────────────────────────────────────────────────────────── */}
      <aside style={{
        width: sidebarCollapsed ? 64 : 236,
        flexShrink: 0, height: "100vh", position: "sticky", top: 0,
        display: "flex", flexDirection: "column",
        background: "var(--bg)", borderRight: "1px solid var(--border)",
        padding: sidebarCollapsed ? "14px 10px" : "14px 12px",
        transition: "width 240ms var(--ease), padding 240ms var(--ease)",
      }}>
        {/* Logo + collapse toggle */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: sidebarCollapsed ? "center" : "space-between", gap: 6, height: 36, padding: sidebarCollapsed ? 0 : "0 4px 0 6px", marginBottom: 14 }}>
          {!sidebarCollapsed && <ChalkLogo size={24} />}
          <button
            onClick={() => setSidebarCollapsed(v => !v)}
            className="st-icon-btn"
            title={sidebarCollapsed ? t("app.sidebar.expandSidebar") : t("app.sidebar.collapseSidebar")}
          >
            {sidebarCollapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
          </button>
        </div>

        {/* Nav items + classes */}
        <div style={{ display: "flex", flexDirection: "column", gap: 2, flex: 1, minHeight: 0, overflowY: "auto", overflowX: "hidden" }}>
          {navItems.map(item => {
            const isActive = view === item.id;
            const isDisabled = (item.id === "classroom" && !currentClassroom) ||
              (item.id === "assignment" && !currentAssignment) ||
              (item.id === "submissions" && !currentClassroom);
            // Context-dependent destinations only appear once they lead
            // somewhere — no greyed-out dead buttons.
            if (isDisabled) return null;
            return (
              <button
                key={item.id}
                onClick={() => handleNavClick(item.id)}
                title={sidebarCollapsed ? item.label : undefined}
                className="sidebar-nav-item"
                data-active={isActive}
                data-disabled={false}
                style={{
                  position: "relative",
                  display: "flex", alignItems: "center", gap: 10,
                  height: 36,
                  padding: sidebarCollapsed ? 0 : "0 10px",
                  justifyContent: sidebarCollapsed ? "center" : "flex-start",
                  borderRadius: 10, border: "none",
                  background: isActive ? "var(--bg-3)" : "transparent",
                  color: isActive ? "var(--text)" : "var(--text-3)",
                  cursor: "pointer",
                  fontSize: 13, fontWeight: isActive ? 600 : 500, textAlign: "left",
                }}
              >
                <svg width="17" height="17" fill="none" stroke="currentColor" strokeWidth={isActive ? 1.9 : 1.6} viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
                  <path strokeLinecap="round" strokeLinejoin="round" d={item.icon} />
                </svg>
                {!sidebarCollapsed && <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.label}</span>}
              </button>
            );
          })}

          {/* Classroom list — hidden when collapsed */}
          {!sidebarCollapsed && (
            <div style={{ marginTop: 18 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 6px 0 10px", marginBottom: 4 }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text-3)" }}>{t("lessons.nav.groups", { defaultValue: "Groups" })}</span>
                <div style={{ display: "flex", gap: 2 }}>
                  <button onClick={handleJoinGroup} className="st-icon-btn" style={{ width: 24, height: 24 }} title={t("app.sidebar.join")}>
                    <LogIn className="h-3.5 w-3.5" />
                  </button>
                  {canCreate && (
                    <button onClick={() => setGroupSheet({ group: null })} className="st-icon-btn" style={{ width: 24, height: 24 }} title={t("app.sidebar.newGroup")}>
                      <Plus className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>
              {groups.map(g => {
                const isExpanded = expandedGroupId === g.id;
                const classrooms = groupClassrooms[g.id] || [];
                const isOwner = g.teacher_id === user?.id;
                return (
                  <div key={g.id} className="group/grp">
                    <div className="sidebar-row" style={{ display: "flex", alignItems: "center", borderRadius: 10 }}>
                      <button
                        onClick={() => toggleGroup(g.id)}
                        className="st-icon-btn"
                        style={{ width: 22, height: 22, marginLeft: 4, visibility: classrooms.length > 0 || (isExpanded && canCreate) ? "visible" : "hidden" }}
                        title={t("lessons.nav.olderClassrooms", { defaultValue: "Older classrooms" })}
                        aria-expanded={isExpanded}
                      >
                        <ChevronRight className="h-3.5 w-3.5" style={{ transform: isExpanded ? "rotate(90deg)" : "none", transition: "transform 200ms var(--ease)" }} />
                      </button>
                      <button
                        onClick={() => { setNavGroupId(g.id); setView("group"); }}
                        style={{
                          display: "flex", alignItems: "center", gap: 6, flex: 1, minWidth: 0, height: 32, padding: "0 4px 0 4px",
                          background: "transparent", border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600,
                          color: view === "group" && navGroupId === g.id ? "var(--text)" : "var(--text-2)",
                        }}
                      >
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{g.name}</span>
                      </button>
                      <button
                        onClick={e => { e.stopPropagation(); if (isOwner) { handleDeleteGroup(g.id, g.name); } else { handleLeaveGroup(g.id, g.name); } }}
                        title={isOwner ? t("app.sidebar.deleteGroup") : t("app.sidebar.leaveGroup", { defaultValue: "Leave group" })}
                        className="st-icon-btn sidebar-row-action"
                        style={{ width: 24, height: 24, marginRight: 4 }}
                      >
                        {isOwner ? <Trash2 size={12} /> : <LogOut size={12} />}
                      </button>
                    </div>
                    {isExpanded && (
                      <div className="st-fade-up" style={{ marginLeft: 15, paddingLeft: 8, borderLeft: "1px solid var(--border)", marginBottom: 4 }}>
                        {classrooms.map(c => {
                          const active = currentClassroom?.id === c.id;
                          const live = classroomActiveCounts[c.id] || 0;
                          return (
                            <div key={c.id} className="sidebar-row" style={{ display: "flex", alignItems: "center", borderRadius: 8, background: active ? "var(--bg-3)" : "transparent" }}>
                              <button
                                onClick={() => openClassroom({ ...c, invite_code: g.invite_code })}
                                style={{
                                  display: "flex", alignItems: "center", gap: 8, flex: 1, minWidth: 0,
                                  height: 30, padding: "0 4px 0 8px", border: "none", background: "transparent",
                                  cursor: "pointer", fontSize: 12.5, fontWeight: active ? 600 : 500,
                                  color: active ? "var(--text)" : "var(--text-3)",
                                }}
                              >
                                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</span>
                                {live > 0 && <span title={t("app.classroom.liveNow", { count: live })} style={{ width: 6, height: 6, borderRadius: 999, background: "var(--mint)", flexShrink: 0 }} />}
                              </button>
                              {canCreate && (
                                <button
                                  onClick={e => { e.stopPropagation(); handleDeleteClassroom(c.id, c.name, g.id); }}
                                  title={t("app.sidebar.deleteClassroom")}
                                  className="st-icon-btn sidebar-row-action"
                                  style={{ width: 22, height: 22, marginRight: 4 }}
                                >
                                  <Trash2 size={11} />
                                </button>
                              )}
                            </div>
                          );
                        })}
                        {classrooms.length === 0 && (
                          <div style={{ padding: "6px 8px", fontSize: 12, color: "var(--subtle)" }}>{t("app.sidebar.noClassrooms")}</div>
                        )}
                        {canCreate && (
                          <button
                            onClick={e => { e.stopPropagation(); handleCreateClassroom(g.id); }}
                            className="st-btn st-btn-ghost st-btn-sm"
                            style={{ height: 28, padding: "0 8px", fontWeight: 500, color: "var(--text-3)" }}
                          >
                            <Plus className="h-3.5 w-3.5" />
                            {t("app.sidebar.newClassroom").replace(/^\+\s*/, "")}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
              {groups.length === 0 && (
                <div style={{ padding: "6px 10px", fontSize: 12, color: "var(--subtle)", lineHeight: 1.5 }}>{t("app.sidebar.noClassrooms")}</div>
              )}
            </div>
          )}
        </div>

        {/* Account: everything that isn't navigation lives in one menu. */}
        <div style={{ borderTop: "1px solid var(--border)", paddingTop: 10, marginTop: 8 }}>
          <UserMenu
            user={user}
            role={effectiveRole}
            collapsed={sidebarCollapsed}
            isAdmin={isAdmin}
            theme={theme}
            onThemeChange={setTheme}
            onViewAs={r => { setViewAsRole(r); setFailedAttempts(0); setHint(null); }}
            onOpenAdmin={handleOpenAdminPanel}
            onLogout={handleLogout}
          />
        </div>
      </aside>

      {/* ── Main area ──────────────────────────────────────────────────────── */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minHeight: "100vh" }}>
        {error && (
          <div style={{ background: "var(--rose-muted)", borderBottom: "1px solid var(--border)", color: "var(--rose)", padding: "8px 16px", fontSize: 12 }}>
            {error}
          </div>
        )}

        {/* Main content */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          {view === "home" && (
            <HomeScreen user={user} role={effectiveRole} hasGroups={groups.length > 0} nav={lessonNav} />
          )}
          {view === "group" && navGroupId && (
            <GroupScreen key={navGroupId} groupId={navGroupId} nav={lessonNav} refreshKey={groupRefresh}
              onEditSchedule={g => setGroupSheet({ group: g })} />
          )}
          {view === "lesson" && navLessonId && (
            <LessonScreen key={navLessonId} lessonId={navLessonId} me={me}
              onBack={() => setView(navGroupId ? "group" : "home")} onReview={id => { setNavLessonId(id); setView("review"); }} />
          )}
          {view === "homework" && navLessonId && (
            <HomeworkScreen key={navLessonId} lessonId={navLessonId} me={me} onBack={() => setView("home")} />
          )}
          {view === "review" && (
            <ReviewScreen key={navLessonId ?? "list"} lessonId={navLessonId ?? undefined} me={me}
              onBack={() => setNavLessonId(null)} onPick={id => setNavLessonId(id)} />
          )}
          {view === "dashboard" && (
            <DashboardView
              user={user}
              groups={groups}
              canCreate={canCreate}
              effectiveRole={effectiveRole}
              isAdmin={isAdmin}
              xp={displayXp}
              activityDays={displayActivityDays}
              onCreateGroup={handleCreateGroup}
              onJoinGroup={handleJoinGroup}
              onOpenWorkspace={openWorkspace}
              groupClassrooms={groupClassrooms}
              activeCounts={classroomActiveCounts}
              onOpenClassroom={openClassroom}
              cosmetics={cosmetics}
              onSaveCosmetics={saveCosmetics}
            />
          )}
          {view === "classroom" && currentClassroom && (
            <ClassroomView
              classroom={currentClassroom}
              assignments={assignments}
              canCreate={canCreate}
              userRole={effectiveRole}
              userId={user?.id || ""}
              submissionsByAssignment={submissionsByAssignment}
              groupMembers={groupMembers}
              activeCount={classroomActiveCounts[currentClassroom.id] || 0}
              onCreateAssignment={handleCreateAssignment}
              onOpenAssignment={openAssignment}
              onBack={() => setView("dashboard")}
              onDelete={() => handleDeleteClassroom(currentClassroom.id, currentClassroom.name, currentClassroom.group_id)}
            />
          )}
          {view === "submissions" && currentClassroom && (
            <SubmissionsView
              classroom={currentClassroom}
              assignments={assignments}
              submissions={submissions}
              selectedSubmission={selectedSubmission}
              onSelectSubmission={setSelectedSubmission}
              onOpenAssignment={openAssignment}
              onBack={() => setView("classroom")}
              userRole={effectiveRole}
              onSaveFeedback={handleSaveFeedback}
            />
          )}
          {(view === "assignment" || view === "workspace") && activeAssignment && (
            <AssignmentView
              assignment={activeAssignment}
              isWorkspace={isWorkspaceView}
              code={code}
              setCode={handleCodeChange}
              roomId={roomIdForEditor}
              drawingRoomId={drawingRoomId}
              userName={
                // Manual override: this user opted out of having their name on
                // their cursor — show just the role label.
                user?.email === "parkhaewon0617@gmail.com"
                  ? "Student"
                  : `${(isAdmin || effectiveRole === "teacher") ? "Teacher" : "Student"} ${(user?.name || "Anonymous").split(" ")[0]}`
              }
              userRole={(isAdmin || effectiveRole === "teacher") ? "teacher" : "student"}
              userId={user?.id || ""}
              groupMembers={groupMembers}
              files={files}
              activeFileId={activeFileId}
              onSelectFile={handleSelectFile}
              onAddFile={handleAddFile}
              submissions={submissions}
              selectedSubmission={selectedSubmission}
              onSelectSubmission={setSelectedSubmission}
              loading={loading}
              onSubmit={handleSubmit}
              onBack={() => setView(isWorkspaceView ? "dashboard" : "classroom")}
              onSaveFeedback={handleSaveFeedback}
              failedAttempts={failedAttempts}
              hint={hint}
              hintLoading={hintLoading}
              onGetHint={handleGetHint}
              onDismissHint={() => setHint(null)}
              legacyDraft={isWorkspaceView ? null : legacyDraft?.code ?? null}
              onDismissLegacyDraft={() => {
                if (legacyDraft) { try { localStorage.removeItem(legacyDraft.key); } catch { /* ignore */ } }
                setLegacyDraft(null);
              }}
              xp={xp}
            />
          )}
        </div>
      </div>

      {/* Modals */}
      {showCreateModal && (
        <CreateAssignmentModal onConfirm={handleCreateAssignmentConfirm} onCancel={() => setShowCreateModal(false)} />
      )}
      {groupSheet && (
        <GroupSheet group={groupSheet.group} onClose={() => setGroupSheet(null)} onSaved={async saved => {
          const fresh = await listGroups().catch(() => null);
          if (fresh) setGroups(fresh);
          setGroupRefresh(n => n + 1);
          if (!groupSheet.group) { setNavGroupId(saved.id); setView("group"); }
        }} />
      )}
      {showCreateGroupModal && (
        <SimpleInputModal title={t("app.modals.newGroupTitle")} placeholder={t("app.modals.newGroupPlaceholder")} confirmLabel={t("app.modals.newGroupConfirm")} onConfirm={handleCreateGroupConfirm} onCancel={() => setShowCreateGroupModal(false)} />
      )}
      {showJoinGroupModal && (
        <SimpleInputModal title={t("app.modals.joinGroupTitle")} placeholder={t("app.modals.joinGroupPlaceholder")} confirmLabel={t("app.modals.joinGroupConfirm")} onConfirm={handleJoinGroupConfirm} onCancel={() => setShowJoinGroupModal(false)} />
      )}
      {showCreateClassroomModal && (
        <SimpleInputModal title={t("app.modals.newClassroomTitle")} placeholder={t("app.modals.newClassroomPlaceholder")} confirmLabel={t("app.modals.newClassroomConfirm")} onConfirm={handleCreateClassroomConfirm} onCancel={() => setShowCreateClassroomModal(null)} />
      )}
      {showAddFileModal && (
        <SimpleInputModal title={t("app.modals.newFileTitle")} placeholder={t("app.modals.newFilePlaceholder")} defaultValue={`file${files.length + 1}.py`} confirmLabel={t("app.modals.newFileConfirm")} onConfirm={handleAddFileConfirm} onCancel={() => setShowAddFileModal(false)} />
      )}

      {showAdminPanel && (
        <div className="st-backdrop fixed inset-0 z-50 flex items-start justify-end" onMouseDown={e => { if (e.target === e.currentTarget) setShowAdminPanel(false); }}>
          <div
            className="h-full w-full flex flex-col"
            style={{ background: "var(--bg)", borderLeft: "1px solid var(--border)", maxWidth: 640, boxShadow: "var(--shadow-lg)", animation: "slideInRight 260ms var(--ease) both" }}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-3 border-b" style={{ borderColor: "var(--border)" }}>
              <div className="flex items-center gap-2">
                <Shield className="h-4 w-4" style={{ color: "var(--amber)" }} />
                <h2 className="text-sm font-semibold">Admin Panel</h2>
              </div>
              <button onClick={() => setShowAdminPanel(false)} style={{ color: "var(--subtle)", background: "none", border: "none", cursor: "pointer" }}>
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Tabs */}
            <div className="flex border-b" style={{ borderColor: "var(--border)" }}>
              {([
                ["overview", "Overview", BarChart3],
                ["users", "Users", Users],
                ["groups", "Groups", FolderOpen],
                ["security", "Security", AlertTriangle],
              ] as const).map(([id, label, Icon]) => (
                <button
                  key={id}
                  onClick={() => setAdminTab(id as any)}
                  className="flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium transition-colors"
                  style={{
                    color: adminTab === id ? "var(--indigo)" : "var(--muted)",
                    borderBottom: adminTab === id ? "2px solid var(--indigo)" : "2px solid transparent",
                    background: "none", border: "none", borderBottomStyle: "solid", borderBottomWidth: 2,
                    borderBottomColor: adminTab === id ? "var(--indigo)" : "transparent",
                    cursor: "pointer",
                  }}
                >
                  <Icon className="h-3.5 w-3.5" />{label}
                </button>
              ))}
            </div>

            {/* Content */}
            <div className="flex-1 overflow-auto">
              {adminLoading ? (
                <div className="flex items-center justify-center h-32 text-sm gap-2" style={{ color: "var(--muted)" }}>
                  <span className="h-4 w-4 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: "var(--indigo)", borderTopColor: "transparent" }} />
                  Loading...
                </div>
              ) : (
                <>
                  {/* ── Overview tab ─────────────────────────────── */}
                  {adminTab === "overview" && adminStats && (
                    <div className="p-5 space-y-4">
                      <div className="grid grid-cols-2 gap-3">
                        {[
                          { label: "Total Users", value: adminStats.total_users, icon: Users },
                          { label: "Active Today", value: adminStats.active_today, icon: Zap },
                          { label: "Signups (7d)", value: adminStats.signups_week, icon: Clock },
                          { label: "Banned", value: adminStats.banned_count, icon: Ban },
                          { label: "Groups", value: adminStats.total_groups, icon: FolderOpen },
                          { label: "Classrooms", value: adminStats.total_classrooms, icon: Home },
                          { label: "Submissions", value: adminStats.total_submissions, icon: PenLine },
                          { label: "Today", value: adminStats.submissions_today, icon: BarChart3 },
                          { label: "This Week", value: adminStats.submissions_week, icon: Flame },
                          { label: "Pass Rate", value: `${adminStats.pass_rate}%`, icon: Trophy },
                        ].map(({ label, value, icon: StatIcon }) => (
                          <div key={label} className="rounded-lg p-3" style={{ background: "var(--bg-3)", border: "1px solid var(--border)" }}>
                            <div className="flex items-center gap-2 mb-1">
                              <StatIcon className="h-3.5 w-3.5" style={{ color: "var(--muted)" }} />
                              <span className="text-[11px]" style={{ color: "var(--muted)" }}>{label}</span>
                            </div>
                            <div className="text-lg font-semibold" style={{ color: "var(--text)" }}>{value}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* ── Users tab ────────────────────────────────── */}
                  {adminTab === "users" && (
                    <div>
                      <div className="px-4 py-3" style={{ borderBottom: "1px solid var(--border)" }}>
                        <div className="relative">
                          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5" style={{ color: "var(--muted)" }} />
                          <input
                            type="text"
                            value={adminSearch}
                            onChange={e => setAdminSearch(e.target.value)}
                            placeholder="Search users..."
                            className="w-full pl-8 pr-3 py-2 rounded-lg text-xs"
                            style={{ background: "var(--bg-3)", border: "1px solid var(--border)", color: "var(--text)", outline: "none" }}
                          />
                        </div>
                      </div>
                      <div className="divide-y" style={{ borderColor: "var(--border)" }}>
                        {adminUsers
                          .filter(u => {
                            if (!adminSearch) return true;
                            const q = adminSearch.toLowerCase();
                            return u.name?.toLowerCase().includes(q) || u.email?.toLowerCase().includes(q);
                          })
                          .map(u => (
                            <div key={u.id} className="flex items-center justify-between px-4 py-3">
                              <div className="min-w-0 flex items-center gap-2.5">
                                <div className="relative">
                                  <Avatar name={u.name || u.email} size={28} />
                                  {u.is_banned && (
                                    <div className="absolute -top-1 -right-1 h-3.5 w-3.5 rounded-full flex items-center justify-center" style={{ background: "var(--rose)" }}>
                                      <Ban className="h-2 w-2" style={{ color: "white" }} />
                                    </div>
                                  )}
                                </div>
                                <div>
                                  <div className="text-xs font-medium truncate" style={{ color: u.is_banned ? "var(--muted)" : "var(--text)", textDecoration: u.is_banned ? "line-through" : "none" }}>{u.name}</div>
                                  <div className="text-[11px] truncate" style={{ color: "var(--subtle)" }}>{u.email}</div>
                                  {u.last_active_at && (
                                    <div className="text-[10px]" style={{ color: "var(--subtle)" }}>
                                      Last active: {new Date(u.last_active_at).toLocaleDateString()}
                                    </div>
                                  )}
                                </div>
                              </div>
                              <div className="flex items-center gap-1.5 shrink-0 ml-3">
                                <Badge type={u.role === "teacher" ? "in-progress" : "default"} label={u.role} />
                                {u.email !== "madiyar.zmm@gmail.com" && (
                                  <>
                                    <button
                                      onClick={() => handleToggleRole(u.id, u.role)}
                                      className="text-[10px] px-1.5 py-0.5 rounded-md transition-colors"
                                      style={{ border: "1px solid var(--border)", color: "var(--muted)", background: "none", cursor: "pointer" }}
                                    >
                                      {u.role === "teacher" ? "→ Student" : "→ Teacher"}
                                    </button>
                                    <button
                                      onClick={() => handleToggleBan(u.id, u.is_banned)}
                                      className="text-[10px] px-1.5 py-0.5 rounded-md transition-colors"
                                      style={{
                                        border: "1px solid",
                                        borderColor: u.is_banned ? "var(--emerald)" : "var(--rose)",
                                        color: u.is_banned ? "var(--emerald)" : "var(--rose)",
                                        background: "none", cursor: "pointer",
                                      }}
                                    >
                                      {u.is_banned ? "Unban" : "Ban"}
                                    </button>
                                  </>
                                )}
                              </div>
                            </div>
                          ))}
                        {adminUsers.length === 0 && (
                          <div className="px-5 py-8 text-center text-xs" style={{ color: "var(--subtle)" }}>No users found</div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* ── Groups tab ───────────────────────────────── */}
                  {adminTab === "groups" && (
                    <div className="p-4 space-y-3">
                      {adminGroups.length === 0 && (
                        <div className="py-8 text-center text-xs" style={{ color: "var(--subtle)" }}>No groups yet</div>
                      )}
                      {adminGroups.map((g: any) => (
                        <div key={g.id} className="rounded-lg overflow-hidden" style={{ border: "1px solid var(--border)", background: "var(--bg-3)" }}>
                          <div className="px-4 py-3">
                            <div className="flex items-center justify-between">
                              <div>
                                <div className="text-sm font-medium" style={{ color: "var(--text)" }}>{g.name}</div>
                                <div className="text-[11px] mt-0.5" style={{ color: "var(--muted)" }}>
                                  by {g.teacher_name} &middot; {g.member_count} members
                                  {g.invite_code && <span> &middot; Code: <code className="px-1 py-0.5 rounded text-[10px]" style={{ background: "var(--bg-2)" }}>{g.invite_code}</code></span>}
                                </div>
                              </div>
                              <Eye className="h-3.5 w-3.5" style={{ color: "var(--muted)" }} />
                            </div>
                          </div>
                          {g.classrooms?.length > 0 && (
                            <div className="border-t" style={{ borderColor: "var(--border)" }}>
                              {g.classrooms.map((c: any) => (
                                <div key={c.id} className="px-4 py-2 flex items-center gap-2 text-xs" style={{ color: "var(--text-3)" }}>
                                  <FolderOpen className="h-3 w-3" style={{ color: "var(--muted)" }} />
                                  {c.name}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* ── Security tab ─────────────────────────────── */}
                  {adminTab === "security" && (
                    <div className="p-4 space-y-5">
                      {/* Flagged submissions */}
                      <div>
                        <div className="flex items-center gap-2 mb-3">
                          <AlertTriangle className="h-3.5 w-3.5" style={{ color: "var(--amber)" }} />
                          <h3 className="text-xs font-semibold" style={{ color: "var(--text)" }}>
                            Flagged Submissions ({adminFlagged.length})
                          </h3>
                        </div>
                        {adminFlagged.length === 0 ? (
                          <div className="rounded-lg p-4 text-center text-xs" style={{ background: "var(--bg-3)", border: "1px solid var(--border)", color: "var(--subtle)" }}>
                            No suspicious code detected in the last 7 days
                          </div>
                        ) : (
                          <div className="space-y-2">
                            {adminFlagged.map((f: any) => (
                              <div key={f.submission_id} className="rounded-lg overflow-hidden" style={{ border: "1px solid var(--border)", background: "var(--bg-3)" }}>
                                <button
                                  onClick={() => setAdminExpandedFlag(adminExpandedFlag === f.submission_id ? null : f.submission_id)}
                                  className="w-full text-left px-3 py-2.5 flex items-center justify-between"
                                  style={{ background: "none", border: "none", cursor: "pointer" }}
                                >
                                  <div>
                                    <div className="text-xs font-medium" style={{ color: "var(--text)" }}>{f.user_name}</div>
                                    <div className="text-[10px]" style={{ color: "var(--muted)" }}>
                                      {f.user_email} &middot; {new Date(f.submitted_at).toLocaleString()}
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-1.5">
                                    {f.flags.slice(0, 3).map((fl: any, i: number) => (
                                      <span key={i} className="text-[9px] px-1.5 py-0.5 rounded" style={{ background: "var(--rose-muted)", color: "var(--rose)" }}>
                                        {fl.label}
                                      </span>
                                    ))}
                                    {f.flags.length > 3 && (
                                      <span className="text-[9px] px-1 py-0.5 rounded" style={{ background: "var(--bg-2)", color: "var(--muted)" }}>
                                        +{f.flags.length - 3}
                                      </span>
                                    )}
                                  </div>
                                </button>
                                {adminExpandedFlag === f.submission_id && (
                                  <div className="border-t px-3 py-2" style={{ borderColor: "var(--border)" }}>
                                    <div className="mb-2">
                                      {f.flags.map((fl: any, i: number) => (
                                        <div key={i} className="text-[11px] py-1 flex items-start gap-2">
                                          <span style={{ color: "var(--rose)" }}>L{fl.line}</span>
                                          <code className="flex-1 text-[10px] break-all" style={{ color: "var(--text-3)" }}>{fl.snippet}</code>
                                        </div>
                                      ))}
                                    </div>
                                    <details className="text-[10px]">
                                      <summary style={{ color: "var(--muted)", cursor: "pointer" }}>View full code</summary>
                                      <pre className="mt-1 p-2 rounded text-[10px] overflow-x-auto" style={{ background: "var(--bg-1)", color: "var(--text-3)", maxHeight: 200 }}>
                                        {f.code}
                                      </pre>
                                    </details>
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Invite codes */}
                      <div>
                        <div className="flex items-center gap-2 mb-3">
                          <Key className="h-3.5 w-3.5" style={{ color: "var(--indigo)" }} />
                          <h3 className="text-xs font-semibold" style={{ color: "var(--text)" }}>
                            Active Invite Codes ({adminInviteCodes.length})
                          </h3>
                        </div>
                        {adminInviteCodes.length === 0 ? (
                          <div className="rounded-lg p-4 text-center text-xs" style={{ background: "var(--bg-3)", border: "1px solid var(--border)", color: "var(--subtle)" }}>
                            No active invite codes
                          </div>
                        ) : (
                          <div className="space-y-2">
                            {adminInviteCodes.map((c: any) => (
                              <div key={c.group_id} className="rounded-lg flex items-center justify-between px-3 py-2.5" style={{ background: "var(--bg-3)", border: "1px solid var(--border)" }}>
                                <div>
                                  <div className="text-xs font-medium" style={{ color: "var(--text)" }}>{c.group_name}</div>
                                  <div className="text-[10px]" style={{ color: "var(--muted)" }}>
                                    by {c.teacher_name} &middot; {c.member_count} members &middot;
                                    <code className="ml-1 px-1 py-0.5 rounded" style={{ background: "var(--bg-2)" }}>{c.invite_code}</code>
                                  </div>
                                </div>
                                <button
                                  onClick={() => handleRevokeCode(c.group_id)}
                                  className="text-[10px] px-2 py-1 rounded-md"
                                  style={{ border: "1px solid var(--rose)", color: "var(--rose)", background: "none", cursor: "pointer" }}
                                >
                                  Revoke
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Banned users summary */}
                      <div>
                        <div className="flex items-center gap-2 mb-3">
                          <Ban className="h-3.5 w-3.5" style={{ color: "var(--rose)" }} />
                          <h3 className="text-xs font-semibold" style={{ color: "var(--text)" }}>
                            Banned Users ({adminUsers.filter(u => u.is_banned).length})
                          </h3>
                        </div>
                        {adminUsers.filter(u => u.is_banned).length === 0 ? (
                          <div className="rounded-lg p-4 text-center text-xs" style={{ background: "var(--bg-3)", border: "1px solid var(--border)", color: "var(--subtle)" }}>
                            No banned users
                          </div>
                        ) : (
                          <div className="space-y-2">
                            {adminUsers.filter(u => u.is_banned).map(u => (
                              <div key={u.id} className="rounded-lg flex items-center justify-between px-3 py-2.5" style={{ background: "var(--bg-3)", border: "1px solid var(--border)" }}>
                                <div className="flex items-center gap-2">
                                  <Avatar name={u.name || u.email} size={24} />
                                  <div>
                                    <div className="text-xs" style={{ color: "var(--text)", textDecoration: "line-through" }}>{u.name}</div>
                                    <div className="text-[10px]" style={{ color: "var(--muted)" }}>{u.email}</div>
                                  </div>
                                </div>
                                <button
                                  onClick={() => handleToggleBan(u.id, true)}
                                  className="text-[10px] px-2 py-1 rounded-md"
                                  style={{ border: "1px solid var(--emerald)", color: "var(--emerald)", background: "none", cursor: "pointer" }}
                                >
                                  Unban
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      <Confetti active={showConfetti} onDone={() => setShowConfetti(false)} />
    </div>
  );
};

// ─── XP / cosmetics constants ────────────────────────────────────────────────

const XP_FRAMES = [
  { id: "plain",  name: "Default", cost: 0,    color: "var(--border)",        glow: "none" },
  { id: "bronze", name: "Bronze",  cost: 100,  color: "#cd7f32",              glow: "0 0 12px #cd7f3266" },
  { id: "silver", name: "Silver",  cost: 250,  color: "#c0c0c0",              glow: "0 0 12px #c0c0c066" },
  { id: "gold",   name: "Gold",    cost: 500,  color: "#ffd700",              glow: "0 0 16px #ffd70066" },
  { id: "cosmic", name: "Cosmic",  cost: 1000, color: "oklch(0.60 0.22 308)", glow: "0 0 20px oklch(0.60 0.22 308 / 0.5)" },
];

const XP_BGTYPES = [
  { id: "default", name: "Default", cost: 0,    bg: "linear-gradient(120deg, #5B7FFF 0%, #7F7DFF 55%, #9B7BFF 100%)" },
  { id: "cosmic",  name: "Cosmic",  cost: 200,  bg: "linear-gradient(135deg, #0d0221 0%, #1a0533 50%, #0d1b2a 100%)" },
  { id: "matrix",  name: "Matrix",  cost: 300,  bg: "linear-gradient(135deg, #001100 0%, #003300 50%, #001a00 100%)" },
  { id: "sunset",  name: "Sunset",  cost: 400,  bg: "linear-gradient(135deg, #ff6b35 0%, #f7c948 50%, #e8506a 100%)" },
  { id: "ocean",   name: "Ocean",   cost: 500,  bg: "linear-gradient(135deg, #0575e6 0%, #021b79 100%)" },
];

// Animated auras — apply behind the avatar. Cost rises with visual complexity.
const XP_AURAS: { id: string; name: string; cost: number; preview: React.CSSProperties; anim?: string }[] = [
  { id: "none",      name: "None",      cost: 0,    preview: { background: "transparent" } },
  { id: "pulse",     name: "Pulse",     cost: 75,   preview: { background: "radial-gradient(circle, oklch(0.60 0.22 264 / 0.6) 0%, transparent 70%)" }, anim: "auraPulse 2s ease-in-out infinite" },
  { id: "sparkle",   name: "Sparkle",   cost: 200,  preview: { background: "conic-gradient(from 0deg, #fde68a, #fbbf24, #fde68a)" }, anim: "auraSpin 4s linear infinite" },
  { id: "orbit",     name: "Orbit",     cost: 400,  preview: { background: "transparent", border: "2px dashed oklch(0.65 0.20 308 / 0.7)" }, anim: "auraSpin 6s linear infinite" },
  { id: "lightning", name: "Lightning", cost: 800,  preview: { background: "linear-gradient(45deg, #38bdf8, #818cf8, #c084fc)" }, anim: "auraFlicker 0.8s steps(3, end) infinite" },
  { id: "cosmic",    name: "Cosmic",    cost: 1500, preview: { background: "conic-gradient(from 90deg, #f0abfc, #818cf8, #34d399, #fbbf24, #f0abfc)" }, anim: "auraSpin 8s linear infinite, auraPulse 3s ease-in-out infinite" },
  { id: "galaxy",    name: "Galaxy",    cost: 3000, preview: { background: "radial-gradient(circle at 30% 30%, #f472b6 0%, transparent 30%), radial-gradient(circle at 70% 70%, #60a5fa 0%, transparent 35%), radial-gradient(circle at 50% 50%, #1e1b4b 0%, #000 80%)" }, anim: "auraSpin 12s linear infinite, auraPulse 4s ease-in-out infinite" },
];

const ACHIEVEMENTS: { id: string; Icon: React.ComponentType<{ size?: number; color?: string }>; name: string; desc: string; unlocked: boolean; rarity: string }[] = [
  { id: "first",     Icon: Trophy,  name: "First Blood",     desc: "First successful submission",     unlocked: true,  rarity: "common" },
  { id: "streak7",   Icon: Flame,   name: "Week Warrior",    desc: "7-day coding streak",              unlocked: true,  rarity: "rare" },
  { id: "perfect10", Icon: Gem,     name: "Perfectionist",   desc: "10 perfect score submissions",    unlocked: true,  rarity: "epic" },
  { id: "speed",     Icon: Zap,     name: "Speed Coder",     desc: "Submit in under 5 minutes",       unlocked: true,  rarity: "rare" },
  { id: "500lines",  Icon: PenLine, name: "Prolific Writer", desc: "500+ lines of code written",      unlocked: false, rarity: "rare" },
  { id: "collab",    Icon: Users,   name: "Team Player",     desc: "Edit in a session with 5+ peers", unlocked: false, rarity: "epic" },
  { id: "legend",    Icon: Crown,   name: "Legendary",       desc: "Reach Level 20",                  unlocked: false, rarity: "legendary" },
  { id: "nocopy",    Icon: Star,    name: "Original",        desc: "0% plagiarism on all work",       unlocked: true,  rarity: "common" },
];
const RARITY_COLOR: Record<string, string> = {
  common: "#94a3b8", rare: "#818cf8", epic: "oklch(0.60 0.22 308)", legendary: "#fbbf24",
};

// ─── Dashboard view ─────────────────────────────────────────────────────────

interface DashboardViewProps {
  user: any;
  groups: any[];
  groupClassrooms: Record<string, any[]>;
  activeCounts: Record<string, number>;
  canCreate: boolean;
  effectiveRole: string;
  isAdmin: boolean;
  xp: number | null;
  activityDays: { date: string; count: number }[];
  onCreateGroup: () => void;
  onJoinGroup: () => void;
  onOpenClassroom: (c: any) => void;
  onOpenWorkspace: () => void;
  cosmetics: { frame?: string; background?: string; aura?: string };
  onSaveCosmetics: (next: { frame?: string; background?: string; aura?: string }) => void;
}

const DashboardView: React.FC<DashboardViewProps> = ({ user, groups, groupClassrooms, activeCounts, canCreate, effectiveRole, isAdmin, xp, activityDays, onCreateGroup, onJoinGroup, onOpenClassroom, onOpenWorkspace, cosmetics, onSaveCosmetics }) => {
  const { t } = useTranslation();
  // All hooks declared up front. Calling a hook only on one branch (e.g. inside
  // the student branch below) violates React's Rules of Hooks: the hook count
  // must be identical on every render. Toggling admin's view-as-role would
  // cross that boundary and crash the tree → blank screen.
  const [shopOpen, setShopOpen] = useState(false);

  // derive flat classroom list for teacher
  const allClassrooms = groups.flatMap(g => (groupClassrooms[g.id] || []).map((c: any) => ({ ...c, groupName: g.name, invite_code: g.invite_code, active: activeCounts[c.id] || 0, studentCount: g.member_count || 0 })));
  // student: assignments across all classrooms
  // member_count from backend already excludes the group owner (teacher).
  const totalStudents = groups.reduce((sum, g) => sum + (g.member_count || 0), 0);

  if (effectiveRole === "teacher") {
    const teacherStats = [
      { label: t("app.dashboard.teacher.statClassrooms"),      value: String(allClassrooms.length), iconPath: "M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253", color: "var(--indigo)" },
      { label: t("app.dashboard.teacher.statTotalStudents"),  value: String(totalStudents),        iconPath: "M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z", color: "oklch(0.55 0.22 308)" },
      { label: t("app.dashboard.teacher.statLiveNow"),  value: String(allClassrooms.reduce((s: number, c: any) => s + (c.active || 0), 0)), iconPath: "M13 10V3L4 14h7v7l9-11h-7z", color: "var(--mint)", live: true },
      { label: t("app.dashboard.teacher.statPendingReviews"), value: "—",                          iconPath: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4", color: "var(--amber)" },
    ];

    if (groups.length === 0) {
      return (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", background: "var(--bg-2)" }}>
          <div style={{ textAlign: "center", maxWidth: 320 }}>
            <div style={{ width: 56, height: 56, borderRadius: 16, background: "var(--indigo-muted)", border: "1px solid var(--indigo-20)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 20px" }}>
              <Home className="h-6 w-6" style={{ color: "var(--indigo)" }} />
            </div>
            <h2 style={{ fontSize: 15, fontWeight: 700, marginBottom: 8 }}>{t("app.dashboard.teacher.emptyTitle")}</h2>
            <p style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.6, marginBottom: 20 }}>{t("app.dashboard.teacher.emptyBody")}</p>
            <button onClick={onCreateGroup} style={{ padding: "10px 24px", background: "var(--indigo)", color: "#fff", border: "none", borderRadius: "var(--r)", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>{t("app.dashboard.teacher.emptyButton")}</button>
          </div>
        </div>
      );
    }

    return (
      <div style={{ flex: 1, overflowY: "auto", background: "var(--bg-2)" }}>
        {/* Header */}
        <div style={{ background: "var(--bg)", borderBottom: "1px solid var(--border)", padding: "24px 32px 20px", display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>{user?.name ? t("app.dashboard.teacher.welcomeBackNamed", { name: user.name.split(" ")[0] }) : t("app.dashboard.teacher.welcomeBack")}</h1>
            <p style={{ fontSize: 13, color: "var(--text-3)" }}>{t("app.dashboard.teacher.welcomeSub")}</p>
          </div>
        </div>

        <div style={{ padding: "24px 32px" }}>
          {/* Stat cards */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 32 }}>
            {teacherStats.map(s => (
              <div key={s.label} style={{ background: "var(--bg)", border: "1px solid var(--border)", borderRadius: "var(--r-lg)", boxShadow: "var(--shadow-sm)", padding: "20px 20px 16px" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                  <div style={{ width: 36, height: 36, borderRadius: 10, background: `${s.color}1a`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <svg width="18" height="18" fill="none" stroke={s.color} strokeWidth="1.5" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d={s.iconPath} />
                    </svg>
                  </div>
                  {(s as any).live && (
                    <span style={{ fontSize: 10, fontWeight: 700, color: "var(--mint)", background: "var(--mint-10)", borderRadius: 20, padding: "2px 8px", display: "flex", alignItems: "center", gap: 4 }}>
                      <span style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--mint)", display: "inline-block", animation: "pulseDot 1.4s ease-in-out infinite" }} />
                      {t("app.dashboard.teacher.live")}
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 26, fontWeight: 700, color: s.color, marginBottom: 2 }}>{s.value}</div>
                <div style={{ fontSize: 12, color: "var(--text-3)" }}>{s.label}</div>
              </div>
            ))}
          </div>

          {/* Classrooms grid */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
            <h2 style={{ fontSize: 16, fontWeight: 700 }}>{t("app.dashboard.teacher.classrooms")}</h2>
            {canCreate && (
              <button onClick={onCreateGroup} style={{ fontSize: 12, fontWeight: 600, color: "var(--indigo)", background: "var(--indigo-10)", border: "none", borderRadius: "var(--r)", padding: "6px 14px", cursor: "pointer" }}>{t("app.dashboard.teacher.new")}</button>
            )}
          </div>
          {allClassrooms.length === 0 ? (
            <div style={{ textAlign: "center", padding: "40px 0", fontSize: 13, color: "var(--text-3)" }}>{t("app.dashboard.teacher.noClassrooms")}</div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }}>
              {allClassrooms.map((c: any) => {
                const total = c.studentCount || 0;
                const pct = 0;
                return (
                  <button
                    key={c.id}
                    onClick={() => onOpenClassroom(c)}
                    style={{ background: "var(--bg)", border: "1px solid var(--border)", borderRadius: "var(--r-lg)", boxShadow: "var(--shadow-sm)", padding: 20, textAlign: "left", cursor: "pointer", transition: "border-color 150ms" }}
                    onMouseEnter={e => (e.currentTarget.style.borderColor = "var(--indigo)")}
                    onMouseLeave={e => (e.currentTarget.style.borderColor = "var(--border)")}
                  >
                    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 12 }}>
                      <div style={{ width: 36, height: 36, borderRadius: 10, background: "var(--indigo-muted)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, fontWeight: 700, color: "var(--indigo)" }}>
                        {c.name?.[0]?.toUpperCase() || "C"}
                      </div>
                      {(c.active || 0) > 0 && (
                        <span style={{ fontSize: 10, fontWeight: 700, color: "var(--mint)", background: "var(--mint-10)", borderRadius: 20, padding: "3px 8px", display: "flex", alignItems: "center", gap: 4 }}>
                          <span style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--mint)", display: "inline-block" }} />
                          {t("app.dashboard.teacher.liveCount", { count: c.active })}
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</div>
                    <div style={{ fontSize: 11, color: "var(--text-3)", marginBottom: 12 }}>{c.groupName} · {t("app.dashboard.teacher.studentsCount", { count: total })}</div>
                    {/* Progress bar */}
                    <div>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "var(--text-3)", marginBottom: 4 }}>
                        <span>{t("app.dashboard.teacher.submissions")}</span><span>{pct}%</span>
                      </div>
                      <div style={{ height: 4, background: "var(--bg-3)", borderRadius: 2, overflow: "hidden" }}>
                        <div style={{ height: "100%", width: `${pct}%`, background: "var(--indigo)", borderRadius: 2, transition: "width 600ms ease" }} />
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Student Dashboard ──────────────────────────────────────────────────────
  const selectedFrame = cosmetics.frame || "plain";
  const selectedBg = cosmetics.background || "default";
  const selectedAura = cosmetics.aura || "none";
  const frame = XP_FRAMES.find(f => f.id === selectedFrame) || XP_FRAMES[0];
  const bg = XP_BGTYPES.find(b => b.id === selectedBg) || XP_BGTYPES[0];
  const aura = XP_AURAS.find(a => a.id === selectedAura) || XP_AURAS[0];
  const ownedXp = xp ?? 0;
  // Admin can preview/equip every cosmetic without paying XP — useful for demos and screenshots.
  const canAfford = (cost: number) => isAdmin || ownedXp >= cost;
  const lvlInfo = xp !== null ? xpLevel(xp) : null;
  const xpPct = lvlInfo ? (lvlInfo.next === lvlInfo.prev ? 100 : Math.round(((xp! - lvlInfo.prev) / (lvlInfo.next - lvlInfo.prev)) * 100)) : 0;

  const studentStats = [
    { label: t("app.dashboard.student.statTotalXp"),   value: xp !== null ? `${xp}` : "—",            sub: t("app.dashboard.student.statTotalXpSub"),  color: "var(--indigo)" },
    { label: t("app.dashboard.student.statLevel"),      value: lvlInfo ? String(lvlInfo.level) : "—",   sub: lvlInfo ? t(`app.xp.levels.${lvlInfo.level}`) : "", color: "oklch(0.60 0.22 308)" },
    { label: t("app.dashboard.student.statStreak"),     value: "7",   sub: t("app.dashboard.student.statStreakSub"),    color: "var(--amber)" },
    { label: t("app.dashboard.student.statClassrooms"), value: String(allClassrooms.length), sub: t("app.dashboard.student.statClassroomsSub"), color: "var(--mint)" },
  ];

  if (groups.length === 0) {
    return (
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", background: "var(--bg-2)" }}>
        <div style={{ textAlign: "center", maxWidth: 320 }}>
          <div style={{ width: 56, height: 56, borderRadius: 16, background: "var(--indigo-muted)", border: "1px solid var(--indigo-20)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 20px" }}>
            <Home className="h-6 w-6" style={{ color: "var(--indigo)" }} />
          </div>
          <h2 style={{ fontSize: 15, fontWeight: 700, marginBottom: 8 }}>{t("app.dashboard.student.emptyTitle")}</h2>
          <p style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.6, marginBottom: 20 }}>{t("app.dashboard.student.emptyBody")}</p>
          <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
            <button onClick={onJoinGroup} style={{ padding: "10px 24px", background: "var(--indigo)", color: "#fff", border: "none", borderRadius: "var(--r)", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>{t("app.dashboard.student.emptyButton")}</button>
            <button onClick={onOpenWorkspace} style={{ padding: "10px 24px", background: "transparent", color: "var(--indigo)", border: "1px solid var(--border)", borderRadius: "var(--r)", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>{t("app.workspace.open")}</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, overflowY: "auto", background: "var(--bg-2)" }}>
      {/* Profile hero */}
      <div style={{ background: bg.bg, padding: "28px 32px 24px", position: "relative", overflow: "hidden" }}>
        {/* Decorative orbs */}
        <div style={{ position: "absolute", top: -40, right: -40, width: 200, height: 200, borderRadius: "50%", background: "rgba(255,255,255,0.06)", animation: "orbFloat 6s ease-in-out infinite" }} />
        <div style={{ position: "absolute", bottom: -60, left: "30%", width: 160, height: 160, borderRadius: "50%", background: "rgba(255,255,255,0.04)", animation: "orbFloat 8s ease-in-out infinite 1s" }} />
        <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 20 }}>
          {/* Avatar with XP frame + animated aura */}
          <div style={{ position: "relative", flexShrink: 0, width: 96, height: 96, display: "flex", alignItems: "center", justifyContent: "center" }}>
            {aura.id !== "none" && (
              <div
                aria-hidden
                style={{
                  position: "absolute",
                  inset: 0,
                  borderRadius: "50%",
                  filter: "blur(2px)",
                  opacity: 0.85,
                  animation: aura.anim,
                  ...aura.preview,
                }}
              />
            )}
            <div style={{ position: "relative", width: 72, height: 72, borderRadius: "50%", border: `3px solid ${frame.color}`, boxShadow: frame.glow !== "none" ? frame.glow : undefined, overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(255,255,255,0.15)", fontSize: 24, fontWeight: 700, color: "#fff" }}>
              {user?.name?.[0]?.toUpperCase() || "?"}
            </div>
            <div style={{ position: "absolute", bottom: 8, right: 8, width: 12, height: 12, borderRadius: "50%", background: "var(--mint)", border: "2px solid var(--bg)", animation: "pulseDot 2s ease-in-out infinite" }} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 20, fontWeight: 700, color: "#fff", marginBottom: 2 }}>{user?.name || t("app.dashboard.student.fallbackName")}</div>
            <div style={{ fontSize: 12, color: "rgba(255,255,255,0.7)", marginBottom: 10 }}>{t("app.dashboard.student.xpLine", { title: t(`app.xp.levels.${lvlInfo?.level ?? 1}`), xp: xp ?? 0 })}</div>
            {/* XP bar */}
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ flex: 1, height: 6, background: "rgba(255,255,255,0.2)", borderRadius: 3, overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${xpPct}%`, background: "#fff", borderRadius: 3, transition: "width 600ms ease" }} />
              </div>
              <span style={{ fontSize: 10, color: "rgba(255,255,255,0.6)", fontFamily: "var(--mono)" }}>{xpPct}%</span>
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 }}>
            <button
              onClick={() => setShopOpen(o => !o)}
              style={{ padding: "8px 16px", background: "rgba(255,255,255,0.15)", border: "1px solid rgba(255,255,255,0.3)", borderRadius: "var(--r)", fontSize: 12, fontWeight: 600, color: "#fff", cursor: "pointer", backdropFilter: "blur(4px)" }}
            >
              {shopOpen ? t("app.dashboard.student.closeShop") : t("app.dashboard.student.customize")}
            </button>
          </div>
        </div>
      </div>

      {/* Cosmetics shop */}
      {shopOpen && (
        <div style={{ background: "var(--bg)", borderBottom: "1px solid var(--border)", padding: "20px 32px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 20 }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 10 }}>{t("app.dashboard.student.shopFrame")}</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {XP_FRAMES.map(f => {
                  const locked = !canAfford(f.cost);
                  const isSelected = selectedFrame === f.id;
                  const name = t(`app.xp.frames.${f.id}`);
                  return (
                    <button
                      key={f.id}
                      disabled={locked}
                      onClick={() => onSaveCosmetics({ ...cosmetics, frame: f.id })}
                      style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, padding: "8px 10px", borderRadius: 8, border: `2px solid ${isSelected ? f.color : "var(--border)"}`, background: isSelected ? "var(--bg-2)" : "transparent", cursor: locked ? "not-allowed" : "pointer", opacity: locked ? 0.4 : 1 }}
                      title={locked ? t("app.dashboard.student.locked", { cost: f.cost }) : name}
                    >
                      <div style={{ width: 24, height: 24, borderRadius: "50%", border: `2px solid ${f.color}`, boxShadow: f.glow !== "none" ? f.glow : undefined }} />
                      <span style={{ fontSize: 10, color: "var(--text-3)" }}>{name}</span>
                      {f.cost > 0 && <span style={{ fontSize: 9, color: locked ? "var(--text-3)" : "var(--amber)" }}>{f.cost} XP</span>}
                    </button>
                  );
                })}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 10 }}>{t("app.dashboard.student.shopBackground")}</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {XP_BGTYPES.map(b => {
                  const locked = !canAfford(b.cost);
                  const isSelected = selectedBg === b.id;
                  const name = t(`app.xp.backgrounds.${b.id}`);
                  return (
                    <button
                      key={b.id}
                      disabled={locked}
                      onClick={() => onSaveCosmetics({ ...cosmetics, background: b.id })}
                      style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, padding: "6px 8px", borderRadius: 8, border: `2px solid ${isSelected ? "var(--indigo)" : "var(--border)"}`, background: "transparent", cursor: locked ? "not-allowed" : "pointer", opacity: locked ? 0.4 : 1 }}
                      title={locked ? t("app.dashboard.student.locked", { cost: b.cost }) : name}
                    >
                      <div style={{ width: 32, height: 20, borderRadius: 4, background: b.bg }} />
                      <span style={{ fontSize: 10, color: "var(--text-3)" }}>{name}</span>
                      {b.cost > 0 && <span style={{ fontSize: 9, color: locked ? "var(--text-3)" : "var(--amber)" }}>{b.cost} XP</span>}
                    </button>
                  );
                })}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 10 }}>{t("app.dashboard.student.shopAura")}</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {XP_AURAS.map(a => {
                  const locked = !canAfford(a.cost);
                  const isSelected = selectedAura === a.id;
                  const name = t(`app.xp.auras.${a.id}`);
                  return (
                    <button
                      key={a.id}
                      disabled={locked}
                      onClick={() => onSaveCosmetics({ ...cosmetics, aura: a.id })}
                      style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, padding: "6px 8px", borderRadius: 8, border: `2px solid ${isSelected ? "oklch(0.65 0.20 308)" : "var(--border)"}`, background: "transparent", cursor: locked ? "not-allowed" : "pointer", opacity: locked ? 0.4 : 1, minWidth: 64 }}
                      title={locked ? t("app.dashboard.student.locked", { cost: a.cost }) : name}
                    >
                      <div style={{ width: 28, height: 28, borderRadius: "50%", animation: a.anim, ...a.preview }} />
                      <span style={{ fontSize: 10, color: "var(--text-3)" }}>{name}</span>
                      {a.cost > 0 && <span style={{ fontSize: 9, color: locked ? "var(--text-3)" : "var(--amber)" }}>{a.cost} XP</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      <div style={{ padding: "24px 32px" }}>
        {/* Stat cards */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 28 }}>
          {studentStats.map(s => (
            <div key={s.label} style={{ background: "var(--bg)", border: "1px solid var(--border)", borderRadius: "var(--r-lg)", boxShadow: "var(--shadow-sm)", padding: "18px 20px" }}>
              <div style={{ fontSize: 28, fontWeight: 700, color: s.color, marginBottom: 2 }}>{s.value}</div>
              <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-2)" }}>{s.label}</div>
              <div style={{ fontSize: 11, color: "var(--text-3)" }}>{s.sub}</div>
            </div>
          ))}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: 24 }}>
          <div>
            {/* Achievements */}
            <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>{t("app.dashboard.student.achievements")}</h3>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: 24 }}>
              {ACHIEVEMENTS.map(a => {
                // Admin sees every achievement as unlocked so they can preview
                // the styled "earned" state for screenshots / the demo.
                const unlocked = isAdmin || a.unlocked;
                return (
                <div key={a.id} style={{ background: "var(--bg)", border: `1px solid ${unlocked ? RARITY_COLOR[a.rarity] + "40" : "var(--border)"}`, borderRadius: "var(--r)", padding: "14px 10px", textAlign: "center", opacity: unlocked ? 1 : 0.45 }}>
                  <div style={{ display: "flex", justifyContent: "center", marginBottom: 7 }}>
                    <div style={{ width: 34, height: 34, borderRadius: 10, background: unlocked ? RARITY_COLOR[a.rarity] + "18" : "var(--bg-2)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <a.Icon size={18} color={unlocked ? RARITY_COLOR[a.rarity] : "var(--text-3)"} />
                    </div>
                  </div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: unlocked ? RARITY_COLOR[a.rarity] : "var(--text-3)", marginBottom: 2 }}>{t(`app.xp.achievements.${a.id}.name`)}</div>
                  <div style={{ fontSize: 10, color: "var(--text-3)", lineHeight: 1.4 }}>{t(`app.xp.achievements.${a.id}.desc`)}</div>
                </div>
              );})}
            </div>

            {/* Activity graph */}
            {activityDays.length > 0 && (
              <div>
                <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>{t("app.dashboard.student.activity")}</h3>
                <div style={{ background: "var(--bg)", border: "1px solid var(--border)", borderRadius: "var(--r-lg)", boxShadow: "var(--shadow-sm)", padding: "16px 20px" }}>
                  <ActivityGraph days={activityDays} />
                </div>
              </div>
            )}
          </div>

          {/* Assignments list */}
          <div>
            <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>{t("app.dashboard.student.myClassrooms")}</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <button
                onClick={onOpenWorkspace}
                style={{ background: "var(--indigo-muted)", border: "1px solid var(--indigo-20)", borderRadius: "var(--r)", padding: "12px 14px", textAlign: "left", cursor: "pointer", display: "flex", alignItems: "center", gap: 10 }}
              >
                <div style={{ width: 32, height: 32, borderRadius: 8, background: "var(--indigo)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <svg width="16" height="16" fill="none" stroke="#fff" strokeWidth="1.8" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 6a2 2 0 012-2h12a2 2 0 012 2v12a2 2 0 01-2 2H6a2 2 0 01-2-2V6zm0 3h16" />
                  </svg>
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{t("app.workspace.cardTitle")}</div>
                  <div style={{ fontSize: 11, color: "var(--text-3)" }}>{t("app.workspace.cardBody")}</div>
                </div>
              </button>
              {allClassrooms.map((c: any) => (
                <button
                  key={c.id}
                  onClick={() => onOpenClassroom(c)}
                  style={{ background: "var(--bg)", border: "1px solid var(--border)", borderRadius: "var(--r)", boxShadow: "var(--shadow-sm)", padding: "12px 14px", textAlign: "left", cursor: "pointer", display: "flex", alignItems: "center", gap: 10 }}
                >
                  <div style={{ width: 32, height: 32, borderRadius: 8, background: "var(--indigo-muted)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, color: "var(--indigo)", flexShrink: 0 }}>
                    {c.name?.[0]?.toUpperCase() || "C"}
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</div>
                    <div style={{ fontSize: 11, color: "var(--text-3)" }}>{c.groupName}</div>
                  </div>
                </button>
              ))}
              {allClassrooms.length === 0 && (
                <div style={{ textAlign: "center", padding: "24px 0", fontSize: 12, color: "var(--text-3)" }}>
                  {t("app.dashboard.student.noClassrooms")}{" "}
                  <button onClick={onJoinGroup} style={{ color: "var(--indigo)", background: "none", border: "none", cursor: "pointer", fontWeight: 600, fontSize: 12 }}>{t("app.dashboard.student.joinOne")}</button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// ─── ClassroomView ──────────────────────────────────────────────────────────

interface ClassroomViewProps {
  classroom: any;
  assignments: any[];
  canCreate: boolean;
  userRole: string;
  userId: string;
  submissionsByAssignment: Record<string, any[]>;
  groupMembers: any[];
  activeCount: number;
  onCreateAssignment: () => void;
  onOpenAssignment: (asg: any) => void;
  onBack: () => void;
  onDelete?: () => void;
}

const ClassroomView: React.FC<ClassroomViewProps> = ({
  classroom, assignments, canCreate, userRole, userId,
  submissionsByAssignment, groupMembers, activeCount, onCreateAssignment, onOpenAssignment, onBack, onDelete,
}) => {
  // Set of active user_ids isn't exposed; we just know the count.
  // For the per-student "live" pill we treat counts > 0 as "someone is live" but
  // can't attribute it to specific students without an active-users endpoint.
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<"assignments" | "students">("assignments");

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", background: "var(--bg-2)", overflowY: "auto" }}>
      {/* Header */}
      <div style={{ background: "var(--bg)", borderBottom: "1px solid var(--border)", padding: "20px 32px" }}>
        {/* Breadcrumb */}
        <div style={{ fontSize: 12, color: "var(--text-3)", marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
          <button onClick={onBack} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-3)", fontSize: 12, padding: 0 }}>{t("app.classroom.breadcrumbDashboard")}</button>
          <span>›</span>
          <span>{t("app.classroom.breadcrumbClassrooms")}</span>
          <span>›</span>
          <span style={{ color: "var(--text-2)" }}>{classroom.name}</span>
        </div>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 6 }}>{classroom.name}</h1>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <code style={{ fontFamily: "var(--mono)", background: "var(--bg-2)", border: "1px solid var(--border)", padding: "3px 10px", borderRadius: 6, fontSize: 11, color: "var(--text-2)" }}>
                {t("app.classroom.invite", { code: classroom.invite_code || classroom.code || "—" })}
              </code>
              {activeCount > 0 && (
                <span style={{ fontSize: 11, fontWeight: 600, color: "var(--mint)", background: "var(--mint-10)", borderRadius: 20, padding: "3px 10px", display: "inline-flex", alignItems: "center", gap: 5 }}>
                  <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--mint)", display: "inline-block", animation: "pulseDot 1.4s ease-in-out infinite" }} />
                  {t("app.classroom.liveNow", { count: activeCount })}
                </span>
              )}
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {canCreate && onDelete && (
              <button
                onClick={onDelete}
                title={t("app.classroom.deleteClassroom")}
                style={{ padding: "9px 12px", background: "transparent", color: "var(--text-3)", border: "1px solid var(--border)", borderRadius: "var(--r)", fontSize: 13, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}
                onMouseEnter={e => { e.currentTarget.style.color = "var(--rose)"; e.currentTarget.style.borderColor = "var(--rose)"; }}
                onMouseLeave={e => { e.currentTarget.style.color = "var(--text-3)"; e.currentTarget.style.borderColor = "var(--border)"; }}
              >
                <Trash2 size={14} />
              </button>
            )}
            {canCreate && (
              <button onClick={onCreateAssignment} style={{ padding: "9px 18px", background: "var(--indigo)", color: "#fff", border: "none", borderRadius: "var(--r)", fontSize: 13, fontWeight: 600, cursor: "pointer", flexShrink: 0 }}>
                {t("app.classroom.newAssignment")}
              </button>
            )}
          </div>
        </div>
        {/* Tabs */}
        <div style={{ display: "flex", gap: 0, marginTop: 20, borderBottom: "1px solid var(--border)", marginBottom: -1 }}>
          {(["assignments", "students"] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                padding: "8px 16px", background: "none", border: "none", cursor: "pointer",
                fontSize: 13, fontWeight: 600, textTransform: "capitalize",
                color: activeTab === tab ? "var(--indigo)" : "var(--text-3)",
                borderBottom: activeTab === tab ? "2px solid var(--indigo)" : "2px solid transparent",
                marginBottom: -1,
              }}
            >{tab === "assignments" ? t("app.classroom.tabAssignments") : t("app.classroom.tabStudents")}</button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      <div style={{ flex: 1, padding: "24px 32px" }}>
        {activeTab === "assignments" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {assignments.map(a => {
              const isHw = !!a.due_at;
              const subs = submissionsByAssignment[a.id] || [];
              const submittedCount = subs.length;
              const mySub = userRole === "student" ? (subs.find((s: any) => s.user_id === userId) || null) : null;
              const late = mySub ? isSubmittedLate(mySub.submitted_at, a.due_at) : false;
              const totalMembers = groupMembers.length > 0 ? groupMembers.length : null;
              const pct = totalMembers && submittedCount > 0 ? Math.round((submittedCount / totalMembers) * 100) : 0;

              return (
                <div
                  key={a.id}
                  onClick={() => onOpenAssignment(a)}
                  style={{
                    background: "var(--bg)", border: `1px solid ${isHw ? "var(--indigo-20)" : "var(--border)"}`,
                    borderLeft: isHw ? "3px solid var(--indigo)" : undefined,
                    borderRadius: "var(--r)", padding: "16px 20px", cursor: "pointer",
                    transition: "border-color 120ms",
                  }}
                  onMouseEnter={e => (e.currentTarget.style.borderColor = "var(--indigo)")}
                  onMouseLeave={e => (e.currentTarget.style.borderColor = isHw ? "var(--indigo-20)" : "var(--border)")}
                >
                  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                      {isHw && <span style={{ flexShrink: 0, padding: "1px 7px", fontSize: 10, fontWeight: 700, background: "var(--indigo-muted)", color: "var(--indigo)", borderRadius: 20 }}>{t("app.classroom.hw")}</span>}
                      <span style={{ fontWeight: 600, fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.title}</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
                      {userRole === "teacher" && (
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <svg style={{ transform: "rotate(-90deg)" }} width="22" height="22" viewBox="0 0 20 20">
                            <circle cx="10" cy="10" r="8" fill="none" strokeWidth="2.5" stroke="var(--border)" />
                            <circle cx="10" cy="10" r="8" fill="none" strokeWidth="2.5"
                              stroke={pct >= 100 ? "var(--mint)" : "var(--indigo)"}
                              strokeDasharray={`${2 * Math.PI * 8}`}
                              strokeDashoffset={`${2 * Math.PI * 8 * (1 - pct / 100)}`}
                              strokeLinecap="round"
                            />
                          </svg>
                          <span style={{ fontSize: 11, fontFamily: "var(--mono)", color: pct >= 100 ? "var(--mint)" : "var(--text-3)" }}>{t("app.classroom.submittedCount", { count: submittedCount })}</span>
                        </div>
                      )}
                      {userRole === "student" && mySub && <Badge type={late ? "timeout" : "success"} label={late ? t("app.classroom.submittedLate") : t("app.classroom.submitted")} />}
                      {userRole === "student" && !mySub && <Badge type="not-started" label={t("app.classroom.notStarted")} />}
                    </div>
                  </div>
                  {a.description && <p style={{ marginTop: 6, fontSize: 12, color: "var(--text-3)", lineHeight: 1.5, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>{a.description}</p>}
                  {isHw && (
                    <div style={{ marginTop: 10 }}>
                      <DeadlineBadge dueAt={a.due_at} />
                      {userRole === "teacher" && totalMembers && (
                        <div style={{ marginTop: 8 }}>
                          <div style={{ height: 4, background: "var(--bg-3)", borderRadius: 2, overflow: "hidden" }}>
                            <div style={{ height: "100%", width: `${pct}%`, background: pct >= 100 ? "var(--mint)" : "var(--indigo)", borderRadius: 2 }} />
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
            {assignments.length === 0 && (
              <EmptyState
                icon={<FolderOpen className="h-5 w-5" />}
                title={t("app.classroom.noAssignments")}
                hint={canCreate ? t("app.classroom.noAssignmentsHint") : undefined}
              />
            )}
          </div>
        )}

        {activeTab === "students" && (
          <div>
            <div style={{ fontSize: 13, color: "var(--text-3)", marginBottom: 16 }}>
              {t("app.classroom.studentsEnrolled", { count: groupMembers.length })}
            </div>
            {groupMembers.length === 0 ? (
              <div style={{ textAlign: "center", padding: "48px 0", fontSize: 13, color: "var(--text-3)" }}>{t("app.classroom.noStudents")}</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {groupMembers.map((m: any) => (
                  <div key={m.user_id || m.id} style={{ background: "var(--bg)", border: "1px solid var(--border)", borderRadius: "var(--r)", boxShadow: "var(--shadow-sm)", padding: "12px 16px", display: "flex", alignItems: "center", gap: 12 }}>
                    <div style={{ width: 36, height: 36, borderRadius: "50%", background: "var(--indigo-muted)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, color: "var(--indigo)", flexShrink: 0 }}>
                      {(m.name || m.email || "?")[0].toUpperCase()}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>{m.name || m.email}</div>
                      <div style={{ fontSize: 11, color: "var(--text-3)" }}>{m.email}</div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      {m.online ? (
                        <span style={{ fontSize: 11, fontWeight: 600, color: "var(--mint)", background: "var(--mint-10)", borderRadius: 20, padding: "2px 8px", display: "inline-flex", alignItems: "center", gap: 4 }}>
                          <span style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--mint)", display: "inline-block", animation: "pulseDot 1.4s ease-in-out infinite" }} />
                          {t("app.classroom.live")}
                        </span>
                      ) : (
                        <span style={{ fontSize: 11, color: "var(--text-3)" }}>{t("app.classroom.offline")}</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

// ─── SubmissionDetailPanel ──────────────────────────────────────────────────

interface SubmissionDetailPanelProps {
  submission: any;
  assignmentTitle?: string;
  userRole: string;
  onClose: () => void;
  onOpenInEditor?: () => void;
  onSaveFeedback: (submissionId: string, feedback: string) => Promise<void>;
}

const SUBMISSION_STATUS_STYLE: Record<string, { bg: string; color: string; dot: string }> = {
  success: { bg: "var(--mint-10)",  color: "var(--mint-dim)", dot: "var(--mint)" },
  error:   { bg: "var(--rose-10)",  color: "var(--rose)",          dot: "var(--rose)" },
  timeout: { bg: "var(--amber-10)", color: "var(--amber-dim)",  dot: "var(--amber)" },
};

const SubmissionDetailPanel: React.FC<SubmissionDetailPanelProps> = ({
  submission, assignmentTitle, userRole, onClose, onOpenInEditor, onSaveFeedback,
}) => {
  const { t } = useTranslation();
  const [feedbackDraft, setFeedbackDraft] = useState<string>(submission?.feedback || "");
  const [savingFeedback, setSavingFeedback] = useState(false);

  useEffect(() => {
    setFeedbackDraft(submission?.feedback || "");
  // feedback intentionally excluded — we only reset the draft when switching
  // to a different submission, not on every server-side feedback update
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [submission?.id]);

  const result = (submission.result_json || {}) as Record<string, any>;
  const stdout: string = result.stdout || "";
  const stderr: string = result.stderr || "";
  const returncode = result.returncode;
  const timedOut = result.timed_out === true;
  const testPassed = submission.test_passed ?? result.test_passed ?? null;
  const testOutput: string = result.test_output || "";
  const errorSummary: string | null = submission.error_summary || null;
  const ss = SUBMISSION_STATUS_STYLE[submission.status] || SUBMISSION_STATUS_STYLE.error;

  const handleSave = async () => {
    if (!submission?.id) return;
    setSavingFeedback(true);
    try {
      await onSaveFeedback(submission.id, feedbackDraft);
    } finally {
      setSavingFeedback(false);
    }
  };

  return (
    <div style={{ overflowY: "auto", display: "flex", flexDirection: "column", background: "var(--bg)", height: "100%" }}>
      <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between", background: "var(--bg-2)" }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700 }}>{assignmentTitle || t("app.submissionDetail.fallbackTitle")}</div>
          <div style={{ fontSize: 11, color: "var(--text-3)" }}>
            {submission.submitter_name ? `${submission.submitter_name} · ` : ""}
            {submission.submitted_at ? new Date(submission.submitted_at).toLocaleString() : ""}
          </div>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          {onOpenInEditor && (
            <button
              onClick={onOpenInEditor}
              style={{ padding: "5px 12px", background: "var(--indigo)", color: "#fff", border: "none", borderRadius: "var(--r)", fontSize: 11, fontWeight: 600, cursor: "pointer" }}
            >{t("app.submissionDetail.openInEditor")}</button>
          )}
          <button
            onClick={onClose}
            style={{ padding: "5px 10px", background: "transparent", color: "var(--muted)", border: "1px solid var(--border)", borderRadius: "var(--r)", fontSize: 11, cursor: "pointer" }}
          >✕</button>
        </div>
      </div>

      {/* Runtime info */}
      <div style={{ padding: "12px 20px", borderBottom: "1px solid var(--border)", display: "flex", gap: 16, flexWrap: "wrap", fontSize: 11, color: "var(--text-3)" }}>
        <span style={{ fontWeight: 700, background: ss.bg, color: ss.color, borderRadius: 10, padding: "2px 10px", display: "inline-flex", alignItems: "center", gap: 5 }}>
          <span style={{ width: 5, height: 5, borderRadius: "50%", background: ss.dot, display: "inline-block" }} />
          {submission.status_display || submission.status}
        </span>
        {typeof returncode === "number" && (
          <span><strong style={{ color: "var(--text-2)" }}>{t("app.submissionDetail.exit")}</strong> <code style={{ fontFamily: "var(--mono)" }}>{returncode}</code></span>
        )}
        {timedOut && <span style={{ color: "var(--amber)" }}>{t("app.submissionDetail.timedOut")}</span>}
        {testPassed === true && <span style={{ color: "var(--mint)" }}>{t("app.submissionDetail.testsPassed")}</span>}
        {testPassed === false && <span style={{ color: "var(--rose)" }}>{t("app.submissionDetail.testsFailed")}</span>}
        {testPassed === null && <span>{t("app.submissionDetail.noTests")}</span>}
        <span><strong style={{ color: "var(--text-2)" }}>{t("app.submissionDetail.id")}</strong> <code style={{ fontFamily: "var(--mono)" }}>{String(submission.id).slice(0, 8)}</code></span>
      </div>

      <div style={{ flex: 1, padding: "16px 20px" }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>{t("app.submissionDetail.code")}</div>
        <pre style={{ background: "var(--bg-2)", border: "1px solid var(--border)", borderRadius: "var(--r)", padding: "14px 16px", fontSize: 12, fontFamily: "var(--mono)", color: "var(--text)", overflow: "auto", lineHeight: 1.7, maxHeight: 360, whiteSpace: "pre" }}>
          {submission.code || t("app.submissionDetail.noCode")}
        </pre>

        {stdout && (
          <div style={{ marginTop: 14 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>{t("app.submissionDetail.stdout")}</div>
            <pre style={{ background: "var(--bg-3)", border: "1px solid var(--border)", borderRadius: "var(--r)", padding: "10px 14px", fontSize: 12, fontFamily: "var(--mono)", color: "var(--text-2)", overflow: "auto", lineHeight: 1.6, maxHeight: 180, whiteSpace: "pre-wrap" }}>
              {stdout}
            </pre>
          </div>
        )}

        {stderr && (
          <div style={{ marginTop: 14 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: "var(--rose)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>{t("app.submissionDetail.stderr")}</div>
            <pre style={{ background: "var(--rose-10)", border: "1px solid var(--rose-muted)", borderRadius: "var(--r)", padding: "10px 14px", fontSize: 12, fontFamily: "var(--mono)", color: "var(--rose)", overflow: "auto", lineHeight: 1.6, maxHeight: 240, whiteSpace: "pre-wrap" }}>
              {stderr}
            </pre>
          </div>
        )}

        {!stderr && errorSummary && (
          <div style={{ marginTop: 14, background: "var(--rose-10)", border: "1px solid var(--rose-muted)", borderRadius: "var(--r)", padding: "10px 14px", fontSize: 12, color: "var(--rose)" }}>
            {errorSummary}
          </div>
        )}

        {testOutput && (
          <div style={{ marginTop: 14 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>{t("app.submissionDetail.autoGraderOutput")}</div>
            <pre style={{ background: "var(--bg-3)", border: "1px solid var(--border)", borderRadius: "var(--r)", padding: "10px 14px", fontSize: 12, fontFamily: "var(--mono)", color: testPassed ? "var(--mint)" : "var(--text-2)", overflow: "auto", lineHeight: 1.6, maxHeight: 200, whiteSpace: "pre-wrap" }}>
              {testOutput}
            </pre>
          </div>
        )}

        <div style={{ marginTop: 18, background: "var(--amber-10)", border: "1px solid var(--amber-muted)", borderRadius: "var(--r)", padding: "12px 14px" }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: "var(--amber)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>
            {userRole === "teacher" ? t("app.submissionDetail.feedbackTeacher") : t("app.submissionDetail.feedbackStudent")}
          </div>
          {userRole === "teacher" ? (
            <>
              <textarea
                value={feedbackDraft}
                onChange={e => setFeedbackDraft(e.target.value)}
                placeholder={t("app.submissionDetail.feedbackPlaceholder")}
                rows={4}
                style={{ width: "100%", boxSizing: "border-box", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: "var(--r)", boxShadow: "var(--shadow-sm)", padding: "8px 10px", fontSize: 12, color: "var(--text)", fontFamily: "inherit", resize: "vertical" }}
              />
              <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
                <button
                  onClick={handleSave}
                  disabled={savingFeedback || feedbackDraft === (submission.feedback || "")}
                  style={{ padding: "5px 14px", background: "var(--amber)", color: "#fff", border: "none", borderRadius: "var(--r)", fontSize: 11, fontWeight: 600, cursor: savingFeedback ? "wait" : "pointer", opacity: (savingFeedback || feedbackDraft === (submission.feedback || "")) ? 0.55 : 1 }}
                >
                  {savingFeedback ? t("app.submissionDetail.saving") : t("app.submissionDetail.saveFeedback")}
                </button>
              </div>
            </>
          ) : (
            <p style={{ fontSize: 12, color: "var(--text-2)", lineHeight: 1.6, margin: 0, whiteSpace: "pre-wrap" }}>
              {submission.feedback || <span style={{ color: "var(--text-3)", fontStyle: "italic" }}>{t("app.submissionDetail.noFeedback")}</span>}
            </p>
          )}
        </div>
      </div>
    </div>
  );
};

// ─── SubmissionsView ─────────────────────────────────────────────────────────

interface SubmissionsViewProps {
  classroom: any;
  assignments: any[];
  submissions: any[];
  selectedSubmission: any | null;
  onSelectSubmission: (s: any | null) => void;
  onOpenAssignment: (asg: any) => void;
  onBack: () => void;
  userRole: string;
  onSaveFeedback: (submissionId: string, feedback: string) => Promise<void>;
}

const SubmissionsView: React.FC<SubmissionsViewProps> = ({
  classroom, assignments, submissions, selectedSubmission, onSelectSubmission, onOpenAssignment, onBack, userRole, onSaveFeedback,
}) => {
  const { t } = useTranslation();
  const [filterAssignment, setFilterAssignment] = useState<string>("all");
  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(null);

  const statusStyle = SUBMISSION_STATUS_STYLE;
  // Map a raw submission status to its localized label.
  const statusLabel = (st: string) =>
    st === "success" ? t("app.submissions.statusSuccess")
      : st === "timeout" ? t("app.submissions.statusTimeout")
      : t("app.submissions.statusError");

  const filtered = filterAssignment === "all" ? submissions : submissions.filter(s => s.assignment_id === filterAssignment);

  // Group by student
  const studentMap = new Map<string, { id: string; name: string; email: string; subs: any[] }>();
  for (const s of filtered) {
    const uid = s.user_id || s.user_email || "unknown";
    if (!studentMap.has(uid)) {
      studentMap.set(uid, { id: uid, name: s.user_name || s.user_email || t("common.student"), email: s.user_email || "", subs: [] });
    }
    studentMap.get(uid)!.subs.push(s);
  }
  const students = Array.from(studentMap.values()).sort((a, b) => {
    const lastA = new Date(a.subs[a.subs.length - 1]?.submitted_at || 0).getTime();
    const lastB = new Date(b.subs[b.subs.length - 1]?.submitted_at || 0).getTime();
    return lastB - lastA;
  });

  const activeStudent = selectedStudentId ? studentMap.get(selectedStudentId) || null : null;
  const studentSubs = activeStudent
    ? [...activeStudent.subs].sort((a, b) => new Date(b.submitted_at).getTime() - new Date(a.submitted_at).getTime())
    : [];

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {/* Header */}
      <div style={{ background: "var(--bg)", borderBottom: "1px solid var(--border)", padding: "20px 32px" }}>
        <div style={{ fontSize: 12, color: "var(--text-3)", marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
          <button onClick={onBack} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-3)", fontSize: 12, padding: 0 }}>{t("app.submissions.breadcrumbDashboard")}</button>
          <span>›</span>
          <span>{classroom.name}</span>
          <span>›</span>
          <span style={{ color: "var(--text-2)" }}>{t("app.submissions.breadcrumbSubmissions")}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <h1 style={{ fontSize: 18, fontWeight: 700 }}>{t("app.submissions.title")}</h1>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {["success", "error", "timeout"].map(st => {
              const count = submissions.filter(s => s.status === st).length;
              const ss = statusStyle[st];
              return (
                <span key={st} style={{ fontSize: 11, fontWeight: 600, background: ss.bg, color: ss.color, borderRadius: 20, padding: "3px 10px", display: "inline-flex", alignItems: "center", gap: 5 }}>
                  <span style={{ width: 5, height: 5, borderRadius: "50%", background: ss.dot, display: "inline-block" }} />
                  {count} {statusLabel(st)}
                </span>
              );
            })}
          </div>
        </div>
        {/* Assignment filter */}
        <div style={{ display: "flex", gap: 6, marginTop: 12, flexWrap: "wrap" }}>
          <button
            onClick={() => { setFilterAssignment("all"); setSelectedStudentId(null); onSelectSubmission(null); }}
            style={{ padding: "4px 12px", borderRadius: 20, fontSize: 11, fontWeight: 600, border: "none", cursor: "pointer", background: filterAssignment === "all" ? "var(--indigo)" : "var(--bg-3)", color: filterAssignment === "all" ? "#fff" : "var(--text-3)" }}
          >{t("app.submissions.all")}</button>
          {assignments.map(a => (
            <button
              key={a.id}
              onClick={() => { setFilterAssignment(a.id); setSelectedStudentId(null); onSelectSubmission(null); }}
              style={{ padding: "4px 12px", borderRadius: 20, fontSize: 11, fontWeight: 600, border: "none", cursor: "pointer", background: filterAssignment === a.id ? "var(--indigo)" : "var(--bg-3)", color: filterAssignment === a.id ? "#fff" : "var(--text-3)", maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
            >{a.title}</button>
          ))}
        </div>
      </div>

      {/* 3-col split: students | history | detail */}
      <div style={{ flex: 1, display: "grid", gridTemplateColumns: activeStudent ? (selectedSubmission ? "220px 280px 1fr" : "220px 1fr") : "220px 1fr", overflow: "hidden", transition: "grid-template-columns 200ms ease" }}>

        {/* Col 1: student list */}
        <div style={{ borderRight: "1px solid var(--border)", overflowY: "auto", background: "var(--bg-2)" }}>
          <div style={{ padding: "10px 12px 6px", borderBottom: "1px solid var(--border)" }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: "var(--subtle)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
              {t("app.submissions.studentsCount", { count: students.length })}
            </span>
          </div>
          {students.length === 0 ? (
            <EmptyState icon={<Inbox className="h-5 w-5" />} title={t("app.submissions.noSubmissions")} />
          ) : (
            students.map(stu => {
              const latestSub = stu.subs.reduce((a: any, b: any) => new Date(a.submitted_at) > new Date(b.submitted_at) ? a : b, stu.subs[0]);
              const solvedCount = stu.subs.filter((s: any) => s.status === "success").length;
              const ss = statusStyle[latestSub?.status] || statusStyle.error;
              const isActive = selectedStudentId === stu.id;
              return (
                <button
                  key={stu.id}
                  onClick={() => { setSelectedStudentId(stu.id); onSelectSubmission(null); }}
                  style={{
                    display: "block", width: "100%", padding: "12px 14px",
                    background: isActive ? "var(--indigo-10)" : "transparent",
                    border: "none", borderBottom: "1px solid var(--border)", cursor: "pointer", textAlign: "left",
                    borderLeft: isActive ? "3px solid var(--indigo)" : "3px solid transparent",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                    <Avatar name={stu.name} size={24} />
                    <span style={{ fontSize: 12, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{stu.name}</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", paddingLeft: 32 }}>
                    <span style={{ fontSize: 10, color: "var(--text-3)" }}>
                      {t("app.submissions.attempts", { count: stu.subs.length })}
                      {solvedCount > 0 && <span style={{ color: "var(--mint)", marginLeft: 4 }}>· {solvedCount} ✓</span>}
                    </span>
                    <span style={{ fontSize: 10, fontWeight: 700, background: ss.bg, color: ss.color, borderRadius: 10, padding: "1px 6px", display: "inline-flex", alignItems: "center", gap: 3 }}>
                      <span style={{ width: 4, height: 4, borderRadius: "50%", background: ss.dot, display: "inline-block" }} />
                      {latestSub?.status ? statusLabel(latestSub.status) : ""}
                    </span>
                  </div>
                </button>
              );
            })
          )}
        </div>

        {/* Col 2: selected student's submission log */}
        {!activeStudent ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "var(--bg)", gap: 8 }}>
            <svg width="32" height="32" fill="none" stroke="var(--border-2)" strokeWidth="1.5" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            <span style={{ fontSize: 13, color: "var(--text-3)" }}>{t("app.submissions.selectStudent")}</span>
          </div>
        ) : (
          <div style={{ borderRight: selectedSubmission ? "1px solid var(--border)" : "none", overflowY: "auto", background: "var(--bg)" }}>
            {/* Student header */}
            <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)", background: "var(--bg-2)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
                <Avatar name={activeStudent.name} size={32} />
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700 }}>{activeStudent.name}</div>
                  {activeStudent.email && <div style={{ fontSize: 11, color: "var(--text-3)" }}>{activeStudent.email}</div>}
                </div>
              </div>
              <div style={{ display: "flex", gap: 12, marginTop: 8, paddingLeft: 42 }}>
                <span style={{ fontSize: 11, color: "var(--text-3)" }}><span style={{ fontWeight: 600, color: "var(--text-2)" }}>{studentSubs.length}</span> {t("app.submissions.attemptsLabel")}</span>
                <span style={{ fontSize: 11, color: "var(--text-3)" }}><span style={{ fontWeight: 600, color: "var(--mint)" }}>{studentSubs.filter(s => s.status === "success").length}</span> {t("app.submissions.solvedLabel")}</span>
              </div>
            </div>

            {/* Submission timeline */}
            <div style={{ padding: "12px 0" }}>
              {studentSubs.map((s, idx) => {
                const ss = statusStyle[s.status] || statusStyle.error;
                const asg = assignments.find(a => a.id === s.assignment_id);
                const isSelected = selectedSubmission?.id === s.id;
                return (
                  <button
                    key={s.id}
                    onClick={() => onSelectSubmission(isSelected ? null : s)}
                    style={{
                      display: "block", width: "100%", padding: "10px 20px",
                      background: isSelected ? "var(--indigo-10)" : "transparent",
                      border: "none", borderBottom: "1px solid var(--border)", cursor: "pointer", textAlign: "left",
                      borderLeft: isSelected ? "3px solid var(--indigo)" : "3px solid transparent",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 3 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{ fontSize: 10, color: "var(--subtle)", fontFamily: "var(--mono)" }}>#{studentSubs.length - idx}</span>
                        <span style={{ fontSize: 12, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 160 }}>
                          {asg?.title || t("app.submissions.unknownAssignment")}
                        </span>
                      </div>
                      <span style={{ fontSize: 10, fontWeight: 700, background: ss.bg, color: ss.color, borderRadius: 10, padding: "1px 7px", display: "inline-flex", alignItems: "center", gap: 3, flexShrink: 0 }}>
                        <span style={{ width: 4, height: 4, borderRadius: "50%", background: ss.dot, display: "inline-block" }} />
                        {statusLabel(s.status)}
                      </span>
                    </div>
                    <div style={{ fontSize: 10, color: "var(--border-2)", marginTop: 1 }}>
                      {s.submitted_at ? new Date(s.submitted_at).toLocaleString() : ""}
                    </div>
                    {s.output && (
                      <div style={{ marginTop: 5, fontSize: 10, fontFamily: "var(--mono)", color: s.status === "success" ? "var(--mint)" : "var(--rose)", background: "var(--bg-2)", padding: "4px 8px", borderRadius: 6, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {s.output.split("\n")[0]}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Col 3: submission detail */}
        {selectedSubmission && (
          <SubmissionDetailPanel
            submission={selectedSubmission}
            assignmentTitle={assignments.find(a => a.id === selectedSubmission.assignment_id)?.title}
            userRole={userRole}
            onClose={() => onSelectSubmission(null)}
            onOpenInEditor={() => {
              const a = assignments.find(x => x.id === selectedSubmission.assignment_id);
              if (a) onOpenAssignment(a);
            }}
            onSaveFeedback={onSaveFeedback}
          />
        )}
      </div>
    </div>
  );
};

// ─── AssignmentView ─────────────────────────────────────────────────────────

interface AssignmentViewProps {
  assignment: any;
  isWorkspace?: boolean;
  code: string;
  setCode: (c: string) => void;
  roomId?: string;
  drawingRoomId?: string;
  userName?: string;
  userRole?: string;
  userId: string;
  groupMembers: any[];
  files: EditorFile[];
  activeFileId: string | null;
  onSelectFile: (id: string) => void;
  onAddFile: () => void;
  submissions: any[];
  selectedSubmission: any | null;
  onSelectSubmission: (s: any | null) => void;
  loading: boolean;
  onSubmit: (stdinLines: string[]) => void;
  onBack: () => void;
  onSaveFeedback: (submissionId: string, feedback: string) => Promise<void>;
  failedAttempts: number;
  hint: string | null;
  hintLoading: boolean;
  onGetHint: () => void;
  onDismissHint: () => void;
  legacyDraft?: string | null;
  onDismissLegacyDraft?: () => void;
  xp?: number | null;
}

type StreamLine = { id: number; text: string; type: "stdout" | "stderr" | "info" };

const AssignmentView: React.FC<AssignmentViewProps> = ({
  assignment, isWorkspace = false, code, setCode, roomId, drawingRoomId,
  userName, userRole, userId, groupMembers, files, activeFileId,
  onSelectFile, onAddFile,
  submissions, selectedSubmission, onSelectSubmission, loading,
  onSubmit, onBack, onSaveFeedback,
  failedAttempts, hint, hintLoading, onGetHint, onDismissHint, xp,
  legacyDraft, onDismissLegacyDraft,
}) => {
  const { t } = useTranslation();
  const [editorMode, setEditorMode] = useState<"code" | "draw">("code");
  const [handRaised, setHandRaised] = useState(false);
  const [rightOpen, setRightOpen] = useState(true);
  const [peers, setPeers] = useState<PeerInfo[]>([]);
  const [showLegacy, setShowLegacy] = useState(false);
  const [legacyCopied, setLegacyCopied] = useState(false);
  const isHomework = !!assignment.due_at;

  // Streaming terminal state
  const [streamLines, setStreamLines] = useState<StreamLine[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [terminalHeight, setTerminalHeight] = useState(176);
  const [lastRunInfo, setLastRunInfo] = useState<{ exitCode: number; elapsed: number } | null>(null);
  const [pyLoading, setPyLoading] = useState(false);
  // Interactive stdin: awaitingInput is true while the running program is
  // blocked on input(); the user types into a terminal input line.
  const [awaitingInput, setAwaitingInput] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const terminalRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // The program currently running in the browser's Python worker.
  const runRef = useRef<RunHandle | null>(null);
  // Output arrives in many small chunks; buffer and flush once per frame so a
  // print-heavy loop doesn't re-render the terminal thousands of times.
  const pendingOutRef = useRef<{ text: string; type: StreamLine["type"] }[]>([]);
  const flushFrameRef = useRef<number | null>(null);
  // Inputs the student typed at input() prompts during the interactive Run.
  // Replayed as stdin when submitting so grading sees the same input the
  // student tested with — otherwise input() programs get an empty stdin and
  // are wrongly flagged as failed.
  const collectedInputsRef = useRef<string[]>([]);
  const lineId = useRef(0);
  const runCount = useRef(0);
  const dragStateRef = useRef<{ startY: number; startH: number } | null>(null);

  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [streamLines, awaitingInput]);

  // Focus the terminal input line as soon as the program asks for input.
  useEffect(() => {
    if (awaitingInput) inputRef.current?.focus();
  }, [awaitingInput]);

  // Stop any running program when leaving the assignment.
  useEffect(() => {
    return () => {
      runRef.current?.stop();
      if (flushFrameRef.current !== null) cancelAnimationFrame(flushFrameRef.current);
    };
  }, []);

  // Begin downloading Pyodide as soon as the assignment view mounts so the
  // first Run feels instant.
  useEffect(() => {
    warmupPyodide();
    const off = onPyodideProgress((e) => {
      if (e.kind === "loading") setPyLoading(true);
      if (e.kind === "ready" || e.kind === "failed") setPyLoading(false);
    });
    return off;
  }, []);

  const flushOutput = () => {
    flushFrameRef.current = null;
    const pending = pendingOutRef.current;
    if (pending.length === 0) return;
    pendingOutRef.current = [];
    // Merge consecutive chunks of the same stream into one line entry.
    const merged: { text: string; type: StreamLine["type"] }[] = [];
    for (const p of pending) {
      const last = merged[merged.length - 1];
      if (last && last.type === p.type) last.text += p.text;
      else merged.push({ ...p });
    }
    setStreamLines(prev => [...prev, ...merged.map(m => ({ id: lineId.current++, text: m.text, type: m.type }))]);
  };

  const endsWithNewlineRef = useRef(true);
  const appendLine = (text: string, type: StreamLine["type"]) => {
    if (text) endsWithNewlineRef.current = text.endsWith("\n");
    pendingOutRef.current.push({ text, type });
    if (flushFrameRef.current === null) flushFrameRef.current = requestAnimationFrame(flushOutput);
  };

  // Run the code in the browser (Pyodide in a Web Worker). Nothing is sent to
  // the server. When the program calls input(), the terminal shows an input
  // line and the program waits until the student presses Enter.
  const handleRun = () => {
    if (isRunning) return;

    runCount.current += 1;
    const thisRun = runCount.current;
    if (thisRun === 1) {
      setStreamLines([]);
    } else {
      const lead = endsWithNewlineRef.current ? "" : "\n";
      appendLine(`${lead}${t("app.assignment.runSeparator", { n: thisRun })}\n`, "info");
    }
    setIsRunning(true);
    setLastRunInfo(null);
    setAwaitingInput(false);
    setInputValue("");
    // Fresh run: start collecting this run's input() lines from scratch.
    collectedInputsRef.current = [];

    const handle = startRun({
      code,
      onOutput: e => appendLine(e.text, e.type),
      onInputRequest: () => setAwaitingInput(true),
    });
    runRef.current = handle;
    void handle.done.then(result => {
      if (runRef.current !== handle) return;
      runRef.current = null;
      setLastRunInfo({ exitCode: result.exit_code, elapsed: result.elapsed });
      setIsRunning(false);
      setAwaitingInput(false);
    });
  };

  // Send the current input line to the running program and echo it locally
  // so the terminal reads like one continuous session.
  const submitInput = () => {
    const handle = runRef.current;
    if (!handle || !awaitingInput) return;
    handle.sendInput(inputValue);
    appendLine(inputValue + "\n", "stdout");
    // Remember this line so it can be replayed as stdin on submit.
    collectedInputsRef.current.push(inputValue);
    setInputValue("");
    setAwaitingInput(false);
  };

  // Interrupts the program (like Ctrl+C); the worker is replaced if it hangs.
  const handleStop = () => {
    if (!isRunning) return;
    runRef.current?.stop();
    appendLine("^C\n", "stderr");
    setAwaitingInput(false);
  };

  const handleTerminalDragStart = (e: React.MouseEvent) => {
    e.preventDefault();
    dragStateRef.current = { startY: e.clientY, startH: terminalHeight };
    const onMove = (ev: MouseEvent) => {
      if (!dragStateRef.current) return;
      const delta = dragStateRef.current.startY - ev.clientY;
      setTerminalHeight(Math.max(80, Math.min(500, dragStateRef.current.startH + delta)));
    };
    const onUp = () => {
      dragStateRef.current = null;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  const errorLines = React.useMemo(() => {
    const lines: number[] = [];
    for (const l of streamLines) {
      if (l.type !== "stderr") continue;
      const m = l.text.match(/File ".*?", line (\d+)/);
      if (m) lines.push(parseInt(m[1], 10));
    }
    return lines.length ? lines : undefined;
  }, [streamLines]);

  const showRoster = userRole === "teacher" && isHomework && groupMembers.length > 0;
  const subByUserId = Object.fromEntries(submissions.map((s: any) => [s.user_id, s]));
  const rosterRows = showRoster
    ? groupMembers.map((m: any) => {
        const sub = subByUserId[m.user_id] || null;
        const submitted = !!sub;
        const late = sub ? isSubmittedLate(sub.submitted_at, assignment.due_at) : false;
        return { ...m, sub, submitted, late };
      }).sort((a: any, b: any) => Number(b.submitted) - Number(a.submitted))
    : [];
  const submittedCount = rosterRows.filter((r: any) => r.submitted).length;

  const firstSolverId = React.useMemo(() => {
    const accepted = submissions.filter((s: any) => s.status === "success");
    if (!accepted.length) return null;
    return accepted.reduce((a: any, b: any) =>
      new Date(a.submitted_at) < new Date(b.submitted_at) ? a : b
    ).user_id;
  }, [submissions]);

  const mySub = userRole === "student" ? (submissions.find((s: any) => s.user_id === userId) || null) : null;
  const deadlineUrgency = getDeadlineUrgency(assignment.due_at);

  // Keyboard: ⌘/Ctrl+Enter runs, ⌘/Ctrl+Shift+Enter submits. Captured before
  // CodeMirror (whose default keymap binds Mod-Enter to "insert blank line").
  const shortcutRef = useRef({ run: handleRun, submit: () => onSubmit(collectedInputsRef.current) });
  useEffect(() => {
    shortcutRef.current = { run: handleRun, submit: () => onSubmit(collectedInputsRef.current) };
  });
  const canSubmit = !isWorkspace && !loading;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Enter" || !(e.metaKey || e.ctrlKey) || editorMode !== "code") return;
      e.preventDefault();
      e.stopPropagation();
      if (e.shiftKey) { if (canSubmit) shortcutRef.current.submit(); return; }
      shortcutRef.current.run();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [editorMode, canSubmit]);
  const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
  const modKey = isMac ? "⌘" : "Ctrl+";

  const urgencyStyle = URGENCY_STYLES[deadlineUrgency];
  const myLate = mySub ? isSubmittedLate(mySub.submitted_at, assignment.due_at) : false;
  const panelTitle = showRoster ? t("app.assignment.roster") : t("app.assignment.submissionsPanel");
  const panelCount = showRoster ? `${submittedCount}/${rosterRows.length}` : (submissions.length > 0 ? String(submissions.length) : "");

  const renderRow = (key: string, name: string, sub: any | null, badge: React.ReactNode, dim = false) => {
    const selected = !!sub && selectedSubmission?.id === sub.id;
    return (
      <li key={key}>
        <button
          type="button"
          disabled={!sub}
          onClick={() => sub && onSelectSubmission(selected ? null : sub)}
          className="w-full text-left"
          style={{
            display: "flex", flexDirection: "column", gap: 3,
            padding: "9px 10px", borderRadius: 12, border: "none",
            background: selected ? "var(--bg-3)" : "transparent",
            cursor: sub ? "pointer" : "default",
            opacity: dim ? 0.55 : 1,
            transition: "background-color 140ms var(--ease)",
          }}
          onMouseEnter={e => { if (sub && !selected) e.currentTarget.style.background = "var(--bg-2)"; }}
          onMouseLeave={e => { if (!selected) e.currentTarget.style.background = "transparent"; }}
        >
          <span className="flex items-center justify-between gap-2 w-full">
            <span className="flex items-center gap-2 min-w-0">
              <Avatar name={name} size={24} />
              <span className="text-[13px] font-medium truncate" style={{ color: "var(--text)" }}>
                {name}
                {firstSolverId && sub?.user_id === firstSolverId && sub?.status === "success" && (
                  <span title={t("app.assignment.firstToSolve")} className="ml-1">👑</span>
                )}
              </span>
            </span>
            {badge}
          </span>
          {sub && (
            <span className="text-[11px] pl-8" style={{ color: "var(--text-3)" }}>
              {new Date(sub.submitted_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
            </span>
          )}
        </button>
      </li>
    );
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden" style={{ background: "var(--bg-2)" }}>
      {/* ── Top bar: one row for title, deadline, status, mode, XP ─────── */}
      <header
        className="flex items-center gap-3 px-4 shrink-0"
        style={{ height: 56, background: "var(--bg)", borderBottom: "1px solid var(--border)" }}
      >
        <button type="button" onClick={onBack} className="st-icon-btn" title={t("app.assignment.back").replace(/^←\s*/, "")}>
          <ArrowLeft className="h-4 w-4" />
        </button>
        <h1 className="text-[15px] font-semibold truncate" style={{ color: "var(--text)", letterSpacing: "-0.01em" }}>{assignment.title}</h1>

        {isHomework && (
          <span
            className="st-chip"
            title={formatDueDate(assignment.due_at)}
            style={{ background: urgencyStyle.bg, color: urgencyStyle.color }}
          >
            <Clock className="h-3.5 w-3.5" />
            {deadlineUrgency === "overdue"
              ? t("app.deadline.overdue")
              : <>{formatDueDate(assignment.due_at)} <span style={{ opacity: 0.7, fontWeight: 500 }}>· {formatTimeRemaining(assignment.due_at)}</span></>}
          </span>
        )}
        {isHomework && userRole === "student" && mySub && (
          <span className="st-chip" style={{ background: myLate ? "var(--amber-10)" : "var(--mint-10)", color: myLate ? "var(--amber-dim)" : "var(--mint-dim)" }}>
            <Check className="h-3.5 w-3.5" />
            {myLate ? t("app.classroom.submittedLate") : t("app.classroom.submitted")}
          </span>
        )}
        {isHomework && userRole === "teacher" && (
          <span className="st-chip">
            <Users className="h-3.5 w-3.5" style={{ color: "var(--text-3)" }} />
            {groupMembers.length > 0
              ? t("app.assignment.submittedRatio", { submitted: submittedCount, total: groupMembers.length })
              : t("app.assignment.submittedRatioUnknown", { submitted: submittedCount })}
          </span>
        )}

        <div className="flex-1" />

        <div className="st-seg" role="group" aria-label="Mode">
          {(["code", "draw"] as const).map(mode => (
            <button key={mode} type="button" aria-pressed={editorMode === mode} onClick={() => setEditorMode(mode)} className="capitalize">
              {mode === "code" ? <Code2 className="h-3.5 w-3.5" /> : <PenLine className="h-3.5 w-3.5" />}
              {mode === "code" ? t("app.assignment.modeCode") : t("app.assignment.modeDraw")}
            </button>
          ))}
        </div>

        {userRole === "student" && xp != null && (
          <span className="st-chip" style={{ background: "var(--amber-10)", color: "var(--amber-dim)" }}>
            <Zap className="h-3.5 w-3.5" style={{ color: "var(--amber)" }} />
            {t("app.assignment.xp", { xp })}
          </span>
        )}
      </header>

      <div className="flex flex-1 min-h-0 gap-3 p-3">
        {/* ── Editor column ───────────────────────────────────────────── */}
        <div className="flex-1 flex flex-col min-w-0 min-h-0">
          {legacyDraft && (
            <div
              className="st-fade-up flex flex-wrap items-center gap-3 mb-3 px-4 py-2.5 rounded-[14px] text-[13px]"
              style={{ background: "var(--amber-10)", border: "1px solid var(--amber-muted)", color: "var(--text-2)" }}
            >
              <span className="flex-1 min-w-[200px]">{t("app.assignment.legacyDraftFound")}</span>
              <button type="button" className="st-btn st-btn-secondary st-btn-sm" onClick={() => setShowLegacy(true)}>{t("app.assignment.legacyDraftView")}</button>
              <button type="button" className="st-btn st-btn-ghost st-btn-sm" onClick={onDismissLegacyDraft}>{t("app.assignment.dismiss")}</button>
            </div>
          )}
          <section className="st-card flex-1 min-h-0 flex flex-col overflow-hidden">
            {/* Toolbar: files on the left, actions on the right (code mode only —
                the whiteboard carries its own floating toolbar) */}
            <div className={`${editorMode === "code" ? "flex" : "hidden"} items-center gap-2 px-2 shrink-0`} style={{ height: 48, borderBottom: "1px solid var(--border)" }}>
              {editorMode === "code" ? (
                <div className="flex items-center gap-1 min-w-0 overflow-x-auto" role="tablist">
                  {files.map(f => (
                    <button
                      key={f.id}
                      type="button"
                      role="tab"
                      aria-selected={activeFileId === f.id}
                      onClick={() => onSelectFile(f.id)}
                      className="st-tab"
                    >
                      <span className="st-tab-dot" />
                      {f.name}
                    </button>
                  ))}
                  <button type="button" onClick={onAddFile} className="st-icon-btn" style={{ width: 28, height: 28 }} title={t("app.modals.newFileTitle")}>
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                </div>
              ) : (
                <span className="px-2 text-[13px] font-semibold" style={{ color: "var(--text-2)" }}>{t("app.assignment.modeDraw")}</span>
              )}

              <div className="flex-1" />

              {/* Who's in this file — compact avatar stack instead of a whole row */}
              {peers.length > 0 && (
                <div
                  className="flex items-center pr-1 shrink-0"
                  title={peers.map(p => p.name + (p.handRaised ? " ✋" : "")).join("\n")}
                >
                  {peers.slice(0, 5).map((p, i) => (
                    <span
                      key={p.clientId}
                      className="grid place-items-center rounded-full text-[10px] font-bold text-white"
                      style={{
                        width: 24, height: 24, marginLeft: i === 0 ? 0 : -6,
                        background: p.color,
                        border: "2px solid var(--bg)",
                        boxShadow: p.handRaised ? "0 0 0 2px var(--amber)" : undefined,
                        zIndex: 10 - i,
                      }}
                    >
                      {(p.name.replace(/^(Teacher|Student)\s+/, "").trim()[0] || "?").toUpperCase()}
                    </span>
                  ))}
                  {peers.length > 5 && (
                    <span className="st-chip" style={{ height: 22, fontSize: 11, marginLeft: 4, padding: "0 7px" }}>+{peers.length - 5}</span>
                  )}
                </div>
              )}

              {editorMode === "code" && (
                <div className="flex items-center gap-2 shrink-0">
                  {userRole === "student" && !isWorkspace && (
                    <button
                      type="button"
                      onClick={() => setHandRaised(v => !v)}
                      className={`st-btn st-btn-sm ${handRaised ? "st-btn-warn" : "st-btn-ghost"}`}
                      aria-pressed={handRaised}
                    >
                      {handRaised
                        ? <span className="h-2 w-2 rounded-full" style={{ background: "var(--amber)", animation: "pulseDot 1.6s ease-in-out infinite" }} />
                        : <LifeBuoy className="h-3.5 w-3.5" />}
                      {handRaised ? t("app.assignment.handRaised") : t("app.assignment.askForHelp")}
                    </button>
                  )}
                  {isRunning ? (
                    <button type="button" onClick={handleStop} className="st-btn st-btn-secondary" style={{ color: "var(--rose)" }}>
                      <Square className="h-3 w-3" fill="currentColor" />
                      {t("app.assignment.stop")}
                    </button>
                  ) : (
                    <button type="button" onClick={handleRun} className={`st-btn ${isWorkspace ? "st-btn-primary" : "st-btn-secondary"}`} title={`${modKey}↵`}>
                      <Play className="h-3.5 w-3.5" fill="currentColor" />
                      {t("app.assignment.run")}
                      <kbd className="st-kbd">{modKey}↵</kbd>
                    </button>
                  )}
                  {!isWorkspace && (
                    <button
                      type="button"
                      onClick={() => onSubmit(collectedInputsRef.current)}
                      disabled={loading}
                      className="st-btn st-btn-primary"
                      title={`${modKey}⇧↵`}
                    >
                      {loading
                        ? <span className="h-3.5 w-3.5 rounded-full border-2 animate-spin" style={{ borderColor: "currentColor", borderTopColor: "transparent" }} />
                        : <Check className="h-3.5 w-3.5" strokeWidth={2.5} />}
                      {isHomework ? t("app.assignment.submitHomework") : t("app.assignment.submit")}
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Editor / canvas */}
            <div className="flex-1 min-h-0 overflow-hidden" style={{ background: "var(--editor-bg)" }}>
              <div className={editorMode === "code" ? "h-full" : "hidden"}>
                <CodeEditor
                  key={activeFileId || "single-file"}
                  value={code}
                  onChange={setCode}
                  roomId={roomId}
                  userName={userName}
                  userRole={userRole}
                  handRaised={handRaised}
                  errorLines={errorLines}
                  onPeersChange={setPeers}
                  showPresence={false}
                />
              </div>
              <div className={editorMode === "draw" ? "h-full" : "hidden"}>
                <DrawingCanvas roomId={drawingRoomId} userName={userName} userRole={userRole} className="h-full" />
              </div>
            </div>
          </section>

          {/* Hint callout — appears once a student is visibly stuck */}
          {editorMode === "code" && userRole === "student" && failedAttempts >= 3 && (
            <div
              className="st-fade-up flex items-start gap-3 mt-3 px-4 py-3 rounded-[16px]"
              style={{ background: "var(--amber-10)", border: "1px solid var(--amber-muted)" }}
            >
              <span className="grid place-items-center h-7 w-7 rounded-full shrink-0" style={{ background: "var(--bg)", color: "var(--amber)" }}>
                <Lightbulb className="h-4 w-4" />
              </span>
              {hint ? (
                <div className="flex-1 min-w-0 space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[12px] font-semibold" style={{ color: "var(--amber-dim)" }}>{t("app.assignment.hintLabel")}</span>
                    <button type="button" onClick={onDismissHint} className="st-btn st-btn-ghost st-btn-sm" style={{ height: 24 }}>{t("app.assignment.dismiss")}</button>
                  </div>
                  <p className="text-[13px] leading-relaxed" style={{ color: "var(--text)" }}>{hint}</p>
                  <p className="text-[11px]" style={{ color: "var(--amber-dim)" }}>{t("app.assignment.hintCost")}</p>
                </div>
              ) : (
                <div className="flex-1 flex items-center justify-between gap-3 min-h-[28px]">
                  <span className="text-[13px]" style={{ color: "var(--text-2)" }}>
                    {t("app.assignment.stuckPrompt", { count: failedAttempts })}
                  </span>
                  <button type="button" onClick={onGetHint} disabled={hintLoading} className="st-btn st-btn-secondary st-btn-sm">
                    {hintLoading ? t("app.assignment.thinking") : t("app.assignment.getHint")}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Output */}
          {editorMode === "code" && (
            <>
              <div onMouseDown={handleTerminalDragStart} className="st-grip" role="separator" aria-orientation="horizontal" />
              <section className="st-card flex flex-col shrink-0 overflow-hidden" style={{ height: terminalHeight }}>
                <div className="flex items-center justify-between gap-2 px-3 shrink-0" style={{ height: 38, borderBottom: "1px solid var(--border)" }}>
                  <div className="flex items-center gap-2 min-w-0">
                    <TerminalSquare className="h-3.5 w-3.5" style={{ color: "var(--text-3)" }} />
                    <span className="text-[12px] font-semibold" style={{ color: "var(--text-2)" }}>{t("app.assignment.output")}</span>
                    {isRunning && !awaitingInput && (
                      <span className="st-chip" style={{ height: 20, fontSize: 11, background: "var(--mint-10)", color: "var(--mint-dim)" }}>
                        <span className="h-1.5 w-1.5 rounded-full" style={{ background: "var(--mint)", animation: "pulseDot 1.4s ease-in-out infinite" }} />
                        {t("app.assignment.running")}
                      </span>
                    )}
                    {awaitingInput && (
                      <span className="st-chip" style={{ height: 20, fontSize: 11, background: "var(--amber-10)", color: "var(--amber-dim)" }}>{t("app.assignment.waitingForInput")}</span>
                    )}
                    {pyLoading && (
                      <span className="st-chip" style={{ height: 20, fontSize: 11 }}>{t("app.assignment.downloadingPython")}</span>
                    )}
                    {!isRunning && lastRunInfo !== null && (
                      <span
                        className="st-chip font-mono"
                        style={{ height: 20, fontSize: 11, background: lastRunInfo.exitCode === 0 ? "var(--mint-10)" : "var(--rose-10)", color: lastRunInfo.exitCode === 0 ? "var(--mint-dim)" : "var(--rose)" }}
                      >
                        {t("app.assignment.exitInfo", { code: lastRunInfo.exitCode, elapsed: lastRunInfo.elapsed })}
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => { setStreamLines([]); runCount.current = 0; setLastRunInfo(null); }}
                    className="st-icon-btn"
                    style={{ width: 26, height: 26 }}
                    title={t("app.assignment.clear")}
                  >
                    <Eraser className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div
                  ref={terminalRef}
                  onClick={() => { if (awaitingInput) inputRef.current?.focus(); }}
                  className="flex-1 overflow-auto px-4 py-3 font-mono text-[12.5px] leading-relaxed"
                  style={{ background: "var(--term-bg)" }}
                >
                  {streamLines.length === 0 && !isRunning ? (
                    <span style={{ color: "var(--term-dim)", fontFamily: "var(--font)" }}>
                      {t("app.assignment.terminalEmpty")} <kbd className="st-kbd" style={{ background: "var(--bg-3)", fontFamily: "var(--font)" }}>{modKey}↵</kbd>
                    </span>
                  ) : (
                    <pre className="whitespace-pre-wrap break-words m-0" style={{ color: "var(--term-text)" }}>
                      {streamLines.map(line => (
                        <span
                          key={line.id}
                          style={{
                            color: line.type === "stderr" ? "var(--term-err)" : line.type === "info" ? "var(--term-dim)" : "var(--term-text)",
                            fontStyle: line.type === "info" ? "italic" : undefined,
                          }}
                        >
                          {line.text}
                        </span>
                      ))}
                      {awaitingInput && (
                        <input
                          ref={inputRef}
                          value={inputValue}
                          onChange={e => setInputValue(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === "Enter") { e.preventDefault(); submitInput(); }
                          }}
                          spellCheck={false}
                          autoComplete="off"
                          className="m-0 p-0"
                          style={{
                            background: "transparent",
                            border: "none",
                            outline: "none",
                            color: "var(--term-text)",
                            font: "inherit",
                            caretColor: "var(--editor-caret)",
                            minWidth: "1ch",
                            width: `${Math.max(1, inputValue.length) + 1}ch`,
                          }}
                        />
                      )}
                      {isRunning && !awaitingInput && (
                        <span className="inline-block w-[7px] h-[14px] align-middle rounded-[1px]" style={{ background: "var(--editor-caret)", animation: "pulseDot 1s step-end infinite" }} />
                      )}
                    </pre>
                  )}
                </div>
              </section>
            </>
          )}
        </div>

        {/* ── Right panel: submissions / roster ───────────────────────── */}
        {/* Hidden in the personal workspace — nothing is submitted there. */}
        {!isWorkspace && (rightOpen ? (
          <aside className="st-card flex flex-col shrink-0 overflow-hidden st-fade-up" style={{ width: 280 }}>
            <div className="flex items-center justify-between gap-2 pl-4 pr-2 shrink-0" style={{ height: 48, borderBottom: "1px solid var(--border)" }}>
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-[13px] font-semibold truncate" style={{ color: "var(--text)" }}>{panelTitle}</span>
                {panelCount && (
                  <span
                    className="st-chip font-mono"
                    style={{ height: 20, fontSize: 11, padding: "0 7px", ...(showRoster && submittedCount === rosterRows.length ? { background: "var(--mint-10)", color: "var(--mint-dim)" } : {}) }}
                  >
                    {panelCount}
                  </span>
                )}
              </div>
              <button type="button" onClick={() => setRightOpen(false)} className="st-icon-btn" title={t("app.assignment.collapse")}>
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>

            {showRoster ? (
              <ul className="flex-1 overflow-auto p-1.5">
                {rosterRows.map((row: any) => renderRow(
                  row.user_id,
                  row.name || t("common.student"),
                  row.sub,
                  <Badge type={row.submitted ? (row.late ? "timeout" : "success") : (deadlineUrgency === "overdue" ? "failed" : "not-started")} label={row.submitted ? (row.late ? t("app.assignment.rosterLate") : t("app.assignment.rosterDone")) : t("app.assignment.rosterMissing")} />,
                  !row.sub,
                ))}
              </ul>
            ) : submissions.length === 0 ? (
              <div className="flex-1 overflow-auto">
                <EmptyState
                  icon={<Inbox className="h-5 w-5" />}
                  title={t("app.assignment.noSubmissions")}
                  hint={t("app.assignment.waitingForStudents")}
                />
              </div>
            ) : (
              <ul className="flex-1 overflow-auto p-1.5">
                {submissions.map(s => renderRow(
                  s.id,
                  s.submitter_name || t("app.assignment.unknown"),
                  s,
                  <Badge type={s.status === "success" ? "success" : s.status === "timeout" ? "timeout" : "failed"} label={s.status_display || s.status} />,
                ))}
              </ul>
            )}
          </aside>
        ) : (
          <button
            type="button"
            onClick={() => setRightOpen(true)}
            className="st-card flex flex-col items-center justify-start gap-3 pt-3 shrink-0"
            style={{ width: 44, cursor: "pointer" }}
            title={t("app.assignment.expandPanel")}
          >
            <ChevronLeft className="h-4 w-4" style={{ color: "var(--text-3)" }} />
            <span className="text-[12px] font-semibold" style={{ writingMode: "vertical-rl", color: "var(--text-3)" }}>
              {panelTitle}{panelCount ? ` · ${panelCount}` : ""}
            </span>
          </button>
        ))}
      </div>

      {/* Older browser-only copy of this file */}
      {showLegacy && legacyDraft && (
        <div
          className="st-backdrop"
          onClick={() => setShowLegacy(false)}
          style={{ position: "fixed", inset: 0, zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}
        >
          <div
            onClick={e => e.stopPropagation()}
            className="st-pop-in"
            role="dialog"
            aria-label={t("app.assignment.legacyDraftTitle")}
            style={{ width: "min(720px, 100%)", maxHeight: "85vh", display: "flex", flexDirection: "column", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 22, boxShadow: "var(--shadow-lg)", overflow: "hidden" }}
          >
            <div className="flex items-center justify-between gap-3 px-5 pt-4 pb-3">
              <div>
                <h2 className="text-[16px] font-semibold">{t("app.assignment.legacyDraftTitle")}</h2>
                <p className="text-[12.5px]" style={{ color: "var(--text-3)" }}>{t("app.assignment.legacyDraftHint")}</p>
              </div>
              <button type="button" className="st-icon-btn" onClick={() => setShowLegacy(false)} aria-label={t("common.close")}><X className="h-4 w-4" /></button>
            </div>
            <pre className="mx-5 mb-4 p-4 rounded-[14px] overflow-auto text-[12.5px] leading-relaxed" style={{ background: "var(--bg-2)", border: "1px solid var(--border)", color: "var(--text)" }}>{legacyDraft}</pre>
            <div className="flex justify-end gap-2 px-5 pb-5">
              <button
                type="button"
                className="st-btn st-btn-primary"
                onClick={() => {
                  navigator.clipboard?.writeText(legacyDraft).then(() => setLegacyCopied(true), () => setLegacyCopied(false));
                }}
              >
                {legacyCopied ? t("app.assignment.legacyDraftCopied") : t("app.assignment.legacyDraftCopy")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Submission detail modal */}
      {selectedSubmission && (
        <div
          onClick={() => onSelectSubmission(null)}
          className="st-backdrop"
          style={{ position: "fixed", inset: 0, zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}
        >
          <div
            onClick={e => e.stopPropagation()}
            className="st-pop-in"
            style={{
              width: "min(880px, 100%)", maxHeight: "90vh", display: "flex", flexDirection: "column",
              background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 22, overflow: "hidden",
              boxShadow: "var(--shadow-lg)",
            }}
          >
            <SubmissionDetailPanel
              submission={selectedSubmission}
              assignmentTitle={assignment.title}
              userRole={userRole || "student"}
              onClose={() => onSelectSubmission(null)}
              onSaveFeedback={onSaveFeedback}
            />
          </div>
        </div>
      )}
    </div>
  );
};
