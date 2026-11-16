"""
Live-editing rooms: relay, in-memory document, and saving.

Wire format (binary WebSocket messages, first byte is a tag):
  0  Yjs document update   client → server → other clients (also saved)
  1  awareness update      client → server → other clients (cursors; never saved)
  2  "synced" marker       server → client, right after the saved state is sent

The server keeps one pycrdt Doc per open room. On join, the newcomer gets the
document's full state followed by the synced marker, so it never has to guess
whether a room is empty. Saved rooms are written to the database about two
seconds after the last edit, when the last person leaves, and on shutdown.

pycrdt only decodes and merges CRDT data; nothing in a document is executed.
"""

from __future__ import annotations

import asyncio
import logging
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Callable, Dict, Optional, Set
from uuid import UUID

from fastapi import WebSocket
from pycrdt import Doc

from app.core import collab_store
from app.core.collab_store import MAX_DOC_BYTES, MAX_MESSAGE_BYTES, RoomPolicy

logger = logging.getLogger(__name__)

TAG_DOC = 0
TAG_AWARENESS = 1
TAG_SYNCED = 2

SAVE_DELAY_SECONDS = 2.0

# Yjs encoding of an update with no items and an empty delete set.
EMPTY_UPDATE = b"\x00\x00"


@dataclass
class _Room:
    clients: Set[WebSocket] = field(default_factory=set)
    doc: Optional[Doc] = None
    policy: Optional[RoomPolicy] = None
    approx_size: int = 0
    dirty: bool = False
    joining: int = 0
    save_task: Optional[asyncio.Task] = None
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)


def _default_session_factory():
    from app.db.session import SessionLocal

    return SessionLocal()


class CollabRoomManager:
    """
    In-memory room manager for collaborative editing WebSockets.

    Also tracks per-classroom presence (distinct user_ids connected to any
    room scoped to that classroom). Used by the "Live Now" UI.
    """

    def __init__(
        self,
        *,
        session_factory: Callable = _default_session_factory,
        save_delay: float = SAVE_DELAY_SECONDS,
    ) -> None:
        self._rooms: Dict[str, _Room] = {}
        self._session_factory = session_factory
        self._save_delay = save_delay
        # classroom_id -> {user_id -> connection count}
        self._presence: Dict[UUID, Dict[UUID, int]] = defaultdict(lambda: defaultdict(int))
        # websocket -> (classroom_id, user_id) for cleanup
        self._socket_meta: Dict[WebSocket, tuple[UUID, UUID]] = {}

    # ── blocking DB helpers (run in a thread) ──────────────────────────────

    def _load_blocking(self, room_id: str, policy: RoomPolicy) -> tuple[Optional[bytes], bool]:
        """Return (saved_state, may_create)."""
        if not policy.persist:
            return None, True
        db = self._session_factory()
        try:
            state = collab_store.load_state(db, room_id)
            if state is not None:
                return state, True
            return None, collab_store.can_create_room(db, policy)
        finally:
            db.close()

    def _load_source_blocking(self, room_id: str) -> Doc:
        db = self._session_factory()
        try:
            return collab_store.load_source_doc(db, room_id)
        finally:
            db.close()

    async def _source_doc(self, room_id: str) -> Doc:
        live = self._rooms.get(room_id)
        if live is not None and live.doc is not None:
            return live.doc
        return await asyncio.to_thread(self._load_source_blocking, room_id)

    def _save_blocking(self, room_id: str, policy: RoomPolicy, state: bytes) -> None:
        db = self._session_factory()
        try:
            collab_store.save_state(db, room_id, policy, state)
        finally:
            db.close()

    # ── connection lifecycle ───────────────────────────────────────────────

    async def connect(
        self,
        room_id: str,
        websocket: WebSocket,
        policy: RoomPolicy,
        classroom_id: Optional[UUID] = None,
        user_id: Optional[UUID] = None,
    ) -> bool:
        """Load (or seed) the room, accept the socket and send it the current state.

        Returns False if the socket was refused and closed.
        """
        room = self._rooms.setdefault(room_id, _Room())
        room.joining += 1
        try:
            async with room.lock:
                if room.doc is None:
                    try:
                        state, may_create = await asyncio.to_thread(self._load_blocking, room_id, policy)
                    except Exception as exc:
                        logger.exception("Could not load room %s: %s", room_id, exc)
                        await websocket.close(code=4500, reason="Could not load this file. Try again.")
                        return False
                    if state is None and not may_create:
                        await websocket.close(code=4429, reason="This assignment has too many files.")
                        return False
                    doc = Doc()
                    if state:
                        try:
                            doc.apply_update(state)
                        except Exception as exc:
                            # Never silently replace a saved document: refuse
                            # the room so the data stays intact for recovery.
                            logger.error("Saved state for room %s is unreadable: %s", room_id, exc)
                            await websocket.close(code=4500, reason="This file could not be opened.")
                            return False
                    elif policy.seed_from is not None and policy.transform is not None:
                        # A personal copy (solo page, student homework) is
                        # built once from its source: the live in-memory
                        # version if that room is open, else the saved one.
                        source = await self._source_doc(policy.seed_from)
                        policy.transform(source, doc)
                        room.dirty = policy.persist
                    elif policy.seed is not None:
                        policy.seed(doc)
                        # Save the seeded state right away. Otherwise a server
                        # restart before anyone types would seed again with
                        # new item ids, and a reconnecting browser still
                        # holding the first copy would merge both: the starter
                        # code would appear twice.
                        room.dirty = policy.persist
                    room.doc = doc
                    room.policy = policy
                    room.approx_size = len(doc.get_update())

            await websocket.accept()
            room.clients.add(websocket)
            if classroom_id is not None and user_id is not None:
                self._presence[classroom_id][user_id] += 1
                self._socket_meta[websocket] = (classroom_id, user_id)
            assert room.doc is not None
            await websocket.send_bytes(bytes([TAG_DOC]) + room.doc.get_update())
            await websocket.send_bytes(bytes([TAG_SYNCED]))
            if room.dirty:
                self._schedule_save(room_id, room)
            return True
        finally:
            room.joining -= 1
            if not room.clients and room.joining == 0 and room.doc is None:
                self._rooms.pop(room_id, None)

    async def disconnect(self, room_id: str, websocket: WebSocket) -> None:
        """Remove a socket; save and unload the room when the last one leaves."""
        self._remove_presence(websocket)
        room = self._rooms.get(room_id)
        if room is None:
            return
        room.clients.discard(websocket)
        if room.clients or room.joining:
            return
        if room.save_task and not room.save_task.done():
            room.save_task.cancel()
        await self._flush(room_id, room)
        # Someone may have joined while we were saving.
        if not room.clients and not room.joining and self._rooms.get(room_id) is room:
            self._rooms.pop(room_id, None)

    def _remove_presence(self, websocket: WebSocket) -> None:
        meta = self._socket_meta.pop(websocket, None)
        if meta is None:
            return
        classroom_id, user_id = meta
        users = self._presence.get(classroom_id)
        if users and user_id in users:
            users[user_id] -= 1
            if users[user_id] <= 0:
                users.pop(user_id, None)
            if not users:
                self._presence.pop(classroom_id, None)

    # ── messages ───────────────────────────────────────────────────────────

    async def handle_message(self, room_id: str, websocket: WebSocket, data: bytes) -> bool:
        """Process one message. Returns False if the socket was closed."""
        if not data:
            return True
        if len(data) > MAX_MESSAGE_BYTES:
            await websocket.close(code=1009, reason="Message too large.")
            return False
        tag = data[0]
        if tag == TAG_AWARENESS:
            await self.broadcast(room_id, data, sender=websocket)
            return True
        if tag != TAG_DOC:
            return True  # unknown tags are ignored

        room = self._rooms.get(room_id)
        if room is None or room.doc is None:
            return True
        update = data[1:]
        if update == EMPTY_UPDATE:
            # A client with an empty document announcing itself on connect:
            # nothing to merge, relay, or save.
            return True
        if room.approx_size + len(update) > MAX_DOC_BYTES:
            room.approx_size = len(room.doc.get_update())
            if room.approx_size + len(update) > MAX_DOC_BYTES:
                await websocket.close(code=4413, reason="This file is too large to save.")
                return False
        try:
            room.doc.apply_update(update)
        except Exception:
            await websocket.close(code=1003, reason="Invalid document update.")
            return False
        room.approx_size += len(update)
        await self.broadcast(room_id, data, sender=websocket)
        if room.policy is not None and room.policy.persist:
            room.dirty = True
            self._schedule_save(room_id, room)
        return True

    async def broadcast(self, room_id: str, data: bytes, sender: WebSocket) -> None:
        """Send binary data to all clients in the room except the sender."""
        room = self._rooms.get(room_id)
        if room is None:
            return
        for client in list(room.clients):
            if client is sender:
                continue
            try:
                await client.send_bytes(data)
            except Exception as exc:
                logger.warning("Dropping unresponsive client in room %s: %s", room_id, exc)
                room.clients.discard(client)
                self._remove_presence(client)

    # ── saving ─────────────────────────────────────────────────────────────

    def _schedule_save(self, room_id: str, room: _Room) -> None:
        if room.save_task and not room.save_task.done():
            return

        async def later() -> None:
            await asyncio.sleep(self._save_delay)
            await self._flush(room_id, room)

        room.save_task = asyncio.create_task(later())

    async def _flush(self, room_id: str, room: _Room) -> None:
        if not room.dirty or room.doc is None or room.policy is None:
            return
        room.dirty = False
        state = room.doc.get_update()
        room.approx_size = len(state)
        try:
            await asyncio.to_thread(self._save_blocking, room_id, room.policy, state)
        except Exception as exc:
            room.dirty = True  # keep it in memory and retry on the next change / leave
            logger.exception("Could not save room %s: %s", room_id, exc)

    async def flush_all(self) -> None:
        """Save every open room (called on shutdown)."""
        for room_id, room in list(self._rooms.items()):
            if room.save_task and not room.save_task.done():
                room.save_task.cancel()
            await self._flush(room_id, room)

    def open_doc(self, room_id: str) -> Optional[Doc]:
        """The live document of an open room (read on the event loop only)."""
        room = self._rooms.get(room_id)
        return room.doc if room is not None else None

    # ── presence ───────────────────────────────────────────────────────────

    def active_user_count(self, classroom_id: UUID) -> int:
        """Number of distinct users currently connected to any room in this classroom."""
        return len(self._presence.get(classroom_id, {}))

    def active_user_ids(self, classroom_id: UUID) -> Set[UUID]:
        """Distinct user_ids currently connected to any room in this classroom."""
        return set(self._presence.get(classroom_id, {}).keys())


manager = CollabRoomManager()
