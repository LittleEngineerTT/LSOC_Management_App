"""Plateaux FFVB : les matchs d’un même jour au même lieu partagent un événement."""

import sqlalchemy as sa
from alembic import op

revision = "0040_ffvb_plateaux"
down_revision = "0039_match_time_unknown"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "ffvb_matches",
        sa.Column(
            "plateau_id",
            sa.String(36),
            sa.ForeignKey("ffvb_matches.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )


def downgrade() -> None:
    op.drop_column("ffvb_matches", "plateau_id")
