"""Dossiers d’inscription : pièces demandées aux joueurs et validation du paiement."""

import sqlalchemy as sa
from alembic import op

revision = "0022_dossiers"
down_revision = "0021_registration_requests"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "dossiers",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "user_id",
            sa.String(36),
            sa.ForeignKey("users.id", ondelete="CASCADE", onupdate="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "opened_by",
            sa.String(36),
            sa.ForeignKey("users.id", ondelete="SET NULL", onupdate="CASCADE"),
            nullable=True,
        ),
        sa.Column("note", sa.Text(), nullable=False, server_default=""),
        sa.Column("payment_requested", sa.Boolean(), nullable=False),
        sa.Column("payment_validated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_dossiers_user_id", "dossiers", ["user_id"])
    op.create_index(
        "dossiers_one_open",
        "dossiers",
        ["user_id"],
        unique=True,
        postgresql_where=sa.text("closed_at IS NULL"),
    )
    op.create_table(
        "dossier_documents",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "dossier_id",
            sa.String(36),
            sa.ForeignKey("dossiers.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("kind", sa.String(30), nullable=False),
        sa.Column("label", sa.String(120), nullable=False, server_default=""),
        sa.Column("status", sa.String(10), nullable=False),
        sa.Column("file_key", sa.String(80), nullable=True),
        sa.Column("file_name", sa.String(200), nullable=True),
        sa.Column("content_type", sa.String(100), nullable=True),
        sa.Column("uploaded_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("decision", sa.Text(), nullable=False, server_default=""),
        sa.UniqueConstraint("dossier_id", "kind", "label"),
        sa.CheckConstraint(
            "kind IN ('medical_certificate','identity','reduction_proof','other')",
            name="dossier_documents_kind_check",
        ),
        sa.CheckConstraint(
            "(kind = 'other') = (label <> '')", name="dossier_documents_label_check"
        ),
        sa.CheckConstraint(
            "status IN ('requested','submitted','validated','rejected')",
            name="dossier_documents_status_check",
        ),
    )
    op.create_index("ix_dossier_documents_dossier_id", "dossier_documents", ["dossier_id"])


def downgrade() -> None:
    op.drop_table("dossier_documents")
    op.drop_table("dossiers")
