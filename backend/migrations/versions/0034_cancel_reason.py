"""Motif d’annulation d’un événement."""

import sqlalchemy as sa
from alembic import op

revision = "0034_cancel_reason"
down_revision = "0033_registration_quotas"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "events", sa.Column("cancel_reason", sa.String(20), nullable=False, server_default="")
    )
    op.add_column(
        "events", sa.Column("cancel_note", sa.String(200), nullable=False, server_default="")
    )
    # Les annulations existantes sont celles des indisponibilités ou des administrateurs.
    op.execute("UPDATE events SET cancel_reason = 'admin' WHERE cancelled")


def downgrade() -> None:
    op.drop_column("events", "cancel_note")
    op.drop_column("events", "cancel_reason")
