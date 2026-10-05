"""
WebSocket endpoint for collaborative editing (Yjs).

The server acts as a simple relay: it forwards binary Yjs updates between all
clients connected to the same room. Conflict resolution is handled on the
client by Yjs/CRDT logic.

Authentication: clients must pass a valid JWT via the `token` query parameter.
Authorisation: the room_id encodes a classroom + assignment; the user must
belong to that classroom (teacher, group member, or admin). See `ws_acl.py`.
"""

import logging
import uuid

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from jose import JWTError

from app.config import get_settings
from app.core.collab_manager import manager
from app.core.demo_auth import DEMO_COOKIE_NAME, decode_guest_token
from app.core.security import decode_access_token
from app.core.ws_acl import (
    _parse_room_id,
    guest_can_join_demo_room,
    parse_demo_room_id,
    user_can_join_room,
)
from app.db.session import SessionLocal
from app.dependencies import AUTH_COOKIE_NAME

logger = logging.getLogger(__name__)

router = APIRouter()


@router.websocket("/ws/collab/{room_id}")
async def collab_websocket(
    websocket: WebSocket,
    room_id: str,
) -> None:
    """
    Collaborative editing WebSocket. Requires a valid JWT in the `token` query param
    AND the user must be a member of the classroom encoded in `room_id`.
    """
    # Public demo rooms ("demo:<uuid>[:<file>]") are a separate population with
    # their own cookie and their own ACL. Handle them first and return, so a
    # demo room can never fall through into the real-user authorisation path
    # and a real user's token can never be used to reach a demo room.
    if parse_demo_room_id(room_id) is not None:
        await _handle_demo_room(websocket, room_id)
        return

    # Cookie first (browsers send it automatically on same-origin WS), then
    # fall back to the legacy ?token= query param for older clients.
    token = websocket.cookies.get(AUTH_COOKIE_NAME) or websocket.query_params.get("token")
    if not token:
        await websocket.close(code=4401, reason="Missing token")
        return

    try:
        settings = get_settings()
        payload = decode_access_token(token, settings=settings)
    except JWTError:
        await websocket.close(code=4401, reason="Invalid or expired token")
        return
    except Exception as exc:
        logger.exception("Unexpected error validating WebSocket token: %s", exc)
        await websocket.close(code=4500, reason="Internal error")
        return

    user_id = payload.get("sub")
    if not user_id:
        await websocket.close(code=4401, reason="Invalid token payload")
        return

    db = SessionLocal()
    try:
        allowed = user_can_join_room(db, user_id=user_id, room_id=room_id)
    finally:
        db.close()
    if not allowed:
        await websocket.close(code=4403, reason="Not authorised for this room")
        return

    room_key = _parse_room_id(room_id)
    try:
        uid_uuid = uuid.UUID(user_id)
    except (ValueError, TypeError):
        uid_uuid = None
    classroom_id = room_key.classroom_id if room_key else None

    await manager.connect(room_id, websocket, classroom_id=classroom_id, user_id=uid_uuid)
    try:
        while True:
            data = await websocket.receive_bytes()
            await manager.broadcast(room_id, data, sender=websocket)
    except WebSocketDisconnect:
        manager.disconnect(room_id, websocket)
    except Exception as exc:
        logger.warning("WebSocket error in room %s: %s", room_id, exc)
        manager.disconnect(room_id, websocket)


async def _handle_demo_room(websocket: WebSocket, room_id: str) -> None:
    """Relay Yjs updates for a public demo room.

    Authorisation comes from the guest cookie alone -- demo rooms are never
    reachable with a real user token. Close codes mirror the main path so the
    client can show a specific message instead of a generic disconnect:
      4401 missing/invalid guest token, 4403 wrong or expired room.
    """
    # Only the demo cookie is accepted here. Note there is no ?token= fallback:
    # a demo token in a URL would end up in browser history and server logs,
    # and the demo is browser-only so it has no need for one.
    token = websocket.cookies.get(DEMO_COOKIE_NAME)
    if not token:
        await websocket.close(
            code=4401,
            reason="No demo session. Open /demo to start one.",
        )
        return

    settings = get_settings()
    token_room_id = decode_guest_token(token, settings=settings)
    if token_room_id is None:
        # Covers an expired guest token, a tampered token, and a real user
        # token presented for a demo room.
        await websocket.close(
            code=4401,
            reason="Demo session expired. Open /demo to start a fresh one.",
        )
        return

    db = SessionLocal()
    try:
        allowed = guest_can_join_demo_room(db, token_room_id=token_room_id, room_id=room_id)
    except Exception as exc:
        logger.exception("Error authorising demo room %s: %s", room_id, exc)
        await websocket.close(code=4500, reason="Internal error")
        return
    finally:
        db.close()

    if not allowed:
        await websocket.close(
            code=4403,
            reason="This demo room has expired. Open /demo to start a fresh one.",
        )
        return

    # classroom_id/user_id stay None: demo guests are deliberately absent from
    # the per-classroom presence map that powers the real "Live Now" UI, so a
    # visitor can never appear inside a real teacher's classroom.
    await manager.connect(room_id, websocket)
    try:
        while True:
            data = await websocket.receive_bytes()
            await manager.broadcast(room_id, data, sender=websocket)
    except WebSocketDisconnect:
        manager.disconnect(room_id, websocket)
    except Exception as exc:
        logger.warning("Demo WebSocket error in room %s: %s", room_id, exc)
        manager.disconnect(room_id, websocket)
