"""Lessons remember when they ended (lessons.ended_at).

An ended lesson stays open for everyone to look back at; the app lists it
under recent lessons instead of "coming up".

Revision ID: 011
Revises: 010
Create Date: 2026-11-21
"""

from alembic import op
import sqlalchemy as sa


revision = "011"
down_revision = "010"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("lessons", sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("lessons", "ended_at")
