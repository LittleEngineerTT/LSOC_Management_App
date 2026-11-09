"""Statut « Conflit » : un événement privé de terrains par une indisponibilité n’est plus
annulé, il est en conflit jusqu’à ce que l’indisponibilité le libère ou qu’on l’annule."""

import sqlalchemy as sa
from alembic import op

revision = "0041_event_conflict"
down_revision = "0040_ffvb_plateaux"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "events",
        sa.Column("conflict", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column(
        "events",
        sa.Column("conflict_note", sa.String(200), nullable=False, server_default=""),
    )
    # Les annulations automatiques passées deviennent des conflits.
    op.execute(
        "UPDATE events SET conflict = true, conflict_note = cancel_note, cancelled = false,"
        " cancel_reason = '', cancel_note = '' WHERE cancelled AND cancel_reason = 'unavailability'"
    )


def downgrade() -> None:
    op.execute(
        "UPDATE events SET cancelled = true, cancel_reason = 'unavailability',"
        " cancel_note = conflict_note WHERE conflict AND NOT cancelled"
    )
    op.drop_column("events", "conflict_note")
    op.drop_column("events", "conflict")
