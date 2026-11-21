"""Schemas for group schedules, lessons and homework. Every field is bounded."""

from __future__ import annotations

import re
from datetime import datetime
from typing import Literal
from uuid import UUID
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import BaseModel, Field, field_validator, model_validator

_TIME = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")
_BLOCK_ID = re.compile(r"^[A-Za-z0-9_-]{1,32}$")


class GroupSchedule(BaseModel):
    """Weekly class times. days: 0 = Monday ... 6 = Sunday.

    `time` is the usual start time; `times` overrides it for particular days
    ({2: "18:30"} = Wednesdays at 18:30).
    """

    days: list[int] = Field(min_length=1, max_length=7)
    time: str
    times: dict[int, str] = Field(default_factory=dict, max_length=7)
    tz: str = Field(default="UTC", max_length=64)

    @field_validator("days")
    @classmethod
    def _days(cls, v: list[int]) -> list[int]:
        if any(d < 0 or d > 6 for d in v):
            raise ValueError("days must be 0-6")
        return sorted(set(v))

    @field_validator("time")
    @classmethod
    def _time(cls, v: str) -> str:
        if not _TIME.match(v):
            raise ValueError("time must be HH:MM")
        return v

    @model_validator(mode="after")
    def _times(self) -> "GroupSchedule":
        for day, value in self.times.items():
            if not _TIME.match(value):
                raise ValueError("times must be HH:MM")
        # Keep only real overrides for days that are in the schedule.
        self.times = {d: v for d, v in sorted(self.times.items()) if d in self.days and v != self.time}
        return self

    @field_validator("tz")
    @classmethod
    def _tz(cls, v: str) -> str:
        try:
            ZoneInfo(v)
        except (ZoneInfoNotFoundError, ValueError):
            raise ValueError("unknown time zone")
        return v


class LessonCreate(BaseModel):
    group_id: UUID
    starts_at: datetime
    title: str | None = Field(default=None, max_length=200)
    topic: str | None = Field(default=None, max_length=60)


class LessonUpdate(BaseModel):
    title: str | None = Field(default=None, max_length=200)
    topic: str | None = Field(default=None, max_length=60)
    starts_at: datetime | None = None
    room_mode: Literal["together", "solo"] | None = None
    live: bool | None = None
    homework_enabled: bool | None = None
    homework_due_at: datetime | None = None


class MyHomework(BaseModel):
    submitted_at: datetime
    score: int
    max_score: int
    has_feedback: bool


class LessonRead(BaseModel):
    id: UUID
    group_id: UUID
    group_name: str
    title: str | None
    topic: str | None
    starts_at: datetime
    room_mode: str
    live: bool
    # The teacher ended the class; it stays open to look back at.
    ended: bool = False
    homework_enabled: bool
    homework_due_at: datetime | None
    is_teacher: bool
    # Students: their latest homework submission. Teachers: how many students submitted.
    my_homework: MyHomework | None = None
    submitted_count: int | None = None
    student_count: int | None = None


class ScheduleSlot(BaseModel):
    """A scheduled class time with no lesson row yet ("Untitled lesson")."""

    group_id: UUID
    group_name: str
    starts_at: datetime
    is_teacher: bool


class Agenda(BaseModel):
    lessons: list[LessonRead]
    open_slots: list[ScheduleSlot]


class HomeworkTest(BaseModel):
    id: str
    kind: Literal["call", "io"]
    call: str
    expected: str
    stdin: str
    hidden: bool


class HomeworkProblemTests(BaseModel):
    block_id: str
    tests: list[HomeworkTest]


class SubmittedBlock(BaseModel):
    id: str = Field(max_length=32)
    type: Literal["text", "code"]
    text: str = Field(max_length=20_000)

    @field_validator("id")
    @classmethod
    def _id(cls, v: str) -> str:
        if not _BLOCK_ID.match(v):
            raise ValueError("bad block id")
        return v


class ProblemFailure(BaseModel):
    test_id: str = Field(max_length=32)
    label: str = Field(default="", max_length=300)
    expected: str = Field(default="", max_length=500)
    got: str = Field(default="", max_length=500)


class ProblemResult(BaseModel):
    passed: int = Field(ge=0, le=100)
    total: int = Field(ge=0, le=100)
    failures: list[ProblemFailure] = Field(default_factory=list, max_length=20)


class HomeworkSubmit(BaseModel):
    blocks: list[SubmittedBlock] = Field(max_length=60)
    results: dict[str, ProblemResult] = Field(max_length=60)


class HomeworkSubmissionRead(BaseModel):
    id: UUID
    lesson_id: UUID
    user_id: UUID
    user_name: str
    blocks: list[dict]
    results: dict
    score: int
    max_score: int
    feedback: str | None
    submitted_at: datetime


class HomeworkRosterRow(BaseModel):
    user_id: UUID
    name: str
    submission: HomeworkSubmissionRead | None


class FeedbackUpdate(BaseModel):
    feedback: str = Field(max_length=5000)
