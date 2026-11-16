"""
Lesson rooms: names, access rules and starting content.

Room ids (all parts validated strictly):
  lesson:<lesson>:board           class page        teacher + group members
  lesson:<lesson>:draw            whiteboard        teacher + group members
  lesson:<lesson>:solo:<user>     own copy          that student + teacher
  lesson:<lesson>:hw              homework master   teacher only
  lesson:<lesson>:hw:<user>       student homework  that student + teacher
                                                    (students only once the
                                                    teacher gives homework)

The homework master holds the teacher's solutions and tests, so students can
never open it. A student's homework is built from the master by the server,
with each code block reset to its starter code and the tests left out.

Page documents (shared with the frontend, see frontend-vite/src/lessons):
  doc["blocks"]: Array of Map
     "id": str, "type": "text" | "code", "text": Text
     code blocks in the homework master may also have
       "starter": Text, "tests": Array of Map(id, kind, call, expected,
       stdin, hidden)
     code blocks in a student's homework have "graded": bool
"""

from __future__ import annotations

import secrets
import uuid
from dataclasses import dataclass
from typing import Optional

from pycrdt import Array, Doc, Map, Text
from sqlalchemy.orm import Session

from app.models.group import Group
from app.models.group_membership import GroupMembership
from app.models.lesson import Lesson
from app.models.user import User

PREFIX = "lesson"
SHARED_KINDS = ("board", "draw")
PERSONAL_KINDS = ("solo", "hw")


@dataclass(frozen=True)
class LessonRoom:
    lesson_id: uuid.UUID
    kind: str  # board | draw | solo | hw
    owner_id: Optional[uuid.UUID] = None  # solo/hw copies belong to one student

    @property
    def is_master(self) -> bool:
        return self.kind == "hw" and self.owner_id is None


def _uuid(value: str) -> Optional[uuid.UUID]:
    try:
        parsed = uuid.UUID(value)
    except (ValueError, AttributeError, TypeError):
        return None
    # Only accept the canonical form, so one room has exactly one name.
    return parsed if str(parsed) == value else None


def parse_lesson_room(room_id: str) -> Optional[LessonRoom]:
    if not room_id or not room_id.startswith(PREFIX + ":"):
        return None
    parts = room_id.split(":")
    if len(parts) not in (3, 4):
        return None
    lesson_id = _uuid(parts[1])
    kind = parts[2]
    if lesson_id is None:
        return None
    if len(parts) == 3:
        if kind in SHARED_KINDS or kind == "hw":
            return LessonRoom(lesson_id, kind)
        return None
    owner = _uuid(parts[3])
    if owner is None or kind not in PERSONAL_KINDS:
        return None
    return LessonRoom(lesson_id, kind, owner)


def room_name(lesson_id: uuid.UUID, kind: str, owner_id: Optional[uuid.UUID] = None) -> str:
    return f"{PREFIX}:{lesson_id}:{kind}" + (f":{owner_id}" if owner_id else "")


# ── access ────────────────────────────────────────────────────────────────


def is_group_teacher(group: Group, user: User) -> bool:
    return user.role == "admin" or group.teacher_id == user.id


def is_group_member(db: Session, group: Group, user: User) -> bool:
    if is_group_teacher(group, user):
        return True
    return (
        db.query(GroupMembership)
        .filter(GroupMembership.group_id == group.id, GroupMembership.user_id == user.id)
        .first()
        is not None
    )


def user_can_join_lesson_room(db: Session, user: User, room: LessonRoom) -> bool:
    if user.is_banned:
        return False
    lesson = db.get(Lesson, room.lesson_id)
    if lesson is None:
        return False
    group = db.get(Group, lesson.group_id)
    if group is None:
        return False
    if is_group_teacher(group, user):
        return True
    if not is_group_member(db, group, user):
        return False
    # Students from here on.
    if room.kind in SHARED_KINDS:
        return True
    if room.is_master:
        return False
    if room.owner_id != user.id:
        return False
    if room.kind == "hw":
        return lesson.homework_enabled
    return True  # own solo copy


def owner_is_group_student(db: Session, room: LessonRoom) -> bool:
    """A personal copy may only be created for a real student of the group,
    so a teacher can't be tricked into creating rooms for arbitrary ids."""
    if room.owner_id is None:
        return True
    lesson = db.get(Lesson, room.lesson_id)
    if lesson is None:
        return False
    return (
        db.query(GroupMembership)
        .filter(GroupMembership.group_id == lesson.group_id, GroupMembership.user_id == room.owner_id)
        .first()
        is not None
    )


# ── page content ──────────────────────────────────────────────────────────


def new_block_id() -> str:
    return secrets.token_hex(6)


def _block(kind: str, text: str = "", **extra) -> Map:
    data = {"id": new_block_id(), "type": kind, "text": Text(text)}
    data.update(extra)
    return Map(data)


def seed_board(doc: Doc) -> None:
    blocks = doc.get("blocks", type=Array)
    blocks.append(_block("text", ""))
    blocks.append(_block("code", ""))


def seed_homework_master(doc: Doc) -> None:
    blocks = doc.get("blocks", type=Array)
    blocks.append(_block("text", ""))
    blocks.append(_block("code", "", starter=Text(""), tests=Array()))


def _text_of(block, key: str = "text") -> str:
    try:
        value = block.get(key)
    except Exception:
        return ""
    return str(value) if value is not None else ""


def copy_board(src: Doc, dst: Doc) -> None:
    """Solo copy: the class page as it is right now, text and code."""
    out = dst.get("blocks", type=Array)
    for block in src.get("blocks", type=Array):
        kind = block.get("type")
        if kind not in ("text", "code"):
            continue
        out.append(Map({"id": str(block.get("id") or new_block_id()), "type": kind, "text": Text(_text_of(block))}))


def copy_homework_for_student(src: Doc, dst: Doc) -> None:
    """Student homework: problem text, starter code, no solutions, no tests."""
    out = dst.get("blocks", type=Array)
    for block in src.get("blocks", type=Array):
        kind = block.get("type")
        bid = str(block.get("id") or new_block_id())
        if kind == "text":
            out.append(Map({"id": bid, "type": "text", "text": Text(_text_of(block))}))
        elif kind == "code":
            tests = block.get("tests")
            graded = tests is not None and len(tests) > 0
            out.append(Map({"id": bid, "type": "code", "text": Text(_text_of(block, "starter")), "graded": graded}))


def read_homework_tests(master: Doc) -> list[dict]:
    """Tests per graded code block, in page order (for the student's browser)."""
    result = []
    for block in master.get("blocks", type=Array):
        if block.get("type") != "code":
            continue
        tests = block.get("tests")
        if tests is None or len(tests) == 0:
            continue
        items = []
        for t in tests:
            items.append(
                {
                    "id": str(t.get("id") or ""),
                    "kind": "io" if t.get("kind") == "io" else "call",
                    "call": str(t.get("call") or "")[:2000],
                    "expected": str(t.get("expected") or "")[:5000],
                    "stdin": str(t.get("stdin") or "")[:5000],
                    "hidden": bool(t.get("hidden")),
                }
            )
        result.append({"block_id": str(block.get("id") or ""), "tests": items})
    return result
