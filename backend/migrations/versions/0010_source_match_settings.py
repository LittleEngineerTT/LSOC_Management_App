"""Marges et terrains des matchs propres à chaque source FFVB."""

import sqlalchemy as sa
from alembic import op

revision = "0010_source_match_settings"
down_revision = "0009_realign_team_referents"
branch_labels = None
depends_on = None


def upgrade() -> None:
    for name in ("before_minutes", "after_minutes", "courts"):
        op.add_column("ffvb_sources", sa.Column(name, sa.Integer(), nullable=True))
    op.create_check_constraint(
        "ffvb_sources_match_settings_check",
        "ffvb_sources",
        "(before_minutes IS NULL OR before_minutes >= 0)"
        " AND (after_minutes IS NULL OR after_minutes > 0)"
        " AND (courts IS NULL OR courts > 0)",
    )


def downgrade() -> None:
    op.drop_constraint("ffvb_sources_match_settings_check", "ffvb_sources", type_="check")
    for name in ("courts", "after_minutes", "before_minutes"):
        op.drop_column("ffvb_sources", name)
