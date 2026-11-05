"""Classement de la poule de chaque source FFVB, relevé à chaque synchronisation."""

import sqlalchemy as sa
from alembic import op

revision = "0030_ffvb_standings"
down_revision = "0029_hidden_threads"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("ffvb_sources", sa.Column("standings", sa.JSON(), nullable=True))
    op.add_column("ffvb_sources", sa.Column("standings_title", sa.String(200), nullable=True))
    op.add_column(
        "ffvb_sources", sa.Column("standings_at", sa.DateTime(timezone=True), nullable=True)
    )


def downgrade() -> None:
    op.drop_column("ffvb_sources", "standings_at")
    op.drop_column("ffvb_sources", "standings_title")
    op.drop_column("ffvb_sources", "standings")
