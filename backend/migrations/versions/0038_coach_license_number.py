"""Licence coach : numéro et PDF propres, distincts de la licence joueur."""

import sqlalchemy as sa
from alembic import op

revision = "0038_coach_license_number"
down_revision = "0037_conflict_ignores"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("licenses", sa.Column("coach_number", sa.String(length=40), nullable=True))
    op.add_column("licenses", sa.Column("coach_file_key", sa.String(length=80), nullable=True))
    op.add_column(
        "licenses", sa.Column("coach_file_uploaded_at", sa.DateTime(timezone=True), nullable=True)
    )
    # Une licence coach existante gardait le numéro commun : il devient son numéro coach.
    op.execute("UPDATE licenses SET coach_number = number WHERE coach_status <> 'none'")
    op.create_unique_constraint("licenses_coach_number_key", "licenses", ["coach_number"])
    op.drop_constraint("licenses_coach_active_number", "licenses", type_="check")
    op.create_check_constraint(
        "licenses_coach_active_number",
        "licenses",
        "coach_status <> 'active' OR coach_number IS NOT NULL",
    )


def downgrade() -> None:
    op.drop_constraint("licenses_coach_active_number", "licenses", type_="check")
    # Sans numéro coach séparé, une licence coach active reprend le numéro commun.
    op.execute(
        "UPDATE licenses SET number = coach_number "
        "WHERE number IS NULL AND coach_number IS NOT NULL"
    )
    op.create_check_constraint(
        "licenses_coach_active_number",
        "licenses",
        "coach_status <> 'active' OR number IS NOT NULL",
    )
    op.drop_constraint("licenses_coach_number_key", "licenses", type_="unique")
    op.drop_column("licenses", "coach_file_uploaded_at")
    op.drop_column("licenses", "coach_file_key")
    op.drop_column("licenses", "coach_number")
