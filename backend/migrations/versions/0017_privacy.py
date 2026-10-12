"""RGPD : dernière activité des comptes et remise à zéro annuelle des licences."""

import sqlalchemy as sa
from alembic import op

revision = "0017_privacy"
down_revision = "0016_event_teams"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Les comptes existants partent d’aujourd’hui : aucune purge immédiate à la mise à jour.
    op.add_column(
        "users",
        sa.Column(
            "last_seen_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.add_column("club_settings", sa.Column("licenses_reset_on", sa.Date(), nullable=True))
    # La saison en cours compte comme déjà remise à zéro : la prochaine sera au 1er août suivant.
    op.execute(
        """
        UPDATE club_settings SET licenses_reset_on = make_date(
            extract(year FROM now() AT TIME ZONE 'Europe/Paris')::int
            - CASE WHEN (now() AT TIME ZONE 'Europe/Paris')::date
                   < make_date(extract(year FROM now() AT TIME ZONE 'Europe/Paris')::int, 8, 1)
              THEN 1 ELSE 0 END,
            8, 1)
        """
    )


def downgrade() -> None:
    op.drop_column("club_settings", "licenses_reset_on")
    op.drop_column("users", "last_seen_at")
