"""Équipes organisatrices d’un événement, reprises des sources FFVB et des demandes de coach."""

import sqlalchemy as sa
from alembic import op

revision = "0016_event_teams"
down_revision = "0015_user_identity"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("events", sa.Column("team_ids", sa.JSON(), nullable=False, server_default="[]"))
    # Un match FFVB appartient à l’équipe de sa source.
    op.execute(
        """
        UPDATE events SET team_ids = json_build_array(s.team_id)
        FROM ffvb_matches m JOIN ffvb_sources s ON s.id = m.source_id
        WHERE m.id = events.ffvb_match_id
        """
    )
    # Une demande acceptée renvoie à son événement, ou à la première occurrence de sa série.
    op.execute(
        """
        UPDATE events SET team_ids = json_build_array(r.team_id)
        FROM coach_event_requests r JOIN events origin ON origin.id = r.event_id
        WHERE r.status = 'accepted' AND r.team_id IS NOT NULL
          AND (events.id = origin.id
               OR (origin.series_id IS NOT NULL AND events.series_id = origin.series_id))
        """
    )


def downgrade() -> None:
    op.drop_column("events", "team_ids")
