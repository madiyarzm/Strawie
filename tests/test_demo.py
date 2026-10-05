"""
Tests for the public, account-free demo.

The demo is the only unauthenticated write surface in the app, so these tests
are written as an attacker would probe it:

  * a guest token must not reach real user data or any admin route,
  * a guest must not reach another visitor's room,
  * an expired room and an expired token must both stop working,
  * the creation rate limit must actually trigger, and
  * none of the above may change behaviour for a normal logged-in user.
"""

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from app.config import get_settings
from app.core.demo_auth import (
    DEMO_COOKIE_NAME,
    create_guest_token,
    decode_guest_token,
    is_guest_payload,
)
from app.core.security import create_access_token, decode_access_token
from app.core.ws_acl import (
    _parse_room_id,
    demo_collab_room_id,
    guest_can_join_demo_room,
    parse_demo_room_id,
)
from app.db.session import SessionLocal
from app.main import app
from app.models.demo_room import DemoRoom
from app.services.demo_service import (
    create_room,
    delete_expired_rooms,
    get_active_room,
)


@pytest.fixture
def db():
    """A plain session against the test database."""
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def settings():
    return get_settings()


@pytest.fixture
def fresh_room(db):
    """A live demo room, removed again afterwards so tests do not leak rows."""
    room = create_room(db, ip="203.0.113.9", ttl_hours=3)
    yield room
    db.delete(db.get(DemoRoom, room.id))
    db.commit()


@pytest.fixture
def guest_token(fresh_room, settings):
    return create_guest_token(room_id=fresh_room.id, settings=settings, ttl_hours=3)


# ---------------------------------------------------------------------------
# Room creation and fetching
# ---------------------------------------------------------------------------


def test_create_room_returns_room_and_sets_guest_cookie(client: TestClient):
    """One click must yield a usable room plus a guest session, no login."""
    response = client.post("/api/v1/demo/rooms")
    assert response.status_code == 201, response.text

    body = response.json()
    room_id = uuid.UUID(body["room_id"])  # must be a real UUID
    assert body["expires_at"]

    # The guest cookie is what later authorises the Yjs connection.
    assert DEMO_COOKIE_NAME in response.cookies
    assert decode_guest_token(response.cookies[DEMO_COOKIE_NAME], get_settings()) == room_id

    _cleanup_room(room_id)


def test_get_room_returns_seeded_files_and_banner(client: TestClient, fresh_room):
    """The room must be pre-seeded, so a reviewer never sees an empty state."""
    response = client.get(f"/api/v1/demo/rooms/{fresh_room.id}")
    assert response.status_code == 200, response.text

    body = response.json()
    file_names = [f["name"] for f in body["files"]]
    assert file_names == ["hello.py", "interactive.py"]

    # Both files must have real content, not placeholders.
    for seeded_file in body["files"]:
        assert len(seeded_file["content"].strip()) > 50

    # interactive.py must actually exercise stdin, which is the point of it.
    interactive = next(f for f in body["files"] if f["name"] == "interactive.py")
    assert "input(" in interactive["content"]

    assert len(body["banner_lines"]) == 3
    assert body["collab_room_id"] == demo_collab_room_id(fresh_room.id)


def test_each_visitor_gets_a_distinct_room(client: TestClient):
    """Reviewers must never land in each other's room."""
    first = client.post("/api/v1/demo/rooms")
    second = client.post("/api/v1/demo/rooms")
    assert first.status_code == 201
    assert second.status_code == 201

    first_id = uuid.UUID(first.json()["room_id"])
    second_id = uuid.UUID(second.json()["room_id"])
    assert first_id != second_id

    _cleanup_room(first_id)
    _cleanup_room(second_id)


@pytest.mark.parametrize(
    "bad_room_id",
    [
        "not-a-uuid",
        "deadbeef",
        str(uuid.uuid4()),  # well-formed but never created
    ],
)
def test_unknown_or_malformed_room_returns_clear_404(client: TestClient, bad_room_id):
    """A bad room id must produce an explicit message, never a 500 or silence."""
    response = client.get(f"/api/v1/demo/rooms/{bad_room_id}")
    assert response.status_code == 404
    assert "expired" in response.json()["detail"].lower()


@pytest.mark.parametrize(
    "hostile_path",
    [
        "..%2F..%2Fetc%2Fpasswd",
        "%00",
        "' OR 1=1 --",
    ],
)
def test_hostile_room_path_is_refused_without_crashing(client: TestClient, hostile_path):
    """Path-shaped and injection-shaped garbage must never reach the database.

    These do not necessarily reach the handler -- Starlette may decline to
    match the route at all, which is an equally good outcome. What matters is
    that nothing 2xx and nothing 5xx comes back.
    """
    response = client.get(f"/api/v1/demo/rooms/{hostile_path}")
    assert response.status_code in (404, 422), response.text


# ---------------------------------------------------------------------------
# Expiry
# ---------------------------------------------------------------------------


def test_expired_room_is_gone_on_read_before_any_sweep(client: TestClient, db):
    """Lazy expiry: a past TTL must be dead immediately, with no sweep run."""
    room = create_room(db, ip="203.0.113.10", ttl_hours=3)
    # Backdate the expiry rather than waiting three hours.
    room.expires_at = datetime.now(timezone.utc) - timedelta(minutes=1)
    db.commit()

    assert get_active_room(db, room.id) is None

    response = client.get(f"/api/v1/demo/rooms/{room.id}")
    assert response.status_code == 404

    _cleanup_room(room.id)


def test_sweep_deletes_expired_rooms_but_keeps_live_ones(db):
    """The table must not fill up with junk, and live rooms must survive."""
    expired = create_room(db, ip="203.0.113.11", ttl_hours=3)
    expired.expires_at = datetime.now(timezone.utc) - timedelta(hours=1)
    live = create_room(db, ip="203.0.113.11", ttl_hours=3)
    db.commit()
    expired_id, live_id = expired.id, live.id

    delete_expired_rooms(db)

    # Drop the identity map so these are genuine re-reads; otherwise the
    # session would try to refresh the instance it still holds for the
    # deleted row and raise instead of returning None.
    db.expunge_all()

    assert db.get(DemoRoom, expired_id) is None
    assert db.get(DemoRoom, live_id) is not None

    _cleanup_room(live_id)


def test_guest_token_expires(fresh_room, settings):
    """A guest token must not outlive its room."""
    # jose rejects an already-expired token, which is what the WS path relies on.
    expired_token = create_access_token(
        data={
            "sub": f"guest:{fresh_room.id}",
            "typ": "guest",
            "role": "guest",
            "demo_room": str(fresh_room.id),
        },
        settings=settings,
        expires_minutes=-5,
    )
    assert decode_guest_token(expired_token, settings) is None


# ---------------------------------------------------------------------------
# Guest isolation: the security core
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "method,path",
    [
        ("get", "/api/v1/users/me"),
        ("get", "/api/v1/groups"),
        ("get", "/api/v1/classrooms"),
        ("get", "/api/v1/submissions"),
        ("get", "/api/v1/admin/users"),
        ("post", "/api/v1/sandbox/run"),
    ],
)
def test_guest_token_cannot_reach_authenticated_routes(
    client: TestClient, guest_token, method, path
):
    """A guest token must never satisfy a real-user dependency.

    Asserted on both the cookie and the Authorization header, because the
    header is the replay path a cookie-name split alone would not close.
    """
    for send in ("cookie", "header"):
        if send == "cookie":
            kwargs = {"cookies": {"lambda_token": guest_token}}
        else:
            kwargs = {"headers": {"Authorization": f"Bearer {guest_token}"}}

        response = getattr(client, method)(path, **kwargs)

        # 403 is the demo-mode rejection; 401/404/405 are also acceptable
        # refusals. What must never happen is a 2xx, or a 500 from the guest
        # `sub` reaching the users table.
        assert response.status_code not in (200, 201, 204), (
            f"{method.upper()} {path} via {send} allowed a guest: {response.text}"
        )
        assert response.status_code < 500, (
            f"{method.upper()} {path} via {send} crashed instead of refusing: {response.text}"
        )


def test_guest_rejection_message_is_explicit(client: TestClient, guest_token):
    """A blocked guest must be told why, never fail silently."""
    response = client.get("/api/v1/users/me", cookies={"lambda_token": guest_token})
    assert response.status_code == 403
    assert "demo mode" in response.json()["detail"].lower()


def test_guest_cannot_join_another_visitors_room(db, fresh_room, settings):
    """The decisive isolation check: one guest, one room."""
    other_room = create_room(db, ip="198.51.100.4", ttl_hours=3)

    token_room_id = decode_guest_token(
        create_guest_token(room_id=fresh_room.id, settings=settings, ttl_hours=3),
        settings,
    )
    assert token_room_id == fresh_room.id

    # Own room: allowed.
    assert guest_can_join_demo_room(
        db, token_room_id=token_room_id, room_id=demo_collab_room_id(fresh_room.id)
    )
    # Someone else's room: refused.
    assert not guest_can_join_demo_room(
        db, token_room_id=token_room_id, room_id=demo_collab_room_id(other_room.id)
    )

    _cleanup_room(other_room.id)


def test_guest_cannot_join_an_expired_room(db, settings):
    """An expired room must refuse the Yjs connection too, not just the REST read."""
    room = create_room(db, ip="198.51.100.5", ttl_hours=3)
    room.expires_at = datetime.now(timezone.utc) - timedelta(minutes=1)
    db.commit()

    assert not guest_can_join_demo_room(
        db, token_room_id=room.id, room_id=demo_collab_room_id(room.id)
    )
    _cleanup_room(room.id)


def test_real_user_token_cannot_reach_a_demo_room(fresh_room, settings):
    """A logged-in user must not be able to walk into a visitor's demo room."""
    user_token = create_access_token(
        data={"sub": str(uuid.uuid4())}, settings=settings, expires_minutes=60
    )
    # decode_guest_token is the gate on the demo WS path; a user token must
    # produce no room at all.
    assert decode_guest_token(user_token, settings) is None
    assert not is_guest_payload(decode_access_token(user_token, settings))


def test_demo_rooms_are_invisible_to_the_real_user_room_parser(fresh_room):
    """`_parse_room_id` must not recognise a demo room, in either shape."""
    base = demo_collab_room_id(fresh_room.id)
    assert _parse_room_id(base) is None
    assert _parse_room_id(f"{base}:hello.py") is None


@pytest.mark.parametrize(
    "room_id",
    [
        "demo:not-a-uuid",
        "demo:",
        "demo",
        "",
        "notdemo:" + str(uuid.uuid4()),
        # Over-long and traversal-flavoured file segments.
        "demo:{uuid}:" + "x" * 100,
        "demo:{uuid}:../../etc/passwd",
        "demo:{uuid}:a:b",
    ],
)
def test_demo_room_parser_rejects_malformed_ids(room_id):
    """Room ids arrive from the network, so the parser must be strict."""
    assert parse_demo_room_id(room_id.replace("{uuid}", str(uuid.uuid4()))) is None


def test_guest_token_is_marked_and_scoped(fresh_room, settings):
    """The token must carry the positive guest marker and its room binding."""
    token = create_guest_token(room_id=fresh_room.id, settings=settings, ttl_hours=3)
    payload = decode_access_token(token, settings)

    assert is_guest_payload(payload)
    assert payload["role"] == "guest"
    assert payload["demo_room"] == str(fresh_room.id)
    # `sub` must not be mistakable for a real user UUID.
    assert payload["sub"].startswith("guest:")
    with pytest.raises(ValueError):
        uuid.UUID(payload["sub"])


# ---------------------------------------------------------------------------
# Rate limiting
# ---------------------------------------------------------------------------


def test_room_creation_rate_limit_triggers(client: TestClient):
    """The public create endpoint must stop a burst, with a clear message."""
    settings = get_settings()
    created_ids = []
    limited_response = None

    # One past the hourly cap; the extra request is the one that must fail.
    for _ in range(settings.demo_rooms_per_hour_per_ip + 1):
        response = client.post("/api/v1/demo/rooms")
        if response.status_code == 201:
            created_ids.append(uuid.UUID(response.json()["room_id"]))
        elif response.status_code == 429:
            limited_response = response
            break

    for room_id in created_ids:
        _cleanup_room(room_id)

    assert limited_response is not None, "rate limit never triggered"
    # Whether slowapi or the database-backed ceiling fired, the caller must
    # get a 429 they can understand.
    assert limited_response.status_code == 429
    assert limited_response.text.strip()


# ---------------------------------------------------------------------------
# Normal users must be unaffected
# ---------------------------------------------------------------------------


def test_real_user_token_still_authenticates(client: TestClient, db):
    """Regression guard on the get_current_user edit."""
    from app.models.user import User

    user = User(
        id=uuid.uuid4(),
        email=f"demo-test-{uuid.uuid4()}@example.com",
        name="Demo Regression User",
        google_id=f"google-{uuid.uuid4()}",
        role="student",
    )
    db.add(user)
    db.commit()

    token = create_access_token(
        data={"sub": str(user.id)}, settings=get_settings(), expires_minutes=60
    )
    response = client.get("/api/v1/users/me", cookies={"lambda_token": token})

    db.delete(db.get(User, user.id))
    db.commit()

    assert response.status_code == 200, response.text
    assert response.json()["email"] == user.email


def test_health_still_ok(client: TestClient):
    """The demo must not have disturbed startup or the DB wiring."""
    assert client.get("/health").json()["status"] == "ok"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _cleanup_room(room_id: uuid.UUID) -> None:
    """Remove a room created through the API so tests leave no rows behind."""
    session = SessionLocal()
    try:
        room = session.get(DemoRoom, room_id)
        if room is not None:
            session.delete(room)
            session.commit()
    finally:
        session.close()
