"""Add collab_documents: saved state of live-editing rooms.

Revision ID: 008
Revises: 007
Create Date: 2026-11-16
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "008"
down_revision = "007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "collab_documents",
        sa.Column("room_id", sa.String(200), primary_key=True, nullable=False),
        sa.Column(
            "classroom_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("classrooms.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "assignment_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("assignments.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("state", sa.LargeBinary(), nullable=False),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_index("ix_collab_documents_classroom_id", "collab_documents", ["classroom_id"])
    op.create_index("ix_collab_documents_assignment_id", "collab_documents", ["assignment_id"])


def downgrade() -> None:
    op.drop_index("ix_collab_documents_assignment_id", table_name="collab_documents")
    op.drop_index("ix_collab_documents_classroom_id", table_name="collab_documents")
    op.drop_table("collab_documents")
