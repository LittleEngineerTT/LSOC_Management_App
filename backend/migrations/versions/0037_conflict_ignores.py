"""Conflits d’événements ignorés par les administrateurs."""

import sqlalchemy as sa
from alembic import op

revision = "0037_conflict_ignores"
down_revision = "0036_contact_requests"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "conflict_ignores",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "event_id",
            sa.String(36),
            sa.ForeignKey("events.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("signature", sa.String(64), nullable=False),
        sa.Column(
            "ignored_by",
            sa.String(36),
            sa.ForeignKey("users.id", ondelete="SET NULL", onupdate="CASCADE"),
            nullable=True,
        ),
        sa.Column("ignorer_name", sa.String(80), nullable=False),
        sa.Column("ignored_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("event_id"),
    )


def downgrade() -> None:
    op.drop_table("conflict_ignores")
