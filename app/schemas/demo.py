"""Schemas for the public demo endpoints."""

from datetime import datetime
from pydantic import BaseModel, Field


class DemoRoomCreated(BaseModel):
    """Response for a freshly created demo room."""

    room_id: str = Field(description="UUID of the new room; the visitor is sent to /demo/<room_id>.")
    expires_at: datetime


class DemoRoomOut(BaseModel):
    """Everything the demo workspace needs to render on first paint."""

    room_id: str
    expires_at: datetime
    # Yjs room id the client must use; the server owns this format so the
    # client cannot invent a room shape the ACL would have to guess about.
    # The pages themselves ("<collab_room_id>:page-en", ...) are seeded by
    # the collaboration server; see app/services/demo_seed.py.
    collab_room_id: str
