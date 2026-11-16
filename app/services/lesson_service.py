"""
Lessons, schedules and homework.

Permission rules live here so every endpoint uses the same ones:
  * the group's teacher (or an admin) manages lessons and reviews homework;
  * group members see the group's lessons and submit their own homework.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from typing import Iterable, Optional
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.lesson_rooms import is_group_member, is_group_teacher
from app.models.group import Group
from app.models.group_membership import GroupMembership
from app.models.homework_submission import HomeworkSubmission
from app.models.lesson import Lesson
from app.models.user import User


class NotFound(Exception):
    pass


class Forbidden(Exception):
    pass


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def as_utc(value: datetime) -> datetime:
    """SQLite returns naive datetimes; treat those as UTC."""
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


# ── schedule ──────────────────────────────────────────────────────────────


def _zone(name: Optional[str]) -> ZoneInfo:
    try:
        return ZoneInfo(name or "UTC")
    except (ZoneInfoNotFoundError, ValueError):
        return ZoneInfo("UTC")


def schedule_slots(group: Group, start: datetime, end: datetime) -> list[datetime]:
    """Scheduled class times (UTC) in [start, end), from the group's weekly schedule."""
    sched = group.schedule or {}
    days = sched.get("days") or []
    time_str = sched.get("time") or ""
    if not days or len(time_str) != 5:
        return []
    hour, minute = int(time_str[:2]), int(time_str[3:])
    zone = _zone(sched.get("tz"))
    local_start = as_utc(start).astimezone(zone)
    slots = []
    day = local_start.date()
    last = as_utc(end).astimezone(zone).date()
    while day <= last:
        if day.weekday() in days:
            local = datetime(day.year, day.month, day.day, hour, minute, tzinfo=zone)
            moment = local.astimezone(timezone.utc)
            if as_utc(start) <= moment < as_utc(end):
                slots.append(moment)
        day += timedelta(days=1)
    return slots


def next_slot_after(group: Group, after: datetime) -> Optional[datetime]:
    after = as_utc(after)
    slots = schedule_slots(group, after + timedelta(minutes=1), after + timedelta(days=15))
    return slots[0] if slots else None


# ── access helpers ────────────────────────────────────────────────────────


def get_group(db: Session, group_id: uuid.UUID) -> Group:
    group = db.get(Group, group_id)
    if group is None:
        raise NotFound("Group not found")
    return group


def get_lesson(db: Session, lesson_id: uuid.UUID) -> tuple[Lesson, Group]:
    lesson = db.get(Lesson, lesson_id)
    if lesson is None:
        raise NotFound("Lesson not found")
    return lesson, get_group(db, lesson.group_id)


def require_member(db: Session, group: Group, user: User) -> None:
    if not is_group_member(db, group, user):
        raise Forbidden("You are not in this group")


def require_teacher(group: Group, user: User) -> None:
    if not is_group_teacher(group, user):
        raise Forbidden("Only the group's teacher can do this")


def groups_for_user(db: Session, user: User) -> list[Group]:
    owned = db.scalars(select(Group).where(Group.teacher_id == user.id)).all()
    member_ids = db.scalars(select(GroupMembership.group_id).where(GroupMembership.user_id == user.id)).all()
    joined = db.scalars(select(Group).where(Group.id.in_(member_ids))).all() if member_ids else []
    seen, result = set(), []
    for g in list(owned) + list(joined):
        if g.id not in seen:
            seen.add(g.id)
            result.append(g)
    return result


def student_ids(db: Session, group: Group) -> list[uuid.UUID]:
    return list(
        db.scalars(
            select(GroupMembership.user_id).where(
                GroupMembership.group_id == group.id, GroupMembership.user_id != group.teacher_id
            )
        ).all()
    )


# ── lessons ───────────────────────────────────────────────────────────────


def list_lessons(db: Session, groups: Iterable[Group], start: datetime, end: datetime) -> list[Lesson]:
    ids = [g.id for g in groups]
    if not ids:
        return []
    return list(
        db.scalars(
            select(Lesson)
            .where(Lesson.group_id.in_(ids), Lesson.starts_at >= start, Lesson.starts_at < end)
            .order_by(Lesson.starts_at)
        ).all()
    )


def live_or_due_lessons(db: Session, groups: Iterable[Group]) -> list[Lesson]:
    """Lessons that are live now, or whose homework is still open, regardless of date."""
    ids = [g.id for g in groups]
    if not ids:
        return []
    now = utcnow()
    return list(
        db.scalars(
            select(Lesson).where(
                Lesson.group_id.in_(ids),
                (Lesson.live_since.is_not(None))
                | ((Lesson.homework_enabled.is_(True)) & (Lesson.homework_due_at > now - timedelta(days=14))),
            )
        ).all()
    )


def create_lesson(db: Session, group: Group, user: User, starts_at: datetime, title: str | None, topic: str | None) -> Lesson:
    require_teacher(group, user)
    starts_at = as_utc(starts_at)
    # One lesson per slot: preparing or starting the same slot twice reuses it.
    existing = db.scalars(select(Lesson).where(Lesson.group_id == group.id, Lesson.starts_at == starts_at)).first()
    if existing is not None:
        return existing
    lesson = Lesson(group_id=group.id, starts_at=starts_at, title=title, topic=topic)
    db.add(lesson)
    db.commit()
    db.refresh(lesson)
    return lesson


def update_lesson(db: Session, lesson: Lesson, group: Group, user: User, changes: dict) -> Lesson:
    require_teacher(group, user)
    for field in ("title", "topic", "starts_at", "room_mode", "homework_due_at"):
        if field in changes:
            value = changes[field]
            if isinstance(value, datetime):
                value = as_utc(value)
            setattr(lesson, field, value)
    if "live" in changes:
        if changes["live"]:
            lesson.live_since = lesson.live_since or utcnow()
        else:
            lesson.live_since = None
            lesson.room_mode = "together"
    if "homework_enabled" in changes:
        lesson.homework_enabled = bool(changes["homework_enabled"])
        if lesson.homework_enabled and lesson.homework_due_at is None:
            nxt = next_slot_after(group, lesson.starts_at)
            lesson.homework_due_at = (nxt - timedelta(hours=1)) if nxt else as_utc(lesson.starts_at) + timedelta(days=7)
    db.commit()
    db.refresh(lesson)
    return lesson


def delete_lesson(db: Session, lesson: Lesson, group: Group, user: User) -> None:
    require_teacher(group, user)
    db.delete(lesson)
    db.commit()


# ── homework ──────────────────────────────────────────────────────────────


def latest_submissions(db: Session, lesson_ids: list[uuid.UUID], user_id: Optional[uuid.UUID] = None) -> dict:
    """{(lesson_id, user_id): newest submission}."""
    if not lesson_ids:
        return {}
    query = select(HomeworkSubmission).where(HomeworkSubmission.lesson_id.in_(lesson_ids))
    if user_id is not None:
        query = query.where(HomeworkSubmission.user_id == user_id)
    newest: dict = {}
    for sub in db.scalars(query.order_by(HomeworkSubmission.submitted_at)).all():
        newest[(sub.lesson_id, sub.user_id)] = sub
    return newest


def create_homework_submission(
    db: Session, lesson: Lesson, group: Group, user: User, blocks: list[dict], results: dict
) -> HomeworkSubmission:
    require_member(db, group, user)
    if is_group_teacher(group, user):
        raise Forbidden("Teachers don't submit homework")
    if not lesson.homework_enabled:
        raise Forbidden("This lesson has no homework")
    score = sum(min(int(r["passed"]), int(r["total"])) for r in results.values())
    max_score = sum(int(r["total"]) for r in results.values())
    sub = HomeworkSubmission(
        lesson_id=lesson.id, user_id=user.id, blocks=blocks, results=results, score=score, max_score=max_score
    )
    db.add(sub)
    db.commit()
    db.refresh(sub)
    return sub


def set_feedback(db: Session, submission_id: uuid.UUID, user: User, feedback: str) -> HomeworkSubmission:
    sub = db.get(HomeworkSubmission, submission_id)
    if sub is None:
        raise NotFound("Submission not found")
    lesson, group = get_lesson(db, sub.lesson_id)
    require_teacher(group, user)
    sub.feedback = feedback
    db.commit()
    db.refresh(sub)
    return sub
