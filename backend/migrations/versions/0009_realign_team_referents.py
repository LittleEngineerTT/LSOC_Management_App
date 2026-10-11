"""Rattrapage : référent des matchs FFVB aligné sur le référent actuel de leur équipe.

Avant ce correctif, changer le référent d’une équipe ne touchait pas ses événements. Les
matchs dont le référent a été choisi explicitement (révision humaine le modifiant) sont
laissés tels quels.
"""

import json

import sqlalchemy as sa
from alembic import op

revision = "0009_realign_team_referents"
down_revision = "0008_event_description"
branch_labels = None
depends_on = None


def upgrade() -> None:
    connection = op.get_bind()
    rows = connection.execute(
        sa.text(
            "SELECT e.id, t.referent_id FROM events e "
            "JOIN ffvb_matches m ON m.id = e.ffvb_match_id "
            "JOIN ffvb_sources s ON s.id = m.source_id "
            "JOIN teams t ON t.id = s.team_id "
            "JOIN users u ON u.id = t.referent_id AND u.active "
            "WHERE e.referent_id IS DISTINCT FROM t.referent_id"
        )
    ).all()
    for event_id, referent_id in rows:
        explicit = False
        for before, after in connection.execute(
            sa.text(
                "SELECT before, after FROM event_revisions WHERE event_id=:id AND origin='human'"
            ),
            {"id": event_id},
        ):
            before = json.loads(before) if isinstance(before, str) else before
            after = json.loads(after) if isinstance(after, str) else after
            if before and before.get("referent_id") != after.get("referent_id"):
                explicit = True
                break
        if not explicit:
            connection.execute(
                sa.text(
                    "UPDATE events SET referent_id=:referent, direct_edit=false, "
                    "version=version+1 WHERE id=:id"
                ),
                {"referent": referent_id, "id": event_id},
            )


def downgrade() -> None:
    # Les anciens référents ne sont pas conservés ; rien à défaire.
    pass
