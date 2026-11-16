"""Personal workspaces: collab_documents.user_id.

Revision ID: 010
Revises: 009
Create Date: 2026-11-16
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "010"
down_revision = "009"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "collab_documents",
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=True,
        ),
    )
    op.create_index("ix_collab_documents_user_id", "collab_documents", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_collab_documents_user_id", table_name="collab_documents")
    op.execute("DELETE FROM collab_documents WHERE user_id IS NOT NULL")
    op.drop_column("collab_documents", "user_id")
