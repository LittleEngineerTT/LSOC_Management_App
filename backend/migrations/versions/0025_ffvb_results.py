"""Résultats des matchs FFVB joués, pour l’accueil."""

import sqlalchemy as sa
from alembic import op

revision = "0025_ffvb_results"
down_revision = "0024_requests"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "ffvb_results",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "source_id",
            sa.String(36),
            sa.ForeignKey("ffvb_sources.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("match_code", sa.String(30), nullable=False),
        sa.Column("kickoff_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("home_team", sa.String(200), nullable=False),
        sa.Column("away_team", sa.String(200), nullable=False),
        sa.Column("home_sets", sa.Integer(), nullable=False),
        sa.Column("away_sets", sa.Integer(), nullable=False),
        sa.Column("set_scores", sa.JSON(), nullable=False, server_default="[]"),
        sa.Column("points", sa.String(20), nullable=False, server_default=""),
        sa.Column("recorded_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("source_id", "match_code"),
    )
    op.create_index(op.f("ix_ffvb_results_source_id"), "ffvb_results", ["source_id"])
    op.create_index(op.f("ix_ffvb_results_kickoff_at"), "ffvb_results", ["kickoff_at"])


def downgrade() -> None:
    op.drop_table("ffvb_results")
