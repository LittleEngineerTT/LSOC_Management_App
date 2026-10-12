"""Licences : PDF déposé dans le stockage S3."""

import sqlalchemy as sa
from alembic import op

revision = "0018_license_files"
down_revision = "0017_privacy"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("licenses", sa.Column("file_key", sa.String(80), nullable=True))
    op.add_column(
        "licenses", sa.Column("file_uploaded_at", sa.DateTime(timezone=True), nullable=True)
    )


def downgrade() -> None:
    op.drop_column("licenses", "file_uploaded_at")
    op.drop_column("licenses", "file_key")
