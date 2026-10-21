"""Relevé immédiat des résultats FFVB : chaque source active se resynchronise sans attendre."""

from alembic import op

revision = "0026_ffvb_results_backfill"
down_revision = "0025_ffvb_results"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Les sources se resynchronisent une fois par jour : sans cela, les résultats des matchs
    # déjà joués n’apparaîtraient qu’à leur prochaine échéance.
    op.execute("UPDATE ffvb_sources SET next_check_at = now() WHERE enabled")


def downgrade() -> None:
    # Rien à défaire : seule l’échéance de synchronisation a été avancée.
    pass
