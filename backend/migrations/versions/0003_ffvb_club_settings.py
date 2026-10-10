"""Configuration unique du club et fréquence des sources en jours."""

import sqlalchemy as sa
from alembic import op

revision = "0003_ffvb_club_settings"
down_revision = "0002_audit_match_settings"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("club_settings", sa.Column("club_code", sa.String(30), nullable=True))
    # Reuse the sole club already configured; do not guess when legacy sources differ.
    op.execute("""
        INSERT INTO club_settings (id, before_minutes, after_minutes, courts)
        SELECT 1, 75, 150, 3 WHERE EXISTS (SELECT 1 FROM ffvb_sources)
        ON CONFLICT (id) DO NOTHING
    """)
    op.execute("""
        UPDATE club_settings SET club_code = (
            SELECT MIN(club_code) FROM ffvb_sources
            HAVING COUNT(DISTINCT club_code) = 1
        ) WHERE id = 1
    """)
    op.execute("""
        UPDATE ffvb_sources
        SET interval_minutes = GREATEST(1, CEIL(interval_minutes / 1440.0))::integer * 1440
    """)


def downgrade() -> None:
    op.drop_column("club_settings", "club_code")
