"""
User routes.

Exposes endpoints for user profile, stats, cosmetics, activity, and admin user management.
"""

from datetime import datetime, timedelta, timezone
from uuid import UUID

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import func, select

from app.dependencies import CurrentUser, DBSession, RequireAdmin
from app.models.submission import Submission
from app.models.user import User
from app.schemas.user import RoleChoice, UserRead, UserRoleUpdate

_ALLOWED_ROLES = ("teacher", "student")

router = APIRouter()


@router.get("/me/stats")
def get_my_stats(current_user: CurrentUser, db: DBSession) -> dict:
    """Return XP and submission stats for the authenticated user.

    Read-only: XP is maintained on the submission write path
    (``submission_service.create_submission``), so this endpoint is safe and
    idempotent — multiple calls don't change state.
    """
    total = db.execute(
        select(func.count()).select_from(Submission).where(Submission.user_id == current_user.id)
    ).scalar_one()
    accepted = db.execute(
        select(func.count())
        .select_from(Submission)
        .where(Submission.user_id == current_user.id, Submission.status == "success")
    ).scalar_one()
    return {
        "xp": current_user.xp or 0,
        "submissions_total": total,
        "submissions_accepted": accepted,
    }


@router.get("/me", response_model=UserRead)
def get_current_user_profile(current_user: CurrentUser) -> UserRead:
    """Return profile information for the authenticated user."""
    return UserRead.model_validate(current_user)


@router.post("/me/role", response_model=UserRead)
def choose_role(
    body: RoleChoice,
    current_user: CurrentUser,
    db: DBSession,
) -> UserRead:
    """One-shot role selection on first login.

    Returns 409 if the role is already locked — by design, role choice is
    permanent so there's no way to swap to teacher later and gain access to
    data you saw as a student.
    """
    if current_user.role_locked:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Role already chosen and cannot be changed.",
        )
    if body.role not in _ALLOWED_ROLES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Role must be one of {_ALLOWED_ROLES}.",
        )
    current_user.role = body.role
    current_user.role_locked = True
    db.commit()
    db.refresh(current_user)
    return UserRead.model_validate(current_user)


# ---------------------------------------------------------------------------
# Cosmetics
# ---------------------------------------------------------------------------

_ALLOWED_COSMETIC_KEYS = {"frame", "background", "aura"}
_MAX_COSMETIC_VALUE_LEN = 64


class CosmeticsUpdate(BaseModel):
    cosmetics: dict


@router.get("/me/cosmetics")
def get_cosmetics(current_user: CurrentUser) -> dict:
    """Return the authenticated user's cosmetics settings."""
    return current_user.cosmetics or {}


@router.put("/me/cosmetics")
def update_cosmetics(body: CosmeticsUpdate, current_user: CurrentUser, db: DBSession) -> dict:
    """Update the authenticated user's cosmetics settings."""
    sanitized: dict[str, str] = {}
    for k, v in body.cosmetics.items():
        if k not in _ALLOWED_COSMETIC_KEYS:
            continue
        if not isinstance(v, str) or len(v) > _MAX_COSMETIC_VALUE_LEN:
            continue
        sanitized[k] = v
    current_user.cosmetics = sanitized
    db.commit()
    db.refresh(current_user)
    return current_user.cosmetics or {}


# ---------------------------------------------------------------------------
# Activity heatmap
# ---------------------------------------------------------------------------

@router.get("/me/activity")
def get_activity(current_user: CurrentUser, db: DBSession) -> dict:
    """
    Return daily submission counts for the past 90 days.
    Response: { "days": [{"date": "YYYY-MM-DD", "count": N}, ...] }
    """
    now = datetime.now(timezone.utc)
    since = now - timedelta(days=89)

    rows = db.execute(
        select(
            func.date_trunc("day", Submission.submitted_at).label("day"),
            func.count().label("cnt"),
        )
        .where(
            Submission.user_id == current_user.id,
            Submission.submitted_at >= since,
        )
        .group_by("day")
        .order_by("day")
    ).all()

    counts: dict[str, int] = {row.day.strftime("%Y-%m-%d"): row.cnt for row in rows}

    days = []
    for i in range(90):
        d = (since + timedelta(days=i)).strftime("%Y-%m-%d")
        days.append({"date": d, "count": counts.get(d, 0)})

    return {"days": days}


# ---------------------------------------------------------------------------
# Admin
# ---------------------------------------------------------------------------

@router.get("/", response_model=list[UserRead])
def list_users(admin: RequireAdmin, db: DBSession) -> list[UserRead]:
    """Return all registered users. Admin-only."""
    users = db.execute(select(User).order_by(User.created_at)).scalars().all()
    return [UserRead.model_validate(u) for u in users]


@router.patch("/{user_id}/role", response_model=UserRead)
def update_user_role(user_id: UUID, body: UserRoleUpdate, admin: RequireAdmin, db: DBSession) -> UserRead:
    """Update a user's role. Admin-only. Allowed roles: teacher, student."""
    if body.role not in ("teacher", "student"):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Role must be 'teacher' or 'student'")

    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    user.role = body.role
    db.commit()
    db.refresh(user)
    return UserRead.model_validate(user)
