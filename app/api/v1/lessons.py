"""
Lessons API: the schedule-driven agenda, lesson controls and homework.

Permissions are enforced in app/services/lesson_service.py; this module only
translates them to HTTP errors.
"""


import asyncio
from datetime import timedelta
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query, Request, status
from pycrdt import Doc

from app.core import lesson_rooms
from app.core.collab_manager import manager as collab_manager
from app.core.collab_store import load_source_doc
from app.core.limiter import limiter
from app.db.session import SessionLocal
from app.dependencies import CurrentUser, DBSession
from app.models.homework_submission import HomeworkSubmission
from app.models.user import User
from app.schemas.lesson import (
    Agenda,
    FeedbackUpdate,
    HomeworkProblemTests,
    HomeworkRosterRow,
    HomeworkSubmissionRead,
    HomeworkSubmit,
    LessonCreate,
    LessonRead,
    LessonUpdate,
    MyHomework,
    ScheduleSlot,
)
from app.services import lesson_service as svc

router = APIRouter()


def _http(exc: Exception) -> HTTPException:
    if isinstance(exc, svc.NotFound):
        return HTTPException(status.HTTP_404_NOT_FOUND, str(exc))
    return HTTPException(status.HTTP_403_FORBIDDEN, str(exc))


def _lesson_read(db, lesson, group, user, *, mine=None, submitted=None, students=None) -> LessonRead:
    teacher = lesson_rooms.is_group_teacher(group, user)
    return LessonRead(
        id=lesson.id,
        group_id=group.id,
        group_name=group.name,
        title=lesson.title,
        topic=lesson.topic,
        starts_at=svc.as_utc(lesson.starts_at),
        room_mode=lesson.room_mode,
        live=lesson.live_since is not None,
        homework_enabled=lesson.homework_enabled,
        homework_due_at=svc.as_utc(lesson.homework_due_at) if lesson.homework_due_at else None,
        is_teacher=teacher,
        my_homework=(
            MyHomework(
                submitted_at=svc.as_utc(mine.submitted_at),
                score=mine.score,
                max_score=mine.max_score,
                has_feedback=bool(mine.feedback),
            )
            if mine is not None and not teacher
            else None
        ),
        submitted_count=submitted if teacher else None,
        student_count=students if teacher else None,
    )


def _submission_read(sub: HomeworkSubmission, name: str) -> HomeworkSubmissionRead:
    return HomeworkSubmissionRead(
        id=sub.id,
        lesson_id=sub.lesson_id,
        user_id=sub.user_id,
        user_name=name,
        blocks=sub.blocks,
        results=sub.results,
        score=sub.score,
        max_score=sub.max_score,
        feedback=sub.feedback,
        submitted_at=svc.as_utc(sub.submitted_at),
    )


def _read_many(db, lessons, user) -> list[LessonRead]:
    groups = {}
    for lesson in lessons:
        if lesson.group_id not in groups:
            groups[lesson.group_id] = svc.get_group(db, lesson.group_id)
    ids = [lesson.id for lesson in lessons]
    mine = svc.latest_submissions(db, ids, user.id)
    everyone = svc.latest_submissions(db, ids)
    out = []
    for lesson in lessons:
        group = groups[lesson.group_id]
        students = svc.student_ids(db, group)
        submitted = sum(1 for (lid, uid) in everyone if lid == lesson.id and uid in students)
        out.append(
            _lesson_read(
                db, lesson, group, user,
                mine=mine.get((lesson.id, user.id)), submitted=submitted, students=len(students),
            )
        )
    return out


@router.get("/agenda", response_model=Agenda)
def agenda(current_user: CurrentUser, db: DBSession, days: int = Query(default=14, ge=1, le=60)) -> Agenda:
    """Home screen: lessons around now, plus scheduled slots nobody prepared yet."""
    groups = svc.groups_for_user(db, current_user)
    now = svc.utcnow()
    start, end = now - timedelta(days=days), now + timedelta(days=days)
    lessons = {lesson.id: lesson for lesson in svc.list_lessons(db, groups, start, end)}
    for lesson in svc.live_or_due_lessons(db, groups):
        lessons.setdefault(lesson.id, lesson)
    ordered = sorted(lessons.values(), key=lambda l: svc.as_utc(l.starts_at))
    taken = {(l.group_id, svc.as_utc(l.starts_at)) for l in ordered}
    slots = []
    for group in groups:
        for moment in svc.schedule_slots(group, now - timedelta(hours=3), now + timedelta(days=days)):
            if (group.id, moment) not in taken:
                slots.append(
                    ScheduleSlot(
                        group_id=group.id, group_name=group.name, starts_at=moment,
                        is_teacher=lesson_rooms.is_group_teacher(group, current_user),
                    )
                )
    slots.sort(key=lambda s: s.starts_at)
    return Agenda(lessons=_read_many(db, ordered, current_user), open_slots=slots)


@router.get("", response_model=list[LessonRead])
def list_group_lessons(group_id: UUID, current_user: CurrentUser, db: DBSession) -> list[LessonRead]:
    try:
        group = svc.get_group(db, group_id)
        svc.require_member(db, group, current_user)
    except (svc.NotFound, svc.Forbidden) as exc:
        raise _http(exc)
    now = svc.utcnow()
    lessons = svc.list_lessons(db, [group], now - timedelta(days=365), now + timedelta(days=60))
    return _read_many(db, lessons, current_user)


@router.post("", response_model=LessonRead, status_code=status.HTTP_201_CREATED)
def create_lesson(payload: LessonCreate, current_user: CurrentUser, db: DBSession) -> LessonRead:
    try:
        group = svc.get_group(db, payload.group_id)
        lesson = svc.create_lesson(db, group, current_user, payload.starts_at, payload.title, payload.topic)
    except (svc.NotFound, svc.Forbidden) as exc:
        raise _http(exc)
    return _read_many(db, [lesson], current_user)[0]


@router.get("/{lesson_id}", response_model=LessonRead)
def get_lesson(lesson_id: UUID, current_user: CurrentUser, db: DBSession) -> LessonRead:
    try:
        lesson, group = svc.get_lesson(db, lesson_id)
        svc.require_member(db, group, current_user)
    except (svc.NotFound, svc.Forbidden) as exc:
        raise _http(exc)
    return _read_many(db, [lesson], current_user)[0]


@router.patch("/{lesson_id}", response_model=LessonRead)
def update_lesson(lesson_id: UUID, payload: LessonUpdate, current_user: CurrentUser, db: DBSession) -> LessonRead:
    try:
        lesson, group = svc.get_lesson(db, lesson_id)
        lesson = svc.update_lesson(db, lesson, group, current_user, payload.model_dump(exclude_unset=True))
    except (svc.NotFound, svc.Forbidden) as exc:
        raise _http(exc)
    return _read_many(db, [lesson], current_user)[0]


@router.delete("/{lesson_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_lesson(lesson_id: UUID, current_user: CurrentUser, db: DBSession) -> None:
    try:
        lesson, group = svc.get_lesson(db, lesson_id)
        svc.delete_lesson(db, lesson, group, current_user)
    except (svc.NotFound, svc.Forbidden) as exc:
        raise _http(exc)


@router.get("/{lesson_id}/presence", response_model=list[UUID])
def presence(lesson_id: UUID, current_user: CurrentUser, db: DBSession) -> list[UUID]:
    """Who is connected to any of this lesson's rooms right now (teacher only)."""
    try:
        lesson, group = svc.get_lesson(db, lesson_id)
        svc.require_teacher(group, current_user)
    except (svc.NotFound, svc.Forbidden) as exc:
        raise _http(exc)
    return sorted(collab_manager.active_user_ids(lesson.id), key=str)


# ── homework ──────────────────────────────────────────────────────────────


def _load_master_blocking(room_id: str) -> Doc:
    db = SessionLocal()
    try:
        return load_source_doc(db, room_id)
    finally:
        db.close()


@router.get("/{lesson_id}/homework/tests", response_model=list[HomeworkProblemTests])
async def homework_tests(lesson_id: UUID, current_user: CurrentUser, db: DBSession) -> list[HomeworkProblemTests]:
    """Tests for the student's browser to grade with. Never includes solutions."""
    try:
        lesson, group = svc.get_lesson(db, lesson_id)
        svc.require_member(db, group, current_user)
        if not lesson.homework_enabled and not lesson_rooms.is_group_teacher(group, current_user):
            raise svc.Forbidden("This lesson has no homework")
    except (svc.NotFound, svc.Forbidden) as exc:
        raise _http(exc)
    room_id = lesson_rooms.room_name(lesson.id, "hw")
    # Read the open (in-memory) master on the event loop, never from a thread.
    live = collab_manager.open_doc(room_id)
    master = live if live is not None else await asyncio.to_thread(_load_master_blocking, room_id)
    return [HomeworkProblemTests(**p) for p in lesson_rooms.read_homework_tests(master)]


@router.post(
    "/{lesson_id}/homework/submissions",
    response_model=HomeworkSubmissionRead,
    status_code=status.HTTP_201_CREATED,
)
@limiter.limit("10/minute")
def submit_homework(
    request: Request, lesson_id: UUID, payload: HomeworkSubmit, current_user: CurrentUser, db: DBSession
) -> HomeworkSubmissionRead:
    try:
        lesson, group = svc.get_lesson(db, lesson_id)
        sub = svc.create_homework_submission(
            db, lesson, group, current_user,
            [b.model_dump() for b in payload.blocks],
            {k: v.model_dump() for k, v in payload.results.items()},
        )
    except (svc.NotFound, svc.Forbidden) as exc:
        raise _http(exc)
    return _submission_read(sub, current_user.name or "")


@router.get("/{lesson_id}/homework/submissions", response_model=list[HomeworkRosterRow])
def homework_roster(lesson_id: UUID, current_user: CurrentUser, db: DBSession) -> list[HomeworkRosterRow]:
    """Teacher: every student with their latest submission. Student: only themselves."""
    try:
        lesson, group = svc.get_lesson(db, lesson_id)
        svc.require_member(db, group, current_user)
    except (svc.NotFound, svc.Forbidden) as exc:
        raise _http(exc)
    teacher = lesson_rooms.is_group_teacher(group, current_user)
    ids = svc.student_ids(db, group) if teacher else [current_user.id]
    latest = svc.latest_submissions(db, [lesson.id], None if teacher else current_user.id)
    rows = []
    for uid in ids:
        user = db.get(User, uid)
        name = (user.name or user.email) if user else ""
        sub = latest.get((lesson.id, uid))
        rows.append(HomeworkRosterRow(user_id=uid, name=name, submission=_submission_read(sub, name) if sub else None))
    rows.sort(key=lambda r: r.name.lower())
    return rows


@router.patch("/homework-submissions/{submission_id}/feedback", response_model=HomeworkSubmissionRead)
def homework_feedback(
    submission_id: UUID, payload: FeedbackUpdate, current_user: CurrentUser, db: DBSession
) -> HomeworkSubmissionRead:
    try:
        sub = svc.set_feedback(db, submission_id, current_user, payload.feedback)
    except (svc.NotFound, svc.Forbidden) as exc:
        raise _http(exc)
    student = db.get(User, sub.user_id)
    return _submission_read(sub, (student.name or student.email) if student else "")
