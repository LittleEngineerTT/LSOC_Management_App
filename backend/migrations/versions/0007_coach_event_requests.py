"""Demandes de création par les coachs et ouverture des inscriptions par équipe."""

import sqlalchemy as sa
from alembic import op

revision = "0007_coach_event_requests"
down_revision = "0006_event_registrations"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "events", sa.Column("registration_team_ids", sa.JSON(), nullable=False, server_default="[]")
    )
    op.create_table(
        "coach_event_requests",
        sa.Column("team_id", sa.String(36), nullable=True),
        sa.Column("actor_id", sa.String(36), nullable=True),
        sa.Column("actor_name", sa.String(80), nullable=False),
        sa.Column("proposal", sa.JSON(), nullable=False),
        sa.Column("note", sa.Text(), nullable=False),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("decision", sa.Text(), nullable=False),
        sa.Column("decided_by", sa.String(36), nullable=True),
        sa.Column("decider_name", sa.String(80), nullable=True),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("event_id", sa.String(36), nullable=True),
        sa.Column("id", sa.String(36), nullable=False),
        sa.CheckConstraint("status IN ('pending','accepted','rejected','withdrawn')"),
        sa.ForeignKeyConstraint(["team_id"], ["teams.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["actor_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["decided_by"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["event_id"], ["events.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("event_id"),
    )
    for field in ("team_id", "actor_id", "status"):
        op.create_index(op.f(f"ix_coach_event_requests_{field}"), "coach_event_requests", [field])


def downgrade() -> None:
    op.drop_table("coach_event_requests")
    op.drop_column("events", "registration_team_ids")
