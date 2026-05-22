"""
Pydantic schemas for User entity.

Used to control what user data is returned to clients.
"""

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, HttpUrl


class UserBase(BaseModel):
    """
    Base fields shared across user schemas.
    """

    email: str
    name: str
    role: str


class UserRead(UserBase):
    """
    User data returned to authenticated clients.
    """

    id: UUID
    picture_url: HttpUrl | None = None
    role_locked: bool
    is_banned: bool = False
    ban_reason: str | None = None
    last_active_at: datetime | None = None
    created_at: datetime
    updated_at: datetime

    class Config:
        """
        ORM mode allows constructing this schema directly from SQLAlchemy model instances.
        """

        from_attributes = True


class RoleChoice(BaseModel):
    """Body for the first-time role selection endpoint.

    The user submits this exactly once on signup. The server enforces that
    ``role_locked`` was False — repeated calls return 409.
    """

    role: str


class TokenResponse(BaseModel):
    """
    Response schema for authentication endpoints that issue JWTs.
    """

    access_token: str
    token_type: str = "bearer"


class UserRoleUpdate(BaseModel):
    """
    Request body for updating a user's role. Admin-only.
    """

    role: str

    class Config:
        json_schema_extra = {"example": {"role": "teacher"}}

