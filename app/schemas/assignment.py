"""
Pydantic schemas for Assignment and Submission entities.

Assignments define what students should implement; submissions capture
their code and the result of running it in the student's browser.
"""

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field


class AssignmentBase(BaseModel):
    """
    Shared fields for assignment creation and updates.
    """

    title: str = Field(min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=10_000)
    template_code: str | None = Field(default=None, max_length=50_000)
    test_code: str | None = Field(default=None, max_length=50_000)
    due_at: datetime | None = None


class AssignmentCreate(AssignmentBase):
    """
    Payload for creating a new assignment in a classroom.
    """

    classroom_id: UUID


class AssignmentRead(AssignmentBase):
    """
    Assignment representation returned to clients.
    """

    id: UUID
    classroom_id: UUID
    created_at: datetime
    updated_at: datetime

    class Config:
        """
        Enable construction from SQLAlchemy ORM instances.
        """

        from_attributes = True


class SubmissionBase(BaseModel):
    """
    Shared payload fields for code submissions.
    """

    code: str = Field(max_length=100_000)


class SubmissionCreate(SubmissionBase):
    """
    Payload for creating a submission for an assignment.

    The code runs in the student's browser (Pyodide); `status` and
    `result_json` carry that run's outcome. The server never executes
    submitted code, so both describe the client's run and are stored after
    sanitization.
    """

    assignment_id: UUID
    status: Literal["success", "error", "timeout"]
    result_json: dict | None = None


class SubmissionRead(SubmissionBase):
    """
    Submission representation returned to clients.

    Includes submitter info and human-readable status for the UI.
    """

    id: UUID
    assignment_id: UUID
    user_id: UUID
    status: str
    result_json: dict | None = None
    submitted_at: datetime
    # Populated by API for display; who submitted and short status/error text.
    submitter_name: str = ""
    submitter_email: str | None = None
    status_display: str = ""
    error_summary: str | None = None
    feedback: str | None = None
    test_passed: bool | None = None

    class Config:
        """
        Enable construction from SQLAlchemy ORM instances.
        """

        from_attributes = True

