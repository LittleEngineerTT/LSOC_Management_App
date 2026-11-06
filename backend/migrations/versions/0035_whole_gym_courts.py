"""Zéro terrain par match : le match prend tout le gymnase."""

from alembic import op

revision = "0035_whole_gym_courts"
down_revision = "0034_cancel_reason"
branch_labels = None
depends_on = None

NAME = "ffvb_sources_match_settings_check"
MARGINS = "(before_minutes IS NULL OR before_minutes >= 0)"
AFTER = " AND (after_minutes IS NULL OR after_minutes > 0)"


def upgrade() -> None:
    op.drop_constraint(NAME, "ffvb_sources", type_="check")
    rule = MARGINS + AFTER + " AND (courts IS NULL OR courts >= 0)"
    op.create_check_constraint(NAME, "ffvb_sources", rule)


def downgrade() -> None:
    # Les sources « tout le gymnase » retrouvent le réglage par défaut du club.
    op.execute("UPDATE ffvb_sources SET courts = NULL WHERE courts = 0")
    op.drop_constraint(NAME, "ffvb_sources", type_="check")
    rule = MARGINS + AFTER + " AND (courts IS NULL OR courts > 0)"
    op.create_check_constraint(NAME, "ffvb_sources", rule)
