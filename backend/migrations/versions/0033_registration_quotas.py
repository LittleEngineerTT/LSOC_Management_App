"""Places réservées d’un événement : N places pour des postes d’une section."""

import sqlalchemy as sa
from alembic import op

revision = "0033_registration_quotas"
down_revision = "0032_coach_photos"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "events",
        sa.Column("registration_quotas", sa.JSON(), nullable=False, server_default="[]"),
    )
    op.add_column("registrations", sa.Column("quota_id", sa.String(36), nullable=True))


def downgrade() -> None:
    op.drop_column("registrations", "quota_id")
    op.drop_column("events", "registration_quotas")
