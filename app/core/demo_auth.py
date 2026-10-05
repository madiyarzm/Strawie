"""
Guest identity for the public demo.

A guest is NOT a User. There is no row in `users`, so every existing code
path that resolves `CurrentUser` (and therefore every authenticated REST
route, including /admin) rejects a guest by construction. This module only
mints and verifies a narrowly-scoped token that proves "the bearer opened
demo room X before it expired".

Three deliberate design choices, each closing a specific hole:

  1. A separate cookie name (`DEMO_COOKIE_NAME`) from the real session
     cookie. If the demo reused `lambda_token`, a logged-in teacher who
     clicked "Try demo" would have their real session silently overwritten,
     and a guest token would travel on every request to real endpoints.
     Separate cookies mean the two sessions coexist and never cross.

  2. A positive `typ: "guest"` claim, checked by `is_guest_payload`. Real
     user tokens never carry it. `app/dependencies.py` rejects any token
     with it, so even if a guest token is deliberately replayed in the
     Authorization header it cannot stand in for a user.

  3. The room id is bound into the token (`demo_room`). A guest can only
     ever act on the one room their token names, so one visitor cannot
     join, read, or write another visitor's room.
"""

import uuid
from typing import Any, Dict, Optional

from fastapi import Response
from jose import JWTError

from app.config import Settings
from app.core.security import create_access_token, decode_access_token

# Separate from AUTH_COOKIE_NAME ("lambda_token") on purpose — see module docstring.
DEMO_COOKIE_NAME = "strawie_demo"

# Positive marker claim. Real user tokens have no `typ`.
GUEST_TOKEN_TYPE = "guest"

# Role string surfaced to the frontend and used by the Yjs presence UI.
GUEST_ROLE = "guest"


def create_guest_token(*, room_id: uuid.UUID, settings: Settings, ttl_hours: int) -> str:
    """Mint a guest token scoped to exactly one demo room.

    `sub` is prefixed with "guest:" so it can never be mistaken for, or
    collide with, a real user's UUID `sub`.
    """
    return create_access_token(
        data={
            "sub": f"guest:{room_id}",
            "typ": GUEST_TOKEN_TYPE,
            "role": GUEST_ROLE,
            "demo_room": str(room_id),
        },
        settings=settings,
        # Token lifetime matches the room TTL so a token cannot outlive its room.
        expires_minutes=ttl_hours * 60,
    )


def is_guest_payload(payload: Dict[str, Any]) -> bool:
    """True if a decoded JWT payload is a demo guest token."""
    return payload.get("typ") == GUEST_TOKEN_TYPE


def decode_guest_token(token: str, settings: Settings) -> Optional[uuid.UUID]:
    """Verify a guest token and return the demo room UUID it is scoped to.

    Returns None for anything that is not a valid, unexpired guest token —
    including a perfectly valid *user* token, which must not be usable to
    reach demo rooms. Callers treat None as "not authorised".
    """
    try:
        payload = decode_access_token(token, settings=settings)
    except JWTError:
        return None
    except Exception:
        # Malformed input of any shape is simply unauthorised; never raise
        # out of an auth check.
        return None

    if not is_guest_payload(payload):
        return None

    raw_room = payload.get("demo_room")
    if not isinstance(raw_room, str):
        return None
    try:
        return uuid.UUID(raw_room)
    except (ValueError, AttributeError):
        return None


def set_demo_cookie(
    response: Response, token: str, *, ttl_hours: int, is_production: bool
) -> None:
    """Attach the guest token cookie.

    Flags mirror the real session cookie: httponly so page scripts cannot
    read it, samesite=lax so a top-level navigation to /demo/<id> carries
    it, secure in production only.
    """
    response.set_cookie(
        key=DEMO_COOKIE_NAME,
        value=token,
        max_age=ttl_hours * 3600,
        httponly=True,
        secure=is_production,
        samesite="lax",
        path="/",
    )
