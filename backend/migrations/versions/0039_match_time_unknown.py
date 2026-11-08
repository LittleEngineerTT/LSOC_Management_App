"""Matchs FFVB sans heure : placés sur leur journée, heure à compléter."""

import sqlalchemy as sa
from alembic import op

revision = "0039_match_time_unknown"
down_revision = "0038_coach_license_number"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "events",
        sa.Column("time_unknown", sa.Boolean(), nullable=False, server_default=sa.false()),
    )


def downgrade() -> None:
    op.drop_column("events", "time_unknown")
