"""Photo facultative des entraîneurs, stockée sur le S3."""

import sqlalchemy as sa
from alembic import op

revision = "0032_coach_photos"
down_revision = "0031_ffvb_calendar"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("photo_key", sa.String(100), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "photo_key")
