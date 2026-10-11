"""Notifications : message libre et lien vers l’écran à ouvrir."""

import sqlalchemy as sa
from alembic import op

revision = "0012_notification_links"
down_revision = "0011_licenses"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("notifications", sa.Column("body", sa.Text(), nullable=False, server_default=""))
    op.add_column("notifications", sa.Column("link", sa.String(length=300), nullable=True))


def downgrade() -> None:
    op.drop_column("notifications", "link")
    op.drop_column("notifications", "body")
