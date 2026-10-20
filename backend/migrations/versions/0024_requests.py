"""Demandes : description des modifications, demandes de pièces et demandes libres."""

import sqlalchemy as sa
from alembic import op

revision = "0024_requests"
down_revision = "0023_referents"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "change_requests",
        sa.Column("description", sa.Text(), nullable=False, server_default=""),
    )
    op.create_table(
        "staff_requests",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("kind", sa.String(20), nullable=False),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("description", sa.Text(), nullable=False, server_default=""),
        sa.Column(
            "event_id",
            sa.String(36),
            sa.ForeignKey("events.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "actor_id",
            sa.String(36),
            sa.ForeignKey("users.id", ondelete="SET NULL", onupdate="CASCADE"),
            nullable=True,
        ),
        sa.Column("actor_name", sa.String(80), nullable=False),
        sa.Column(
            "player_id",
            sa.String(36),
            sa.ForeignKey("users.id", ondelete="SET NULL", onupdate="CASCADE"),
            nullable=True,
        ),
        sa.Column("documents", sa.JSON(), nullable=False, server_default="[]"),
        sa.Column(
            "thread_id",
            sa.String(36),
            sa.ForeignKey("question_threads.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("decision", sa.Text(), nullable=False, server_default=""),
        sa.Column(
            "decided_by",
            sa.String(36),
            sa.ForeignKey("users.id", ondelete="SET NULL", onupdate="CASCADE"),
            nullable=True,
        ),
        sa.Column("decider_name", sa.String(80), nullable=True),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("kind IN ('document','other')", name="staff_requests_kind_check"),
        sa.CheckConstraint(
            "status IN ('pending','accepted','rejected','withdrawn')",
            name="staff_requests_status_check",
        ),
    )
    for column in ("event_id", "actor_id", "status"):
        op.create_index(op.f(f"ix_staff_requests_{column}"), "staff_requests", [column])


def downgrade() -> None:
    op.drop_table("staff_requests")
    op.drop_column("change_requests", "description")
