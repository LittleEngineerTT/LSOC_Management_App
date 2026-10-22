"""E-mails de notification groupés par catégorie après un court délai."""

import sqlalchemy as sa
from alembic import op

revision = "0028_email_categories"
down_revision = "0027_ffvb_results_schedule"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("email_jobs", sa.Column("category", sa.String(50), nullable=True))


def downgrade() -> None:
    op.drop_column("email_jobs", "category")
