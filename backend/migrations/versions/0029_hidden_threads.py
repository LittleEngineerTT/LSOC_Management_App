"""Conversations supprimées de la messagerie d’un compte."""

import sqlalchemy as sa
from alembic import op

revision = "0029_hidden_threads"
down_revision = "0028_email_categories"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "hidden_threads",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "user_id",
            sa.String(36),
            sa.ForeignKey("users.id", ondelete="CASCADE", onupdate="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "thread_id",
            sa.String(36),
            sa.ForeignKey("question_threads.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("hidden_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("user_id", "thread_id"),
    )
    op.create_index("ix_hidden_threads_user_id", "hidden_threads", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_hidden_threads_user_id", table_name="hidden_threads")
    op.drop_table("hidden_threads")
