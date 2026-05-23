"""
Submission routes: create, list, get result, add feedback.

Submissions store real sandbox outcome; list/get include submitter name
and human-readable status for the UI.
"""

from uuid import UUID

from fastapi import APIRouter, HTTPException, Query, Request, status
from pydantic import BaseModel, Field

from app.core.limiter import limiter
from app.dependencies import CurrentUser, DBSession
from app.models.submission import Submission
from app.models.user import User
from app.schemas.assignment import SubmissionCreate, SubmissionRead
from app.services.assignment_service import get_assignment_or_404
from app.services.submission_service import (
    _get_classroom_from_assignment,
    create_submission,
    get_submission_or_404,
    get_submission_status_display,
    list_submissions_for_assignment,
)

router = APIRouter()


class FeedbackPayload(BaseModel):
    feedback: str = Field(max_length=5000)


def _submission_to_read(submission: Submission, submitter_name: str = "", submitter_email: str | None = None) -> SubmissionRead:
    """Build SubmissionRead with display fields."""
    status_display, error_summary = get_submission_status_display(submission)
    result = submission.result_json or {}
    test_passed = result.get("test_passed") if isinstance(result, dict) else None
    return SubmissionRead.model_validate(submission).model_copy(
        update={
            "submitter_name": submitter_name,
            "submitter_email": submitter_email,
            "status_display": status_display,
            "error_summary": error_summary,
            "test_passed": test_passed,
            "feedback": submission.feedback,
        }
    )


@router.post("/", response_model=SubmissionRead, status_code=status.HTTP_201_CREATED)
@limiter.limit("10/minute")
def create_submission_endpoint(
    request: Request,
    payload: SubmissionCreate,
    current_user: CurrentUser,
    db: DBSession,
) -> SubmissionRead:
    """Create a new submission: run code in sandbox and save result."""
    try:
        submission = create_submission(
            db,
            assignment_id=payload.assignment_id,
            user=current_user,
            code=payload.code,
            client_status=payload.status,
            client_result=payload.result_json,
        )
    except PermissionError:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")
    except ValueError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Assignment not found")
    return _submission_to_read(submission, submitter_name=current_user.name or "", submitter_email=current_user.email)


@router.get("/", response_model=list[SubmissionRead])
def list_submissions_endpoint(
    current_user: CurrentUser,
    db: DBSession,
    assignment_id: UUID = Query(..., description="Assignment to list submissions for."),
) -> list[SubmissionRead]:
    """List submissions for an assignment with submitter and status display."""
    try:
        submissions = list_submissions_for_assignment(db, assignment_id=assignment_id, user=current_user)
    except PermissionError:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")
    except ValueError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Assignment not found")

    return [
        _submission_to_read(
            s,
            submitter_name=s.user.name if s.user else "Unknown",
            submitter_email=s.user.email if s.user else None,
        )
        for s in submissions
    ]


@router.get("/{submission_id}", response_model=SubmissionRead)
def get_submission_endpoint(
    submission_id: UUID,
    current_user: CurrentUser,
    db: DBSession,
) -> SubmissionRead:
    """Get a single submission with submitter and status display."""
    try:
        submission = get_submission_or_404(db, submission_id=submission_id, user=current_user)
    except PermissionError:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")
    except ValueError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Submission not found")

    submitter = db.get(User, submission.user_id)
    return _submission_to_read(
        submission,
        submitter_name=submitter.name if submitter else "Unknown",
        submitter_email=submitter.email if submitter else None,
    )


@router.patch("/{submission_id}/feedback", response_model=SubmissionRead)
def add_feedback_endpoint(
    submission_id: UUID,
    payload: FeedbackPayload,
    current_user: CurrentUser,
    db: DBSession,
) -> SubmissionRead:
    """Add or update mentor feedback on a submission. Teacher-only."""
    try:
        submission = get_submission_or_404(db, submission_id=submission_id, user=current_user)
    except PermissionError:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")
    except ValueError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Submission not found")

    assignment = get_assignment_or_404(db, assignment_id=submission.assignment_id)
    classroom = _get_classroom_from_assignment(db, assignment)

    if current_user.id != classroom.teacher_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only the teacher can add feedback.")

    submission.feedback = payload.feedback
    db.commit()
    db.refresh(submission)

    submitter = db.get(User, submission.user_id)
    return _submission_to_read(
        submission,
        submitter_name=submitter.name if submitter else "Unknown",
        submitter_email=submitter.email if submitter else None,
    )
