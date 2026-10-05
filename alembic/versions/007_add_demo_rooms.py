"""Add demo_rooms table for the public, account-free demo.

No foreign keys: a demo visitor is never a User row.

Revision ID: 007
Revises: 006
Create Date: 2026-10-04
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "007"
down_revision = "006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "demo_rooms",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            nullable=False,
        ),
        sa.Column("created_ip", sa.String(45), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
    )
    # Expiry sweep deletes by expires_at; keep it indexed.
    op.create_index("ix_demo_rooms_expires_at", "demo_rooms", ["expires_at"])
    # Per-IP creation-rate check filters on both columns together.
    op.create_index("ix_demo_rooms_ip_created", "demo_rooms", ["created_ip", "created_at"])


def downgrade() -> None:
    op.drop_index("ix_demo_rooms_ip_created", table_name="demo_rooms")
    op.drop_index("ix_demo_rooms_expires_at", table_name="demo_rooms")
    op.drop_table("demo_rooms")
