"""Relevé des résultats FFVB à 23 h 59 les jours de match, hors intervalle de la source."""

import sqlalchemy as sa
from alembic import op

revision = "0027_ffvb_results_schedule"
down_revision = "0026_ffvb_results_backfill"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "ffvb_sources",
        sa.Column("results_checked_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("ffvb_sources", "results_checked_at")
