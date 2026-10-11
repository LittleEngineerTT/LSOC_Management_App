"""Description libre des événements, saisie par l’admin ou proposée par un coach."""

import sqlalchemy as sa
from alembic import op

revision = "0008_event_description"
down_revision = "0007_coach_event_requests"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("events", sa.Column("description", sa.Text(), nullable=False, server_default=""))


def downgrade() -> None:
    op.drop_column("events", "description")
