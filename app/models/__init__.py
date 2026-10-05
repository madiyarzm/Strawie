"""Re-export all models so Alembic and app can import from app.models."""

from app.models.assignment import Assignment
from app.models.classroom import Classroom
from app.models.demo_room import DemoRoom
from app.models.group import Group
from app.models.group_membership import GroupMembership
from app.models.submission import Submission
from app.models.user import User

__all__ = ["User", "Group", "GroupMembership", "Classroom", "Assignment", "Submission", "DemoRoom"]
