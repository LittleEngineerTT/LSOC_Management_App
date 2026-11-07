"""Demandes de contact de l’application Contact."""

import sqlalchemy as sa
from alembic import op

revision = "0036_contact_requests"
down_revision = "0035_whole_gym_courts"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "contact_requests",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("email", sa.String(254), nullable=True),
        sa.Column("phone", sa.String(30), nullable=True),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("team_ids", sa.JSON(), nullable=False, server_default="[]"),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column(
            "handler_id",
            sa.String(36),
            sa.ForeignKey("users.id", ondelete="SET NULL", onupdate="CASCADE"),
            nullable=True,
        ),
        sa.Column("handler_name", sa.String(80), nullable=True),
        sa.Column("handled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("status IN ('open','resolved')", name="contact_requests_status_check"),
        sa.CheckConstraint(
            "email IS NOT NULL OR phone IS NOT NULL", name="contact_requests_reply_check"
        ),
    )
    op.create_index(op.f("ix_contact_requests_status"), "contact_requests", ["status"])


def downgrade() -> None:
    op.drop_index(op.f("ix_contact_requests_status"), table_name="contact_requests")
    op.drop_table("contact_requests")
