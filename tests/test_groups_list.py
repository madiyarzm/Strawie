"""
Regression: listing groups must work on Postgres when groups have a schedule.

groups.schedule is a JSON column, and Postgres can't compare JSON values, so
a UNION over full Group rows fails ("could not identify an equality operator
for type json"). That broke /api/v1/groups/ in production and made /app
bounce back to the landing page.
"""

import uuid

import pytest
from fastapi.testclient import TestClient

from app.db.session import SessionLocal
from app.dependencies import get_current_user
from app.main import app
from app.models import Group, GroupMembership, User


@pytest.fixture()
def people():
    db = SessionLocal()
    suffix = uuid.uuid4().hex[:8]
    teacher = User(id=uuid.uuid4(), email=f"t{suffix}@example.com", name="T", role="teacher", google_id=f"gt{suffix}", role_locked=True)
    student = User(id=uuid.uuid4(), email=f"s{suffix}@example.com", name="S", role="student", google_id=f"gs{suffix}", role_locked=True)
    db.add_all([teacher, student])
    db.flush()
    group = Group(id=uuid.uuid4(), teacher_id=teacher.id, name="G", invite_code=f"C{suffix}",
                  schedule={"days": [1, 3], "time": "17:00", "tz": "UTC"})
    db.add(group)
    db.flush()
    db.add(GroupMembership(group_id=group.id, user_id=student.id, role="student"))
    db.commit()
    yield db, teacher, student, group
    db.delete(group)
    db.delete(teacher)
    db.delete(student)
    db.commit()
    db.close()


@pytest.mark.parametrize("who", ["teacher", "student"])
def test_list_groups_with_schedule(people, who):
    db, teacher, student, group = people
    user = teacher if who == "teacher" else student
    app.dependency_overrides[get_current_user] = lambda: user
    try:
        r = TestClient(app).get("/api/v1/groups/")
    finally:
        app.dependency_overrides.clear()
    assert r.status_code == 200, r.text
    assert [g["id"] for g in r.json()] == [str(group.id)]
    assert r.json()[0]["schedule"]["time"] == "17:00"
