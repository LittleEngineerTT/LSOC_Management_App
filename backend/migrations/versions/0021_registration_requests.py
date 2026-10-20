"""Inscriptions : demande à valider, avec poste et message."""

import sqlalchemy as sa
from alembic import op

revision = "0021_registration_requests"
down_revision = "0020_user_sex"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Les inscriptions existantes étaient immédiates : elles restent acceptées.
    op.add_column(
        "registrations",
        sa.Column("status", sa.String(10), nullable=False, server_default="accepted"),
    )
    op.alter_column("registrations", "status", server_default=None)
    op.create_check_constraint(
        "registrations_status_check", "registrations", "status IN ('pending','accepted','rejected')"
    )
    op.add_column(
        "registrations",
        sa.Column(
            "position_id",
            sa.String(36),
            sa.ForeignKey("positions.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.add_column(
        "registrations", sa.Column("message", sa.Text(), nullable=False, server_default="")
    )
    op.add_column(
        "registrations", sa.Column("decision", sa.Text(), nullable=False, server_default="")
    )
    op.add_column(
        "registrations", sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True)
    )


def downgrade() -> None:
    op.drop_column("registrations", "decided_at")
    op.drop_column("registrations", "decision")
    op.drop_column("registrations", "message")
    op.drop_column("registrations", "position_id")
    op.drop_constraint("registrations_status_check", "registrations", type_="check")
    op.drop_column("registrations", "status")
