"""
Business logic for submissions. Code is never executed on the server.

Creates Submission records, enforces retention (submissions older than
submission_retention_days are hidden and removed by startup cleanup).
"""

from datetime import datetime, timedelta, timezone
from typing import List
from uuid import UUID

from sqlalchemy import delete
from sqlalchemy.orm import Session, joinedload

from app.config import get_settings
from app.models.assignment import Assignment
from app.models.classroom import Classroom
from app.models.submission import Submission
from app.models.user import User
from app.services.assignment_service import get_assignment_or_404
from app.services.classroom_service import ensure_user_can_access_classroom


def get_submission_status_display(submission: Submission) -> tuple[str, str | None]:
    """
    Human-readable status and optional error summary for UI.

    Returns:
        (status_display, error_summary). status_display is short label;
        error_summary is None for success, otherwise a brief error message.
    """
    status = (submission.status or "").lower()
    result = submission.result_json or {}
    stderr = (result.get("stderr") or "").strip() if isinstance(result, dict) else ""
    stdout = (result.get("stdout") or "").strip() if isinstance(result, dict) else ""

    # Infrastructure errors (e.g., Docker daemon not reachable) should not leak low-level details.
    err_lower_full = stderr.lower()
    if "docker" in err_lower_full and "sock" in err_lower_full:
        return (
            "Error",
            "Execution environment is temporarily unavailable. Please try again later or contact your mentor.",
        )

    if status == "success":
        return ("Accepted, no errors", None)
    if status == "timeout":
        return ("Timeout", "Execution exceeded time limit.")
    if status == "error":
        # Try to classify: syntax, runtime, or other from stderr
        err_lower = stderr.lower()
        if "syntaxerror" in err_lower or "syntax error" in err_lower:
            first_line = stderr.split("\n")[0].strip() if stderr else "Syntax error."
            return ("Syntax error", first_line[:200])
        if any(x in err_lower for x in ("nameerror", "typeerror", "valueerror", "indexerror", "keyerror", "runtimeerror", "zerodivisionerror")):
            first_line = stderr.split("\n")[0].strip() if stderr else "Runtime error."
            return ("Runtime error", first_line[:200])
        if stderr:
            return ("Error", stderr[:200])
        return ("Error", "Execution failed.")
    return (status or "Unknown", None)


def _retention_cutoff() -> datetime:
    """Return the cutoff datetime: submissions before this are considered expired."""
    days = get_settings().submission_retention_days
    return (datetime.now(timezone.utc) - timedelta(days=days))


def delete_expired_submissions(db: Session, retention_days: int | None = None) -> int:
    """
    Remove submissions older than the retention period.

    Called on app startup so old data does not accumulate. Safe to run
    periodically; returns the number of rows deleted.

    Args:
        db: Database session.
        retention_days: Override config (uses settings if None).

    Returns:
        Number of submissions deleted.
    """
    days = retention_days if retention_days is not None else get_settings().submission_retention_days
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    result = db.execute(delete(Submission).where(Submission.submitted_at < cutoff))
    db.commit()
    return result.rowcount or 0


def _get_classroom_from_assignment(db: Session, assignment: Assignment) -> Classroom:
    """
    Resolve the classroom for the given assignment.

    Args:
        db: Database session.
        assignment: Assignment instance with a classroom_id.

    Returns:
        Classroom instance associated with the assignment.
    """

    classroom = db.get(Classroom, assignment.classroom_id)
    if classroom is None:
        raise ValueError("Classroom not found for assignment")
    return classroom


_ALLOWED_STATUSES = {"success", "error", "timeout"}


def xp_for_submission(submission: Submission) -> int:
    """How many XP a single submission is worth, by Chalk's scoring rules.

    Kept in one place so the create-submission write path and any future
    recomputation use the same numbers.
    """
    if submission.status != "success":
        return 0
    result = submission.result_json if isinstance(submission.result_json, dict) else {}
    passed = result.get("passed")
    if isinstance(passed, int) and passed > 0:
        return passed * 40
    if result.get("test_passed") is True:
        return 40
    return 5


def _sanitize_client_result(raw: dict | None) -> dict:
    """Keep only the keys we render. Truncate large strings so a malicious
    client cannot bloat the DB row."""
    out: dict = {}
    if not isinstance(raw, dict):
        return out
    max_len = 64 * 1024
    for key in ("stdout", "stderr", "test_output"):
        val = raw.get(key)
        if isinstance(val, str):
            out[key] = val[:max_len]
    if "test_passed" in raw and isinstance(raw["test_passed"], (bool, type(None))):
        out["test_passed"] = raw["test_passed"]
    if "passed" in raw and isinstance(raw["passed"], int):
        out["passed"] = max(0, min(raw["passed"], 1000))
    if "exit_code" in raw and isinstance(raw["exit_code"], int):
        out["exit_code"] = raw["exit_code"]
    return out


def create_submission(
    db: Session,
    *,
    assignment_id: UUID,
    user: User,
    code: str,
    client_status: str,
    client_result: dict | None = None,
) -> Submission:
    """
    Create a new submission for an assignment.

    The code was already run in the student's browser (Pyodide); the server
    only stores the sanitized result. It never executes user code: this is an
    open-source app without a hardened sandbox, so running untrusted Python
    server-side would be an unacceptable risk. The trade-off is that a
    determined student could fake their own result, which is fine for
    classroom practice.
    """

    assignment = get_assignment_or_404(db, assignment_id=assignment_id)
    classroom = _get_classroom_from_assignment(db, assignment)
    ensure_user_can_access_classroom(classroom, user, db)

    if client_status not in _ALLOWED_STATUSES:
        raise ValueError("invalid_status")
    status = client_status
    result_json = _sanitize_client_result(client_result)
    result_json.setdefault("test_passed", None)

    submission = Submission(
        assignment_id=assignment.id,
        user_id=user.id,
        code=code,
        status=status,
        result_json=result_json,
    )
    db.add(submission)
    db.commit()
    db.refresh(submission)

    # Increment XP at write time. The atomic SQL update avoids the
    # read-modify-write race that an in-process `user.xp += delta` would
    # introduce if two submissions land at the same moment.
    delta = xp_for_submission(submission)
    if delta:
        db.query(User).filter(User.id == user.id).update(
            {User.xp: User.xp + delta}, synchronize_session=False
        )
        db.commit()
        db.refresh(user)

    return submission


def list_submissions_for_assignment(
    db: Session, *, assignment_id: UUID, user: User
) -> List[Submission]:
    """
    List submissions for an assignment visible to the user.

    Students see only their own submissions; teachers see all submissions
    for assignments in their classrooms.
    """

    assignment = get_assignment_or_404(db, assignment_id=assignment_id)
    classroom = _get_classroom_from_assignment(db, assignment)

    # Check that user can access the classroom at all.
    ensure_user_can_access_classroom(classroom, user, db)

    cutoff = _retention_cutoff()
    query = (
        db.query(Submission)
        .options(joinedload(Submission.user))
        .filter(Submission.assignment_id == assignment.id)
        .filter(Submission.submitted_at >= cutoff)
    )
    if user.id != classroom.teacher_id:
        query = query.filter(Submission.user_id == user.id)

    return query.order_by(Submission.submitted_at.desc()).all()


def get_submission_or_404(db: Session, submission_id: UUID, user: User) -> Submission:
    """
    Retrieve a submission that the user is allowed to see.

    Students can see only their submissions; teachers can see submissions
    for classrooms they teach.
    """

    submission = db.get(Submission, submission_id)
    if submission is None:
        raise ValueError("Submission not found")
    if submission.submitted_at < _retention_cutoff():
        raise ValueError("Submission not found")

    assignment = get_assignment_or_404(db, assignment_id=submission.assignment_id)
    classroom = _get_classroom_from_assignment(db, assignment)

    if user.id != classroom.teacher_id and user.id != submission.user_id:
        raise PermissionError("You do not have access to this submission")

    return submission

