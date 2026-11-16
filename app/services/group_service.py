"""
Business logic for groups and group memberships.

Groups are the top-level container: students join a group once and gain
access to all classrooms within it.
"""

import secrets
from typing import List
from uuid import UUID

from sqlalchemy.orm import Session, joinedload

from app.models.group import Group
from app.models.group_membership import GroupMembership
from app.models.user import User


def _generate_invite_code() -> str:
    """Generate a short URL-safe invite code for groups."""
    return secrets.token_urlsafe(6)


def create_group(
    db: Session, teacher: User, name: str, description: str | None, schedule: dict | None = None
) -> Group:
    """
    Create a new group owned by the given teacher.

    Returns:
        Persisted Group instance with an auto-generated invite code.
    """
    group = Group(
        teacher_id=teacher.id,
        name=name,
        description=description,
        invite_code=_generate_invite_code(),
        schedule=schedule,
    )
    db.add(group)
    db.commit()
    db.refresh(group)
    return group


def get_group_or_404(db: Session, group_id: UUID) -> Group:
    """Retrieve a group or raise ValueError if not found."""
    group = db.get(Group, group_id)
    if group is None:
        raise ValueError("Group not found")
    return group


def join_group_by_invite_code(db: Session, user: User, invite_code: str) -> GroupMembership:
    """
    Join a group using its invite code.

    Raises:
        ValueError: If no group exists with that invite code.
        PermissionError: If the user is the group owner (implicit access).
    """
    group = db.query(Group).filter(Group.invite_code == invite_code).one_or_none()
    if group is None:
        raise ValueError("Invalid invite code")

    if group.teacher_id == user.id:
        raise PermissionError("You are the owner of this group and already have access")

    existing = (
        db.query(GroupMembership)
        .filter(GroupMembership.group_id == group.id, GroupMembership.user_id == user.id)
        .one_or_none()
    )
    if existing:
        return existing

    membership = GroupMembership(group_id=group.id, user_id=user.id, role="student")
    db.add(membership)
    db.commit()
    db.refresh(membership)
    return membership


def list_groups_for_user(db: Session, user: User) -> List[Group]:
    """
    List groups where the user is either the owner or a member.

    Returns:
        List of Group instances visible to this user.
    """
    owned = db.query(Group).filter(Group.teacher_id == user.id)
    member_of = (
        db.query(Group)
        .join(GroupMembership, GroupMembership.group_id == Group.id)
        .filter(GroupMembership.user_id == user.id)
    )

    groups_by_id: dict[UUID, Group] = {}
    for g in owned.union(member_of).all():
        groups_by_id[g.id] = g
    return list(groups_by_id.values())


def get_member_count(db: Session, group_id: UUID) -> int:
    """Return the number of members in a group (excluding the owner)."""
    return db.query(GroupMembership).filter(GroupMembership.group_id == group_id).count()


def list_group_members(db: Session, group: Group) -> List[dict]:
    """
    List all members of a group with user details.

    Returns:
        List of dicts with membership + user info.
    """
    memberships = (
        db.query(GroupMembership)
        .options(joinedload(GroupMembership.user))
        .filter(GroupMembership.group_id == group.id)
        .order_by(GroupMembership.joined_at.asc())
        .all()
    )

    return [
        {
            "id": m.id,
            "user_id": m.user_id,
            "name": m.user.name if m.user else "Unknown",
            "email": m.user.email if m.user else "",
            "role": m.role,
            "joined_at": m.joined_at,
        }
        for m in memberships
    ]


def delete_group(db: Session, group: Group) -> None:
    """Delete a group and all its memberships. Only call after verifying ownership."""
    db.delete(group)
    db.commit()


def remove_member(db: Session, group: Group, user_id: UUID) -> None:
    """
    Remove a member from a group.

    Raises:
        ValueError: If the membership does not exist.
    """
    membership = (
        db.query(GroupMembership)
        .filter(GroupMembership.group_id == group.id, GroupMembership.user_id == user_id)
        .one_or_none()
    )
    if membership is None:
        raise ValueError("User is not a member of this group")
    db.delete(membership)
    db.commit()


def is_user_in_group(db: Session, group_id: UUID, user: User) -> bool:
    """Check whether a user is the owner of or a member of the given group."""
    group = db.get(Group, group_id)
    if group is None:
        return False
    if group.teacher_id == user.id:
        return True
    return (
        db.query(GroupMembership)
        .filter(GroupMembership.group_id == group_id, GroupMembership.user_id == user.id)
        .one_or_none()
    ) is not None
