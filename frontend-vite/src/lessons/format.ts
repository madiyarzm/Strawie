import i18n from "../i18n";

const locale = () => {
  const lang = (i18n.language || "en").split("-")[0];
  return lang === "kk" ? "kk-KZ" : lang === "ru" ? "ru-RU" : "en-GB";
};

export const weekdayShort = (iso: string) =>
  new Date(iso).toLocaleDateString(locale(), { weekday: "short" }).replace(".", "");

export const dayNumber = (iso: string) => String(new Date(iso).getDate());

export const timeOf = (iso: string) =>
  new Date(iso).toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit" });

export const dateTime = (iso: string) =>
  new Date(iso).toLocaleString(locale(), { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export const dayMonth = (iso: string) =>
  new Date(iso).toLocaleDateString(locale(), { day: "numeric", month: "short" });

export function isToday(iso: string): boolean {
  const d = new Date(iso), n = new Date();
  return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
}

/** "in 25 min" / "in 3 h" / "in 2 days" / "now", localized. */
export function relative(iso: string): string {
  const diff = new Date(iso).getTime() - Date.now();
  const rtf = new Intl.RelativeTimeFormat(locale(), { numeric: "auto" });
  const mins = Math.round(diff / 60_000);
  if (Math.abs(mins) < 1) return rtf.format(0, "minute");
  if (Math.abs(mins) < 60) return rtf.format(mins, "minute");
  const hours = Math.round(mins / 60);
  if (Math.abs(hours) < 24) return rtf.format(hours, "hour");
  return rtf.format(Math.round(hours / 24), "day");
}

/** Localized short weekday names, Monday first (index = schedule day). */
export function weekdayNames(): string[] {
  const monday = new Date(Date.UTC(2024, 0, 1)); // a Monday
  return Array.from({ length: 7 }, (_, i) =>
    new Date(monday.getTime() + i * 86_400_000).toLocaleDateString(locale(), { weekday: "short", timeZone: "UTC" }).replace(".", ""));
}
