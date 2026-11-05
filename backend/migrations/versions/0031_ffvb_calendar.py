"""Calendrier de l’équipe de chaque source FFVB, relevé à chaque synchronisation."""

import sqlalchemy as sa
from alembic import op

revision = "0031_ffvb_calendar"
down_revision = "0030_ffvb_standings"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("ffvb_sources", sa.Column("calendar", sa.JSON(), nullable=True))
    # Relevé sans attendre l’échéance quotidienne de chaque source.
    op.execute("UPDATE ffvb_sources SET next_check_at = now() WHERE enabled")


def downgrade() -> None:
    op.drop_column("ffvb_sources", "calendar")
