"""
Live-editing rooms are saved on the server and seeded exactly once.

These cover the causes of "my code disappeared": a stateless relay, clients
racing to insert starter code, and nothing being written anywhere. They run
against an in-memory SQLite database and fake WebSockets, so no network or
Postgres is needed.
"""

import asyncio
import uuid

import pytest
from pycrdt import Doc, Text
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core import collab_store
from app.core.collab_manager import TAG_DOC, TAG_SYNCED, CollabRoomManager
from app.core.collab_store import MAX_MESSAGE_BYTES, RoomPolicy, policy_for_room
from app.db.session import Base
from app.models.collab_document import CollabDocument

CLASSROOM = uuid.uuid4()
ASSIGNMENT = uuid.uuid4()
ROOM = f"{CLASSROOM}:{ASSIGNMENT}:{ASSIGNMENT}"


class FakeSocket:
    def __init__(self) -> None:
        self.sent: list[bytes] = []
        self.accepted = False
        self.closed: tuple[int, str] | None = None

    async def accept(self) -> None:
        self.accepted = True

    async def send_bytes(self, data: bytes) -> None:
        self.sent.append(bytes(data))

    async def close(self, code: int = 1000, reason: str = "") -> None:
        self.closed = (code, reason)

    def text(self) -> str:
        """Rebuild the document this client has received and return its code."""
        doc = Doc()
        for msg in self.sent:
            if msg and msg[0] == TAG_DOC:
                doc.apply_update(msg[1:])
        return str(doc.get("code", type=Text))


@pytest.fixture()
def session_factory():
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    # Only the tables these tests touch (SQLite can't build the JSONB ones).
    from app.models.assignment import Assignment

    Base.metadata.create_all(engine, tables=[Assignment.__table__, CollabDocument.__table__])
    return sessionmaker(bind=engine)


def make_manager(session_factory) -> CollabRoomManager:
    return CollabRoomManager(session_factory=session_factory, save_delay=0.01)


def seeded(text: str) -> RoomPolicy:
    def seed(doc: Doc) -> None:
        doc.get("code", type=Text).insert(0, text)

    return RoomPolicy(persist=True, classroom_id=CLASSROOM, assignment_id=ASSIGNMENT, seed=seed)


def edit_update(existing: bytes, insert_at: int, text: str) -> bytes:
    """What a browser sends after typing `text` into a document it synced."""
    doc = Doc()
    doc.apply_update(existing)
    before = doc.get_state()
    doc.get("code", type=Text).insert(insert_at, text)
    return bytes([TAG_DOC]) + doc.get_update(before)


def run(coro):
    return asyncio.run(coro)


def test_new_room_is_seeded_once_and_joiners_get_synced_marker(session_factory):
    async def scenario():
        m = make_manager(session_factory)
        a, b = FakeSocket(), FakeSocket()
        assert await m.connect(ROOM, a, seeded("# start\n"))
        assert await m.connect(ROOM, b, seeded("# start\n"))
        assert a.sent[-1] == bytes([TAG_SYNCED]) and b.sent[-1] == bytes([TAG_SYNCED])
        # Both see the starter exactly once, no duplicate from a second seed.
        assert a.text() == "# start\n" and b.text() == "# start\n"

    run(scenario())


def test_edits_survive_everyone_leaving_and_a_server_restart(session_factory):
    async def scenario():
        m = make_manager(session_factory)
        a = FakeSocket()
        await m.connect(ROOM, a, seeded("# start\n"))
        state = a.sent[0][1:]
        assert await m.handle_message(ROOM, a, edit_update(state, 8, "print('kept')\n"))
        await m.disconnect(ROOM, a)  # last one out: saved immediately

        restarted = make_manager(session_factory)  # fresh process, empty memory
        c = FakeSocket()
        await restarted.connect(ROOM, c, seeded("# start\n"))
        # Saved content comes back; the starter is not inserted a second time.
        assert c.text() == "# start\nprint('kept')\n"

    run(scenario())


def test_seeded_room_survives_a_restart_without_duplicating(session_factory):
    """A browser that saw the seed, then reconnects after a server restart
    before anyone typed, must not end up with the starter code twice."""

    async def scenario():
        m = make_manager(session_factory)
        a = FakeSocket()
        await m.connect(ROOM, a, seeded("# start\n"))
        await asyncio.sleep(0.1)  # seeded state is saved without any edit
        browser_copy = a.sent[0][1:]

        restarted = make_manager(session_factory)
        b = FakeSocket()
        await restarted.connect(ROOM, b, seeded("# start\n"))
        # The reconnecting browser pushes its full state, as useCollab does.
        await restarted.handle_message(ROOM, b, bytes([TAG_DOC]) + browser_copy)
        c = FakeSocket()
        await restarted.connect(ROOM, c, seeded("# start\n"))
        assert c.text() == "# start\n"

    run(scenario())


def test_edits_are_saved_shortly_after_typing(session_factory):
    async def scenario():
        m = make_manager(session_factory)
        a = FakeSocket()
        await m.connect(ROOM, a, seeded(""))
        await m.handle_message(ROOM, a, edit_update(a.sent[0][1:], 0, "x = 1\n"))
        await asyncio.sleep(0.1)  # past the debounce
        db = session_factory()
        try:
            row = db.get(CollabDocument, ROOM)
            assert row is not None
            doc = Doc()
            doc.apply_update(row.state)
            assert str(doc.get("code", type=Text)) == "x = 1\n"
        finally:
            db.close()
        await m.disconnect(ROOM, a)

    run(scenario())


def test_edits_are_relayed_to_other_clients(session_factory):
    async def scenario():
        m = make_manager(session_factory)
        a, b = FakeSocket(), FakeSocket()
        await m.connect(ROOM, a, seeded("# start\n"))
        await m.connect(ROOM, b, seeded("# start\n"))
        await m.handle_message(ROOM, a, edit_update(a.sent[0][1:], 0, "# hi\n"))
        assert b.text() == "# hi\n# start\n"

    run(scenario())


def test_empty_updates_are_not_saved(session_factory):
    """An empty editor announcing itself must not create database rows."""
    drawing = f"drawing:{CLASSROOM}:{ASSIGNMENT}"

    async def scenario():
        m = make_manager(session_factory)
        a = FakeSocket()
        await m.connect(drawing, a, RoomPolicy(persist=True, classroom_id=CLASSROOM, assignment_id=ASSIGNMENT))
        assert await m.handle_message(drawing, a, bytes([TAG_DOC]) + Doc().get_update())
        await m.disconnect(drawing, a)
        db = session_factory()
        try:
            assert db.get(CollabDocument, drawing) is None
        finally:
            db.close()

    run(scenario())


def test_garbage_update_is_rejected_and_document_kept(session_factory):
    async def scenario():
        m = make_manager(session_factory)
        a, b = FakeSocket(), FakeSocket()
        await m.connect(ROOM, a, seeded("# start\n"))
        assert not await m.handle_message(ROOM, a, bytes([TAG_DOC]) + b"\x01\x02garbage")
        assert a.closed and a.closed[0] == 1003
        await m.connect(ROOM, b, seeded("# start\n"))
        assert b.text() == "# start\n"

    run(scenario())


def test_oversized_message_is_rejected(session_factory):
    async def scenario():
        m = make_manager(session_factory)
        a = FakeSocket()
        await m.connect(ROOM, a, seeded(""))
        assert not await m.handle_message(ROOM, a, bytes([TAG_DOC]) + b"x" * MAX_MESSAGE_BYTES)
        assert a.closed and a.closed[0] == 1009

    run(scenario())


def test_document_size_cap(session_factory, monkeypatch):
    monkeypatch.setattr("app.core.collab_manager.MAX_DOC_BYTES", 200)

    async def scenario():
        m = make_manager(session_factory)
        a = FakeSocket()
        await m.connect(ROOM, a, seeded(""))
        assert not await m.handle_message(ROOM, a, edit_update(a.sent[0][1:], 0, "y" * 500))
        assert a.closed and a.closed[0] == 4413

    run(scenario())


def test_demo_rooms_are_never_written_to_the_database(session_factory):
    async def scenario():
        m = make_manager(session_factory)
        demo_room = f"demo:{uuid.uuid4()}:hello"
        a = FakeSocket()
        await m.connect(demo_room, a, RoomPolicy(persist=False, seed=seeded("hi").seed))
        await m.handle_message(demo_room, a, edit_update(a.sent[0][1:], 0, "x"))
        await m.disconnect(demo_room, a)
        db = session_factory()
        try:
            assert db.query(CollabDocument).count() == 0
        finally:
            db.close()

    run(scenario())


def test_unreadable_saved_state_is_not_overwritten(session_factory):
    db = session_factory()
    db.add(CollabDocument(room_id=ROOM, classroom_id=CLASSROOM, assignment_id=ASSIGNMENT, state=b"\x01broken"))
    db.commit()
    db.close()

    async def scenario():
        m = make_manager(session_factory)
        a = FakeSocket()
        assert not await m.connect(ROOM, a, seeded("# start\n"))
        assert a.closed and a.closed[0] == 4500

    run(scenario())
    db = session_factory()
    try:
        assert db.get(CollabDocument, ROOM).state == b"\x01broken"
    finally:
        db.close()


def test_rooms_per_assignment_cap(session_factory, monkeypatch):
    monkeypatch.setattr(collab_store, "MAX_ROOMS_PER_ASSIGNMENT", 0)

    async def scenario():
        m = make_manager(session_factory)
        a = FakeSocket()
        assert not await m.connect(ROOM, a, seeded(""))
        assert a.closed and a.closed[0] == 4429

    run(scenario())


def test_room_policies(session_factory):
    db = session_factory()
    try:
        assert policy_for_room(db, "") is None
        assert policy_for_room(db, "x" * 300) is None
        assert policy_for_room(db, "not-a-room") is None

        main_file = policy_for_room(db, ROOM)
        assert main_file and main_file.persist and main_file.seed is not None
        other_file = policy_for_room(db, f"{CLASSROOM}:{ASSIGNMENT}:helper")
        assert other_file and other_file.persist and other_file.seed is None
        drawing = policy_for_room(db, f"drawing:{CLASSROOM}:{ASSIGNMENT}")
        assert drawing and drawing.persist and drawing.seed is None

        demo = policy_for_room(db, f"demo:{uuid.uuid4()}:page-en")
        assert demo and not demo.persist and demo.seed is not None
    finally:
        db.close()
