"""Licence coach : statut séparé (sans paiement), même numéro que la licence joueur."""

import sqlalchemy as sa
from alembic import op

revision = "0014_coach_licenses"
down_revision = "0013_thread_subjects"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "licenses",
        sa.Column("coach_status", sa.String(length=20), nullable=False, server_default="none"),
    )
    op.create_check_constraint(
        "licenses_coach_status_check", "licenses", "coach_status IN ('none','in_progress','active')"
    )
    op.create_check_constraint(
        "licenses_coach_active_number", "licenses", "coach_status <> 'active' OR number IS NOT NULL"
    )


def downgrade() -> None:
    op.drop_constraint("licenses_coach_active_number", "licenses", type_="check")
    op.drop_constraint("licenses_coach_status_check", "licenses", type_="check")
    op.drop_column("licenses", "coach_status")
