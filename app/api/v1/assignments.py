"""
Assignment routes: creation and listing within classrooms.

All endpoints are protected and use the current authenticated user.
"""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, Field

from app.core.limiter import limiter, user_or_ip
from app.dependencies import CurrentUser, DBSession
from app.schemas.assignment import AssignmentCreate, AssignmentRead
from app.services.assignment_service import create_assignment, get_assignment_or_404, list_assignments_for_classroom
from app.services.hint_service import get_hint

router = APIRouter()


class HintRequest(BaseModel):
    code: str = Field(max_length=100_000)
    attempt_number: int = Field(default=1, ge=1, le=1000)


@router.get("/", response_model=list[AssignmentRead])
def list_assignments(
    current_user: CurrentUser,
    db: DBSession,
    classroom_id: UUID = Query(..., description="Classroom to list assignments for."),
) -> list[AssignmentRead]:
    """
    List assignments for a classroom that the current user can access.
    """

    try:
        assignments = list_assignments_for_classroom(db, classroom_id=classroom_id, user=current_user)
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    return [AssignmentRead.model_validate(a) for a in assignments]


@router.post("/", response_model=AssignmentRead, status_code=status.HTTP_201_CREATED)
@limiter.limit("50/hour", key_func=user_or_ip)
def create_assignment_endpoint(
    request: Request,
    payload: AssignmentCreate,
    current_user: CurrentUser,
    db: DBSession,
) -> AssignmentRead:
    """
    Create a new assignment in a classroom owned by the current user.
    """

    try:
        assignment = create_assignment(
            db,
            classroom_id=payload.classroom_id,
            teacher=current_user,
            title=payload.title,
            description=payload.description,
            template_code=payload.template_code,
            test_code=payload.test_code,
            due_at=payload.due_at,
        )
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))

    return AssignmentRead.model_validate(assignment)


@router.post("/{assignment_id}/hint")
@limiter.limit("20/minute", key_func=user_or_ip)
def get_hint_endpoint(
    request: Request,
    assignment_id: UUID,
    payload: HintRequest,
    current_user: CurrentUser,
    db: DBSession,
) -> dict:
    """
    Return a hint for a stuck student. Uses Claude if ANTHROPIC_API_KEY is set,
    otherwise returns a generic placeholder hint.
    """
    try:
        assignment = get_assignment_or_404(db, assignment_id=assignment_id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))

    hint = get_hint(
        code=payload.code,
        description=assignment.description or assignment.title,
        attempt_number=payload.attempt_number,
    )
    return {"hint": hint}

