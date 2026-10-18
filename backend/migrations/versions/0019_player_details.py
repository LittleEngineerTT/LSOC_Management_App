"""Rattachements : numéro de maillot et poste des joueurs, postes définis par l’administration."""

from uuid import uuid4

import sqlalchemy as sa
from alembic import op

revision = "0019_player_details"
down_revision = "0018_license_files"
branch_labels = None
depends_on = None

# Postes du volley proposés au départ ; l’administration les modifie ensuite.
DEFAULT_POSITIONS = ["Passeur", "Pointu", "Réceptionneur-attaquant", "Central", "Libéro"]


def upgrade() -> None:
    positions = op.create_table(
        "positions",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("name", sa.String(120), nullable=False, unique=True),
    )
    op.bulk_insert(positions, [{"id": str(uuid4()), "name": name} for name in DEFAULT_POSITIONS])
    op.add_column("assignments", sa.Column("number", sa.Integer(), nullable=True))
    op.add_column(
        "assignments",
        sa.Column(
            "position_id",
            sa.String(36),
            sa.ForeignKey("positions.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.create_check_constraint(
        "assignments_number_range", "assignments", "number IS NULL OR number BETWEEN 1 AND 99"
    )
    op.create_check_constraint(
        "assignments_player_details",
        "assignments",
        "kind = 'player' OR (number IS NULL AND position_id IS NULL)",
    )
    op.create_index(
        "assignments_team_number",
        "assignments",
        ["team_id", "number"],
        unique=True,
        postgresql_where=sa.text("number IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index("assignments_team_number", table_name="assignments")
    op.drop_constraint("assignments_player_details", "assignments", type_="check")
    op.drop_constraint("assignments_number_range", "assignments", type_="check")
    op.drop_column("assignments", "position_id")
    op.drop_column("assignments", "number")
    op.drop_table("positions")
