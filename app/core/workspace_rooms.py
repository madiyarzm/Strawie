"""
Personal workspace rooms: a private notebook page (and whiteboard) per user.

  workspace:<user>          the page (text + Python blocks)
  workspace:<user>:draw     the whiteboard

Only the owner can open them; not even teachers or admins. Saved like
every other room, tied to the owner so they're deleted with the account.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from typing import Optional

PREFIX = "workspace"


@dataclass(frozen=True)
class WorkspaceRoom:
    owner_id: uuid.UUID
    kind: str  # "page" | "draw"


def parse_workspace_room(room_id: str) -> Optional[WorkspaceRoom]:
    if not room_id or not room_id.startswith(PREFIX + ":"):
        return None
    parts = room_id.split(":")
    if len(parts) not in (2, 3):
        return None
    try:
        owner = uuid.UUID(parts[1])
    except (ValueError, AttributeError):
        return None
    if str(owner) != parts[1]:
        return None  # one canonical name per room
    if len(parts) == 2:
        return WorkspaceRoom(owner, "page")
    if parts[2] == "draw":
        return WorkspaceRoom(owner, "draw")
    return None


def user_can_join_workspace_room(user, room: WorkspaceRoom) -> bool:
    return not getattr(user, "is_banned", False) and user.id == room.owner_id
