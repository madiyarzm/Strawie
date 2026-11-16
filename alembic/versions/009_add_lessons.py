"""Add group schedules, lessons and homework submissions.

Also relaxes collab_documents so lesson rooms (which have no classroom or
assignment) can be saved: classroom_id/assignment_id become nullable and a
lesson_id column is added.

Revision ID: 009
Revises: 008
Create Date: 2026-11-16
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "009"
down_revision = "008"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("groups", sa.Column("schedule", sa.JSON(), nullable=True))

    op.create_table(
        "lessons",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "group_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("groups.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("title", sa.String(200), nullable=True),
        sa.Column("topic", sa.String(60), nullable=True),
        sa.Column("starts_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("room_mode", sa.String(10), nullable=False, server_default="together"),
        sa.Column("live_since", sa.DateTime(timezone=True), nullable=True),
        sa.Column("homework_enabled", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("homework_due_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_lessons_group_starts", "lessons", ["group_id", "starts_at"])

    op.create_table(
        "homework_submissions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "lesson_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("lessons.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("blocks", sa.JSON(), nullable=False),
        sa.Column("results", sa.JSON(), nullable=False),
        sa.Column("score", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("max_score", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("feedback", sa.Text(), nullable=True),
        sa.Column("submitted_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_homework_submissions_lesson_user", "homework_submissions", ["lesson_id", "user_id"])

    op.alter_column("collab_documents", "classroom_id", nullable=True)
    op.alter_column("collab_documents", "assignment_id", nullable=True)
    op.add_column(
        "collab_documents",
        sa.Column(
            "lesson_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("lessons.id", ondelete="CASCADE"),
            nullable=True,
        ),
    )
    op.create_index("ix_collab_documents_lesson_id", "collab_documents", ["lesson_id"])


def downgrade() -> None:
    op.drop_index("ix_collab_documents_lesson_id", table_name="collab_documents")
    op.drop_column("collab_documents", "lesson_id")
    op.execute("DELETE FROM collab_documents WHERE classroom_id IS NULL OR assignment_id IS NULL")
    op.alter_column("collab_documents", "assignment_id", nullable=False)
    op.alter_column("collab_documents", "classroom_id", nullable=False)
    op.drop_index("ix_homework_submissions_lesson_user", table_name="homework_submissions")
    op.drop_table("homework_submissions")
    op.drop_index("ix_lessons_group_starts", table_name="lessons")
    op.drop_table("lessons")
    op.drop_column("groups", "schedule")
