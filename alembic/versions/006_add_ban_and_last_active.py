"""Add is_banned, ban_reason, and last_active_at to users.

Revision ID: 006
Revises: 005
Create Date: 2026-05-22
"""

from alembic import op
import sqlalchemy as sa


revision = "006"
down_revision = "005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("is_banned", sa.Boolean, nullable=False, server_default=sa.false()),
    )
    op.add_column(
        "users",
        sa.Column("ban_reason", sa.Text, nullable=True),
    )
    op.add_column(
        "users",
        sa.Column("last_active_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("users", "last_active_at")
    op.drop_column("users", "ban_reason")
    op.drop_column("users", "is_banned")
