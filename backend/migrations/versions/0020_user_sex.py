"""Comptes : sexe facultatif (M ou F)."""

import sqlalchemy as sa
from alembic import op

revision = "0020_user_sex"
down_revision = "0019_player_details"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("sex", sa.String(1), nullable=True))
    op.create_check_constraint("users_sex_check", "users", "sex IN ('M','F')")


def downgrade() -> None:
    op.drop_constraint("users_sex_check", "users", type_="check")
    op.drop_column("users", "sex")
