"""Licences des adhérents : numéro unique et statut, gérés par les administrateurs."""

import sqlalchemy as sa
from alembic import op

revision = "0011_licenses"
down_revision = "0010_source_match_settings"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "licenses",
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("number", sa.String(length=40), nullable=True),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_by", sa.String(length=36), nullable=True),
        sa.CheckConstraint(
            "status IN ('none','in_progress','payment_pending','active')",
            name="licenses_status_check",
        ),
        sa.CheckConstraint(
            "status <> 'active' OR number IS NOT NULL", name="licenses_active_number"
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["updated_by"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("user_id"),
        sa.UniqueConstraint("number"),
    )


def downgrade() -> None:
    op.drop_table("licenses")
