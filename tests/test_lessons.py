"""
Lessons, lesson rooms and homework.

Focus on the rules that protect students: who may open which room, that a
student's homework copy never contains the teacher's solutions or tests,
and that only the teacher can manage lessons and see everyone's work.
Runs on SQLite (Postgres-only JSONB is mapped to JSON for these tests).
"""

import asyncio
import uuid
from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient
from pycrdt import Array, Doc, Map, Text
from sqlalchemy import create_engine
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401  (register all tables)
from app.core import lesson_rooms
from app.core.collab_manager import TAG_DOC, CollabRoomManager
from app.core.collab_store import policy_for_room
from app.core.lesson_rooms import LessonRoom, parse_lesson_room, room_name, user_can_join_lesson_room
from app.db.session import Base, get_db
from app.dependencies import get_current_user
from app.main import app
from app.models import Group, GroupMembership, Lesson, User
from app.services.lesson_service import schedule_slots


@compiles(JSONB, "sqlite")
def _jsonb_on_sqlite(type_, compiler, **kw):
    return "JSON"


@pytest.fixture()
def db_factory():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine, expire_on_commit=False)


def _user(db, name, role="student", banned=False):
    u = User(
        id=uuid.uuid4(), email=f"{name}@example.com", name=name, role=role,
        google_id=f"g-{name}", role_locked=True, is_banned=banned,
    )
    db.add(u)
    return u


@pytest.fixture()
def world(db_factory):
    db = db_factory()
    teacher = _user(db, "teacher", "teacher")
    ann = _user(db, "ann")
    ben = _user(db, "ben")
    outsider = _user(db, "outsider")
    banned = _user(db, "banned", banned=True)
    group = Group(
        id=uuid.uuid4(), teacher_id=teacher.id, name="Tuesday group", invite_code="ABC123",
        schedule={"days": [1, 3], "time": "17:00", "tz": "Asia/Almaty"},
    )
    db.add(group)
    db.flush()
    for s in (ann, ben, banned):
        db.add(GroupMembership(group_id=group.id, user_id=s.id, role="student"))
    lesson = Lesson(id=uuid.uuid4(), group_id=group.id, starts_at=datetime(2026, 11, 17, 12, 0, tzinfo=timezone.utc))
    db.add(lesson)
    db.commit()
    return {"db": db, "teacher": teacher, "ann": ann, "ben": ben, "outsider": outsider,
            "banned": banned, "group": group, "lesson": lesson, "factory": db_factory}


# ── room names ────────────────────────────────────────────────────────────


def test_room_names_are_parsed_strictly():
    lid, uid = uuid.uuid4(), uuid.uuid4()
    assert parse_lesson_room(f"lesson:{lid}:board") == LessonRoom(lid, "board")
    assert parse_lesson_room(f"lesson:{lid}:hw") == LessonRoom(lid, "hw")
    assert parse_lesson_room(f"lesson:{lid}:hw:{uid}") == LessonRoom(lid, "hw", uid)
    for bad in [
        f"lesson:{lid}:secret",
        f"lesson:{lid}:board:{uid}",          # shared rooms have no owner
        f"lesson:{lid}:solo",                 # personal rooms need one
        f"lesson:{str(lid).upper()}:board",   # one canonical name per room
        f"lesson:{lid}:hw:{uid}:extra",
        f"lesson:not-a-uuid:board",
    ]:
        assert parse_lesson_room(bad) is None, bad


# ── who may open which room ───────────────────────────────────────────────


def _can(w, who, room):
    return user_can_join_lesson_room(w["db"], w[who], parse_lesson_room(room))


def test_room_access_matrix(world):
    w = world
    lid, ann, ben = w["lesson"].id, w["ann"].id, w["ben"].id
    board, master = room_name(lid, "board"), room_name(lid, "hw")
    ann_hw, ann_solo = room_name(lid, "hw", ann), room_name(lid, "solo", ann)

    assert _can(w, "teacher", board) and _can(w, "ann", board)
    assert not _can(w, "outsider", board)
    assert not _can(w, "banned", board)

    # The homework master holds solutions and tests: teacher only.
    assert _can(w, "teacher", master)
    assert not _can(w, "ann", master)

    # Personal copies: the owner and the teacher, nobody else.
    assert _can(w, "ann", ann_solo) and _can(w, "teacher", ann_solo)
    assert not _can(w, "ben", ann_solo)

    # Homework copies open for the student only once homework is given.
    assert not _can(w, "ann", ann_hw)
    w["lesson"].homework_enabled = True
    w["db"].commit()
    assert _can(w, "ann", ann_hw) and _can(w, "teacher", ann_hw)
    assert not _can(w, "ben", ann_hw)


def test_personal_rooms_only_for_group_students(world):
    w = world
    lid = w["lesson"].id
    assert policy_for_room(w["db"], room_name(lid, "hw", w["ann"].id)) is not None
    # Even the teacher can't create a homework copy for someone outside the group.
    assert policy_for_room(w["db"], room_name(lid, "hw", w["outsider"].id)) is None
    assert policy_for_room(w["db"], room_name(lid, "solo", uuid.uuid4())) is None


# ── homework copies never leak solutions or tests ─────────────────────────


def _master_doc() -> Doc:
    doc = Doc()
    blocks = doc.get("blocks", type=Array)
    blocks.append(Map({"id": "t1", "type": "text", "text": Text("Problem 1: add two numbers")}))
    tests = Array()
    blocks.append(Map({"id": "c1", "type": "code", "text": Text("def add(a, b):\n    return a + b  # SOLUTION"),
                       "starter": Text("def add(a, b):\n    pass"), "tests": tests}))
    tests.append(Map({"id": "x1", "kind": "call", "call": "add(2, 3)", "expected": "5", "stdin": "", "hidden": False}))
    tests.append(Map({"id": "x2", "kind": "call", "call": "add(-1, 1)", "expected": "0", "stdin": "", "hidden": True}))
    blocks.append(Map({"id": "c2", "type": "code", "text": Text("print('scratch')")}))
    return doc


def test_student_copy_has_starter_code_and_no_solution_or_tests():
    student = Doc()
    lesson_rooms.copy_homework_for_student(_master_doc(), student)
    blocks = list(student.get("blocks", type=Array))
    assert [b.get("type") for b in blocks] == ["text", "code", "code"]
    assert str(blocks[0]["text"]) == "Problem 1: add two numbers"
    assert str(blocks[1]["text"]) == "def add(a, b):\n    pass"
    assert "SOLUTION" not in str(student.get_update())
    assert blocks[1].get("tests") is None and blocks[1].get("graded") is True
    assert blocks[2].get("graded") is False


def test_tests_endpoint_data_has_no_solution():
    tests = lesson_rooms.read_homework_tests(_master_doc())
    assert tests == [{"block_id": "c1", "tests": [
        {"id": "x1", "kind": "call", "call": "add(2, 3)", "expected": "5", "stdin": "", "hidden": False},
        {"id": "x2", "kind": "call", "call": "add(-1, 1)", "expected": "0", "stdin": "", "hidden": True},
    ]}]
    assert "SOLUTION" not in repr(tests)


class FakeSocket:
    def __init__(self):
        self.sent = []

    async def accept(self):
        pass

    async def send_bytes(self, data):
        self.sent.append(bytes(data))

    async def close(self, code=1000, reason=""):
        self.closed = (code, reason)


def test_student_copy_is_built_from_the_live_master(world):
    """The teacher is editing the master right now; a student opening their
    homework gets the latest version, without the solution."""
    w = world
    lid, ann = w["lesson"].id, w["ann"].id
    w["lesson"].homework_enabled = True
    w["db"].commit()

    async def scenario():
        m = CollabRoomManager(session_factory=w["factory"], save_delay=0.01)
        master_room, ann_room = room_name(lid, "hw"), room_name(lid, "hw", ann)
        teacher_ws = FakeSocket()
        db = w["factory"]()
        await m.connect(master_room, teacher_ws, policy_for_room(db, master_room))
        # Teacher replaces the master with a full problem (one update).
        current = Doc()
        current.apply_update(teacher_ws.sent[0][1:])
        before = current.get_state()
        blocks = current.get("blocks", type=Array)
        blocks.append(Map({"id": "c9", "type": "code", "text": Text("SECRET = 42"),
                           "starter": Text("# your turn"), "tests": Array()}))
        await m.handle_message(master_room, teacher_ws, bytes([TAG_DOC]) + current.get_update(before))

        ann_ws = FakeSocket()
        await m.connect(ann_room, ann_ws, policy_for_room(db, ann_room))
        db.close()
        got = Doc()
        got.apply_update(ann_ws.sent[0][1:])
        texts = [str(b["text"]) for b in got.get("blocks", type=Array)]
        assert "# your turn" in texts
        assert "SECRET" not in str(got.get_update())

    asyncio.run(scenario())


# ── schedule ──────────────────────────────────────────────────────────────


def test_schedule_slots_follow_the_groups_time_zone(world):
    group = world["group"]  # Tue & Thu 17:00 in Almaty (UTC+5)
    start = datetime(2026, 11, 16, 0, 0, tzinfo=timezone.utc)  # a Monday
    end = datetime(2026, 11, 23, 0, 0, tzinfo=timezone.utc)
    assert schedule_slots(group, start, end) == [
        datetime(2026, 11, 17, 12, 0, tzinfo=timezone.utc),
        datetime(2026, 11, 19, 12, 0, tzinfo=timezone.utc),
    ]


def test_schedule_can_have_a_different_time_on_some_days(world):
    group = world["group"]
    # Tuesdays at 17:00 (the usual time), Thursdays at 18:30. JSON keys are strings.
    group.schedule = {"days": [1, 3], "time": "17:00", "times": {"3": "18:30"}, "tz": "Asia/Almaty"}
    start = datetime(2026, 11, 16, 0, 0, tzinfo=timezone.utc)
    end = datetime(2026, 11, 23, 0, 0, tzinfo=timezone.utc)
    assert schedule_slots(group, start, end) == [
        datetime(2026, 11, 17, 12, 0, tzinfo=timezone.utc),
        datetime(2026, 11, 19, 13, 30, tzinfo=timezone.utc),
    ]


def test_schedule_times_are_validated_and_trimmed():
    from pydantic import ValidationError

    from app.schemas.lesson import GroupSchedule

    s = GroupSchedule(days=[1, 3], time="17:00", times={1: "17:00", 3: "18:30", 5: "09:00"}, tz="UTC")
    # Same-as-default and days not in the schedule are dropped.
    assert s.times == {3: "18:30"}
    with pytest.raises(ValidationError):
        GroupSchedule(days=[1], time="17:00", times={1: "25:00"})
    # Old schedules without per-day times still load.
    assert GroupSchedule(days=[2], time="10:00").times == {}


# ── HTTP ──────────────────────────────────────────────────────────────────


@pytest.fixture()
def as_user(world):
    def make(who):
        db = world["factory"]()
        user = db.get(User, world[who].id)
        app.dependency_overrides[get_db] = lambda: db
        app.dependency_overrides[get_current_user] = lambda: user
        return TestClient(app)

    yield make
    app.dependency_overrides.clear()


def test_only_the_teacher_manages_lessons(world, as_user):
    gid, lid = str(world["group"].id), str(world["lesson"].id)
    student = as_user("ann")
    assert student.post("/api/v1/lessons", json={"group_id": gid, "starts_at": "2026-11-19T12:00:00Z"}).status_code == 403
    assert student.patch(f"/api/v1/lessons/{lid}", json={"live": True}).status_code == 403
    assert student.delete(f"/api/v1/lessons/{lid}").status_code == 403
    outsider = as_user("outsider")
    assert outsider.get(f"/api/v1/lessons/{lid}").status_code == 403

    teacher = as_user("teacher")
    r = teacher.post("/api/v1/lessons", json={"group_id": gid, "starts_at": "2026-11-19T12:00:00Z", "title": "Lists #3"})
    assert r.status_code == 201
    # Starting the same slot again reuses the lesson instead of duplicating it.
    again = teacher.post("/api/v1/lessons", json={"group_id": gid, "starts_at": "2026-11-19T12:00:00Z"})
    assert again.json()["id"] == r.json()["id"]


def test_homework_flow(world, as_user):
    lid = str(world["lesson"].id)
    payload = {
        "blocks": [{"id": "c1", "type": "code", "text": "def add(a, b):\n    return a + b"}],
        "results": {"c1": {"passed": 1, "total": 2, "failures": [{"test_id": "x2", "label": "hidden test"}]}},
    }
    ann = as_user("ann")
    assert ann.post(f"/api/v1/lessons/{lid}/homework/submissions", json=payload).status_code == 403  # not given yet

    teacher = as_user("teacher")
    r = teacher.patch(f"/api/v1/lessons/{lid}", json={"homework_enabled": True})
    assert r.status_code == 200
    # Due by default one hour before the next class (Thu 12:00 UTC).
    assert r.json()["homework_due_at"].startswith("2026-11-19T11:00")
    assert teacher.post(f"/api/v1/lessons/{lid}/homework/submissions", json=payload).status_code == 403

    ann = as_user("ann")
    sub = ann.post(f"/api/v1/lessons/{lid}/homework/submissions", json=payload)
    assert sub.status_code == 201 and sub.json()["score"] == 1 and sub.json()["max_score"] == 2

    # A student only ever sees their own work.
    ben = as_user("ben")
    rows = ben.get(f"/api/v1/lessons/{lid}/homework/submissions").json()
    assert [r["name"] for r in rows] == ["ben"] and rows[0]["submission"] is None
    assert ben.patch(f"/api/v1/lessons/homework-submissions/{sub.json()['id']}/feedback", json={"feedback": "x"}).status_code == 403

    teacher = as_user("teacher")
    roster = teacher.get(f"/api/v1/lessons/{lid}/homework/submissions").json()
    by_name = {r["name"]: r for r in roster}
    assert by_name["ann"]["submission"]["score"] == 1 and by_name["ben"]["submission"] is None
    fb = teacher.patch(f"/api/v1/lessons/homework-submissions/{sub.json()['id']}/feedback", json={"feedback": "Nice"})
    assert fb.status_code == 200 and fb.json()["feedback"] == "Nice"


def test_submission_size_limits(world, as_user):
    lid = str(world["lesson"].id)
    world["lesson"].homework_enabled = True
    world["db"].commit()
    ann = as_user("ann")
    huge = {"blocks": [{"id": "c1", "type": "code", "text": "x" * 20_001}], "results": {}}
    assert ann.post(f"/api/v1/lessons/{lid}/homework/submissions", json=huge).status_code == 422
    bad_id = {"blocks": [{"id": "../../etc", "type": "code", "text": ""}], "results": {}}
    assert ann.post(f"/api/v1/lessons/{lid}/homework/submissions", json=bad_id).status_code == 422


def test_agenda_shows_unprepared_scheduled_slots(world, as_user, monkeypatch):
    import app.services.lesson_service as svc

    monkeypatch.setattr(svc, "utcnow", lambda: datetime(2026, 11, 16, 9, 0, tzinfo=timezone.utc))
    data = as_user("ann").get("/api/v1/lessons/agenda").json()
    # Tuesday's slot has a lesson row; Thursday's doesn't yet.
    assert [l["id"] for l in data["lessons"]] == [str(world["lesson"].id)]
    assert "2026-11-19T12:00:00Z" in [s["starts_at"].replace("+00:00", "Z") for s in data["open_slots"]]
    assert all(not s["is_teacher"] for s in data["open_slots"])


def test_ended_lesson_is_marked_and_stays_open_to_students(world, as_user):
    lid = str(world["lesson"].id)
    teacher = as_user("teacher")
    assert teacher.patch(f"/api/v1/lessons/{lid}", json={"live": True}).json()["ended"] is False
    ended = teacher.patch(f"/api/v1/lessons/{lid}", json={"live": False}).json()
    assert ended["live"] is False and ended["ended"] is True

    # Students can still open the lesson and its rooms after it ends.
    student = as_user("ann")
    assert student.get(f"/api/v1/lessons/{lid}").json()["ended"] is True
    assert _can(world, "ann", f"lesson:{lid}:board")
    assert _can(world, "ann", f"lesson:{lid}:solo:{world['ann'].id}")

    # Starting it again clears the ended mark.
    teacher = as_user("teacher")
    assert teacher.patch(f"/api/v1/lessons/{lid}", json={"live": True}).json()["ended"] is False


def test_never_started_lesson_is_not_ended(world, as_user):
    lid = str(world["lesson"].id)
    assert as_user("teacher").patch(f"/api/v1/lessons/{lid}", json={"live": False}).json()["ended"] is False
