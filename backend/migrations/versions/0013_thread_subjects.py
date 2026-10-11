"""Fils de messagerie sans événement (décision sur une demande refusée) : sujet libre."""

import sqlalchemy as sa
from alembic import op

revision = "0013_thread_subjects"
down_revision = "0012_notification_links"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column("question_threads", "event_id", existing_type=sa.String(36), nullable=True)
    op.add_column(
        "question_threads",
        sa.Column("subject", sa.String(length=200), nullable=False, server_default=""),
    )


def downgrade() -> None:
    op.execute("DELETE FROM question_threads WHERE event_id IS NULL")
    op.drop_column("question_threads", "subject")
    op.alter_column("question_threads", "event_id", existing_type=sa.String(36), nullable=False)
