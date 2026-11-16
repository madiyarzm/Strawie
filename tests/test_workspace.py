"""Personal workspaces: private to their owner, saved on the server."""

import asyncio
import uuid
from types import SimpleNamespace

from pycrdt import Array, Doc
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.collab_manager import CollabRoomManager
from app.core.collab_store import policy_for_room
from app.core.workspace_rooms import WorkspaceRoom, parse_workspace_room, user_can_join_workspace_room
from app.db.session import Base
from app.models.collab_document import CollabDocument


def test_workspace_room_names_are_strict():
    uid = uuid.uuid4()
    assert parse_workspace_room(f"workspace:{uid}") == WorkspaceRoom(uid, "page")
    assert parse_workspace_room(f"workspace:{uid}:draw") == WorkspaceRoom(uid, "draw")
    for bad in [f"workspace:{uid}:secret", f"workspace:{str(uid).upper()}", "workspace:nope", f"workspace:{uid}:draw:x"]:
        assert parse_workspace_room(bad) is None, bad


def test_only_the_owner_can_open_a_workspace():
    owner = SimpleNamespace(id=uuid.uuid4(), role="student", is_banned=False)
    teacher = SimpleNamespace(id=uuid.uuid4(), role="teacher", is_banned=False)
    admin = SimpleNamespace(id=uuid.uuid4(), role="admin", is_banned=False)
    room = WorkspaceRoom(owner.id, "page")
    assert user_can_join_workspace_room(owner, room)
    assert not user_can_join_workspace_room(teacher, room)
    assert not user_can_join_workspace_room(admin, room)
    owner.is_banned = True
    assert not user_can_join_workspace_room(owner, room)


class FakeSocket:
    def __init__(self):
        self.sent = []

    async def accept(self):
        pass

    async def send_bytes(self, data):
        self.sent.append(bytes(data))

    async def close(self, code=1000, reason=""):
        pass


def test_workspace_page_is_seeded_and_saved_under_its_owner():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine, tables=[CollabDocument.__table__])
    factory = sessionmaker(bind=engine)
    uid = uuid.uuid4()
    room = f"workspace:{uid}"

    async def scenario():
        db = factory()
        policy = policy_for_room(db, room)
        db.close()
        assert policy is not None and policy.persist and policy.user_id == uid
        m = CollabRoomManager(session_factory=factory, save_delay=0.01)
        ws = FakeSocket()
        assert await m.connect(room, ws, policy)
        doc = Doc()
        doc.apply_update(ws.sent[0][1:])
        assert len(doc.get("blocks", type=Array)) == 2  # a text and a code block to start
        await m.disconnect(room, ws)

    asyncio.run(scenario())
    db = factory()
    try:
        row = db.get(CollabDocument, room)
        assert row is not None and row.user_id == uid
    finally:
        db.close()
