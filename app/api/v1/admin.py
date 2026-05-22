"""
Admin-only routes: platform stats, user bans, flagged submissions,
invite code management, and full group/classroom browsing.
"""

from datetime import datetime, timedelta, timezone
from uuid import UUID

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import func, select

from app.dependencies import DBSession, RequireAdmin
from app.models.classroom import Classroom
from app.models.group import Group
from app.models.group_membership import GroupMembership
from app.models.submission import Submission
from app.models.user import User
from app.schemas.user import UserRead
from app.services.code_flags import scan_code

router = APIRouter()


# ---------------------------------------------------------------------------
# Stats
# ---------------------------------------------------------------------------

@router.get("/stats")
def admin_stats(admin: RequireAdmin, db: DBSession) -> dict:
    """Platform-wide stats for the admin overview dashboard."""
    now = datetime.now(timezone.utc)
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    week_ago = now - timedelta(days=7)

    total_users = db.scalar(select(func.count()).select_from(User)) or 0
    total_submissions = db.scalar(select(func.count()).select_from(Submission)) or 0
    submissions_today = db.scalar(
        select(func.count()).select_from(Submission)
        .where(Submission.submitted_at >= today_start)
    ) or 0
    submissions_week = db.scalar(
        select(func.count()).select_from(Submission)
        .where(Submission.submitted_at >= week_ago)
    ) or 0
    accepted = db.scalar(
        select(func.count()).select_from(Submission)
        .where(Submission.status == "success")
    ) or 0
    total_groups = db.scalar(select(func.count()).select_from(Group)) or 0
    total_classrooms = db.scalar(select(func.count()).select_from(Classroom)) or 0
    banned_count = db.scalar(
        select(func.count()).select_from(User).where(User.is_banned == True)
    ) or 0

    active_today = db.scalar(
        select(func.count()).select_from(User)
        .where(User.last_active_at >= today_start)
    ) or 0

    signups_week = db.scalar(
        select(func.count()).select_from(User)
        .where(User.created_at >= week_ago)
    ) or 0

    pass_rate = round(accepted / total_submissions * 100, 1) if total_submissions > 0 else 0

    return {
        "total_users": total_users,
        "active_today": active_today,
        "signups_week": signups_week,
        "banned_count": banned_count,
        "total_groups": total_groups,
        "total_classrooms": total_classrooms,
        "total_submissions": total_submissions,
        "submissions_today": submissions_today,
        "submissions_week": submissions_week,
        "pass_rate": pass_rate,
    }


# ---------------------------------------------------------------------------
# Ban / Unban
# ---------------------------------------------------------------------------

class BanPayload(BaseModel):
    is_banned: bool
    reason: str | None = None


@router.patch("/users/{user_id}/ban", response_model=UserRead)
def toggle_ban(user_id: UUID, body: BanPayload, admin: RequireAdmin, db: DBSession) -> UserRead:
    """Ban or unban a user."""
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    if user.id == admin.id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot ban yourself")

    user.is_banned = body.is_banned
    user.ban_reason = body.reason if body.is_banned else None
    db.commit()
    db.refresh(user)
    return UserRead.model_validate(user)


# ---------------------------------------------------------------------------
# Recent signups
# ---------------------------------------------------------------------------

@router.get("/recent-signups", response_model=list[UserRead])
def recent_signups(admin: RequireAdmin, db: DBSession) -> list[UserRead]:
    """Users who signed up in the last 7 days, newest first."""
    week_ago = datetime.now(timezone.utc) - timedelta(days=7)
    users = db.execute(
        select(User).where(User.created_at >= week_ago).order_by(User.created_at.desc())
    ).scalars().all()
    return [UserRead.model_validate(u) for u in users]


# ---------------------------------------------------------------------------
# Flagged submissions (suspicious code)
# ---------------------------------------------------------------------------

@router.get("/flagged-submissions")
def flagged_submissions(admin: RequireAdmin, db: DBSession, days: int = 7) -> list[dict]:
    """Return recent submissions containing suspicious code patterns."""
    since = datetime.now(timezone.utc) - timedelta(days=min(days, 90))
    subs = db.execute(
        select(Submission)
        .where(Submission.submitted_at >= since)
        .order_by(Submission.submitted_at.desc())
    ).scalars().all()

    flagged = []
    for s in subs:
        flags = scan_code(s.code)
        if flags:
            submitter = db.get(User, s.user_id)
            flagged.append({
                "submission_id": str(s.id),
                "user_id": str(s.user_id),
                "user_name": submitter.name if submitter else "Unknown",
                "user_email": submitter.email if submitter else None,
                "assignment_id": str(s.assignment_id),
                "submitted_at": s.submitted_at.isoformat() if s.submitted_at else None,
                "code": s.code[:2000],
                "flags": flags,
            })
    return flagged


# ---------------------------------------------------------------------------
# Invite codes (all groups)
# ---------------------------------------------------------------------------

@router.get("/invite-codes")
def list_invite_codes(admin: RequireAdmin, db: DBSession) -> list[dict]:
    """List all groups with their invite codes."""
    groups = db.execute(
        select(Group).where(Group.invite_code.isnot(None)).order_by(Group.created_at.desc())
    ).scalars().all()

    result = []
    for g in groups:
        teacher = db.get(User, g.teacher_id)
        member_count = db.scalar(
            select(func.count()).select_from(GroupMembership)
            .where(GroupMembership.group_id == g.id)
        ) or 0
        result.append({
            "group_id": str(g.id),
            "group_name": g.name,
            "invite_code": g.invite_code,
            "teacher_name": teacher.name if teacher else "Unknown",
            "teacher_email": teacher.email if teacher else None,
            "member_count": member_count,
            "created_at": g.created_at.isoformat() if g.created_at else None,
        })
    return result


@router.delete("/invite-codes/{group_id}")
def revoke_invite_code(group_id: UUID, admin: RequireAdmin, db: DBSession) -> dict:
    """Revoke (nullify) a group's invite code so no new members can join."""
    group = db.get(Group, group_id)
    if group is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Group not found")
    group.invite_code = None
    db.commit()
    return {"status": "revoked"}


# ---------------------------------------------------------------------------
# Browse all groups → classrooms (admin read-only, no collab join)
# ---------------------------------------------------------------------------

@router.get("/groups")
def admin_list_groups(admin: RequireAdmin, db: DBSession) -> list[dict]:
    """List ALL groups with their classrooms and member counts."""
    groups = db.execute(select(Group).order_by(Group.created_at.desc())).scalars().all()
    result = []
    for g in groups:
        teacher = db.get(User, g.teacher_id)
        member_count = db.scalar(
            select(func.count()).select_from(GroupMembership)
            .where(GroupMembership.group_id == g.id)
        ) or 0
        classrooms = db.execute(
            select(Classroom).where(Classroom.group_id == g.id).order_by(Classroom.created_at)
        ).scalars().all()
        result.append({
            "id": str(g.id),
            "name": g.name,
            "invite_code": g.invite_code,
            "teacher_name": teacher.name if teacher else "Unknown",
            "member_count": member_count,
            "created_at": g.created_at.isoformat() if g.created_at else None,
            "classrooms": [
                {"id": str(c.id), "name": c.name, "created_at": c.created_at.isoformat() if c.created_at else None}
                for c in classrooms
            ],
        })
    return result
