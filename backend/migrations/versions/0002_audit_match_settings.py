"""Décisions historisées et réglages de terrains indépendants de l’occupation."""

import sqlalchemy as sa
from alembic import op

revision = "0002_audit_match_settings"
down_revision = "0001_backend_v1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "events", sa.Column("match_courts", sa.Integer(), nullable=False, server_default="3")
    )
    op.execute("UPDATE events SET match_courts = courts WHERE courts > 0")
    op.alter_column("events", "match_courts", server_default=None)
    op.add_column(
        "event_revisions",
        sa.Column("decision_reason", sa.Text(), nullable=False, server_default=""),
    )
    op.alter_column("event_revisions", "decision_reason", server_default=None)
    op.add_column(
        "change_requests",
        sa.Column(
            "decided_by",
            sa.String(36),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.add_column("change_requests", sa.Column("decider_name", sa.String(80), nullable=True))
    op.add_column(
        "change_requests", sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True)
    )
    op.add_column(
        "ffvb_conflicts",
        sa.Column(
            "resolved_by",
            sa.String(36),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.add_column("ffvb_conflicts", sa.Column("resolver_name", sa.String(80), nullable=True))
    op.add_column(
        "ffvb_conflicts", sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True)
    )


def downgrade() -> None:
    for column in ("resolved_at", "resolver_name", "resolved_by"):
        op.drop_column("ffvb_conflicts", column)
    for column in ("decided_at", "decider_name", "decided_by"):
        op.drop_column("change_requests", column)
    op.drop_column("event_revisions", "decision_reason")
    op.drop_column("events", "match_courts")
