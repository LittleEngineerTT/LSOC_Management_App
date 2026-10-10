"""Préférence d’avertissement des équipes sans source FFVB."""

import sqlalchemy as sa
from alembic import op

revision = "0004_team_source_warning"
down_revision = "0003_ffvb_club_settings"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "teams",
        sa.Column(
            "ffvb_source_warning_ignored", sa.Boolean(), nullable=False, server_default=sa.false()
        ),
    )


def downgrade() -> None:
    op.drop_column("teams", "ffvb_source_warning_ignored")
