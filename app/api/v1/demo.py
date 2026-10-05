"""
Public demo endpoints: a working classroom in one click, no account.

These are the only unauthenticated write endpoints in the app, so every
handler here assumes a hostile caller:

  * Room creation is rate limited twice -- by slowapi per IP per hour, and by
    a database-backed per-IP count that survives container restarts.
  * Nothing here reads or writes the users/groups/classrooms graph.
  * No server-side code execution is offered to guests at all; the demo runs
    Python in the visitor's browser via Pyodide. See app/api/ws_sandbox.py,
    which explicitly refuses guest tokens.
  * Every rejection returns an explicit message, never a silent failure.
"""

import logging
import uuid

from fastapi import APIRouter, HTTPException, Request, Response, status

from app.core.demo_auth import create_guest_token, set_demo_cookie
from app.core.limiter import client_ip, limiter
from app.core.ws_acl import demo_collab_room_id
from app.dependencies import DBSession, SettingsDep
from app.schemas.demo import DemoRoomCreated, DemoRoomOut
from app.services.demo_seed import BANNER_LINES, seed_files
from app.services.demo_service import (
    count_recent_rooms_for_ip,
    create_room,
    get_active_room,
)

logger = logging.getLogger(__name__)

router = APIRouter()

# Message used for both the expired and the never-existed case. Identical on
# purpose: a caller probing room ids learns nothing about which it hit, and a
# real visitor with a stale link gets the one instruction that helps them.
_ROOM_GONE_DETAIL = (
    "This demo room has expired or does not exist. Start a fresh one at /demo."
)

_DISABLED_DETAIL = "The public demo is currently turned off. Please check back later."


def _require_demo_enabled(settings: SettingsDep) -> None:
    """Kill switch: DEMO_ENABLED=false takes the demo down without a redeploy."""
    if not settings.demo_enabled:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=_DISABLED_DETAIL,
        )


@router.post(
    "/rooms",
    response_model=DemoRoomCreated,
    status_code=status.HTTP_201_CREATED,
)
# Coarse burst guard, deliberately LOOSER than DEMO_ROOMS_PER_HOUR_PER_IP.
# Two limiters with one job would fight: slowapi's limit is a decorator and
# cannot read Settings at import time, so if it were set to the same number it
# would silently cap the configurable limit and raising the env var would do
# nothing. So slowapi only rejects an obvious flood cheaply, before any
# database work, and the configurable per-IP ceiling inside the handler is the
# authoritative limit.
@limiter.limit("30/hour")
def create_demo_room(
    request: Request,
    response: Response,
    db: DBSession,
    settings: SettingsDep,
) -> DemoRoomCreated:
    """Create a fresh ephemeral demo room and hand the caller a guest token."""
    _require_demo_enabled(settings)

    ip = client_ip(request)

    # Second, durable ceiling. slowapi's counters live in process memory and
    # reset on every container restart -- frequent on a free-tier host -- so
    # without this a restart loop would hand out unlimited rooms.
    rooms_last_hour = count_recent_rooms_for_ip(db, ip=ip, within_hours=1)
    if rooms_last_hour >= settings.demo_rooms_per_hour_per_ip:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=(
                "You've created several demo rooms recently. "
                "Please reuse your existing demo link, or try again in an hour."
            ),
        )

    rooms_last_day = count_recent_rooms_for_ip(db, ip=ip, within_hours=24)
    if rooms_last_day >= settings.demo_rooms_per_day_per_ip:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=(
                "The daily demo limit for your network has been reached. "
                "Please try again tomorrow."
            ),
        )

    room = create_room(db, ip=ip, ttl_hours=settings.demo_room_ttl_hours)

    token = create_guest_token(
        room_id=room.id,
        settings=settings,
        ttl_hours=settings.demo_room_ttl_hours,
    )
    set_demo_cookie(
        response,
        token,
        ttl_hours=settings.demo_room_ttl_hours,
        is_production=(settings.app_env == "production"),
    )

    logger.info("Created demo room %s", room.id)
    return DemoRoomCreated(room_id=str(room.id), expires_at=room.expires_at)


@router.get("/rooms/{room_id}", response_model=DemoRoomOut)
# Generous: the page may be reloaded, and the second tab fetches too. Still
# bounded so the endpoint cannot be used as a free database-read amplifier.
@limiter.limit("60/minute")
def get_demo_room(
    request: Request,
    room_id: str,
    db: DBSession,
    settings: SettingsDep,
) -> DemoRoomOut:
    """Return the seed contents of a demo room, or 404 if it is gone.

    Unauthenticated on purpose: this is how the "Open in second tab" link
    works, and the response contains nothing but static seed content.
    """
    _require_demo_enabled(settings)

    # Parse before touching the database so a garbage path segment cannot
    # reach the query layer.
    try:
        parsed_room_id = uuid.UUID(room_id)
    except (ValueError, AttributeError):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=_ROOM_GONE_DETAIL,
        )

    room = get_active_room(db, parsed_room_id)
    if room is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=_ROOM_GONE_DETAIL,
        )

    return DemoRoomOut(
        room_id=str(room.id),
        expires_at=room.expires_at,
        collab_room_id=demo_collab_room_id(room.id),
        files=seed_files(),  # type: ignore[arg-type]
        banner_lines=BANNER_LINES,
    )
