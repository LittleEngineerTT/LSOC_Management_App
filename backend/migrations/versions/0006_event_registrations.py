"""Séances ouvertes : sections autorisées, limite et inscriptions."""

import sqlalchemy as sa
from alembic import op

revision = "0006_event_registrations"
down_revision = "0005_username_auth"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "events",
        sa.Column("registration_section_ids", sa.JSON(), nullable=False, server_default="[]"),
    )
    op.add_column("events", sa.Column("registration_limit", sa.Integer(), nullable=True))
    op.create_check_constraint(
        "events_registration_limit_check",
        "events",
        "registration_limit IS NULL OR registration_limit > 0",
    )
    op.create_table(
        "registrations",
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("event_id", sa.String(length=36), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.ForeignKeyConstraint(["event_id"], ["events.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "event_id"),
    )
    op.create_index(op.f("ix_registrations_event_id"), "registrations", ["event_id"], unique=False)
    op.create_index(op.f("ix_registrations_user_id"), "registrations", ["user_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_registrations_user_id"), table_name="registrations")
    op.drop_index(op.f("ix_registrations_event_id"), table_name="registrations")
    op.drop_table("registrations")
    op.drop_constraint("events_registration_limit_check", "events", type_="check")
    op.drop_column("events", "registration_limit")
    op.drop_column("events", "registration_section_ids")
