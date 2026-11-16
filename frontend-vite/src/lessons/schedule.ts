/** Schedule helpers shared by the home and group screens. */

import { lessonsApi } from "./api";
import type { Lesson, Schedule, Slot } from "./api";
import { weekdayNames } from "./format";

/** Create the lesson for a scheduled slot (idempotent server-side), then open it. */
export async function lessonForSlot(slot: Slot): Promise<Lesson> {
  return lessonsApi.create(slot.group_id, slot.starts_at);
}

export function scheduleSummary(schedule: Schedule | null, t: (k: string, o?: any) => string): string {
  if (!schedule || schedule.days.length === 0) return t("lessons.group.noSchedule", { defaultValue: "No fixed schedule" });
  const names = weekdayNames();
  return `${schedule.days.map(d => names[d]).join(" · ")} · ${schedule.time}`;
}
