"""Équipes et événements : plusieurs référents, à égalité de droits."""

import sqlalchemy as sa
from alembic import op

revision = "0023_referents"
down_revision = "0022_dossiers"
branch_labels = None
depends_on = None

# Champs JSON qui recopient les champs d’un événement : historique, demandes, propositions.
SNAPSHOTS = [
    ("event_revisions", "before"),
    ("event_revisions", "after"),
    ("change_requests", "changes"),
    ("coach_event_requests", "proposal"),
]


def upgrade() -> None:
    for table in ("teams", "events"):
        op.add_column(
            table, sa.Column("referent_ids", sa.JSON(), nullable=False, server_default="[]")
        )
        op.execute(
            f"UPDATE {table} SET referent_ids = json_build_array(referent_id) "
            "WHERE referent_id IS NOT NULL"
        )
        op.drop_column(table, "referent_id")
    for table, column in SNAPSHOTS:
        op.execute(
            f"""
            UPDATE {table} SET {column} = (
                ({column}::jsonb - 'referent_id')
                || jsonb_build_object(
                    'referent_ids',
                    CASE WHEN {column}::jsonb ->> 'referent_id' IS NULL THEN '[]'::jsonb
                    ELSE jsonb_build_array({column}::jsonb ->> 'referent_id') END
                )
            )::json
            WHERE jsonb_exists({column}::jsonb, 'referent_id')
            """
        )


def downgrade() -> None:
    # Retour à un seul référent : le premier de chaque liste.
    for table, column in SNAPSHOTS:
        op.execute(
            f"""
            UPDATE {table} SET {column} = (
                ({column}::jsonb - 'referent_ids')
                || jsonb_build_object('referent_id', {column}::jsonb -> 'referent_ids' -> 0)
            )::json
            WHERE jsonb_exists({column}::jsonb, 'referent_ids')
            """
        )
    for table in ("teams", "events"):
        op.add_column(
            table,
            sa.Column(
                "referent_id",
                sa.String(36),
                sa.ForeignKey("users.id", ondelete="SET NULL", onupdate="CASCADE"),
                nullable=True,
            ),
        )
        op.execute(
            f"UPDATE {table} SET referent_id = referent_ids ->> 0 "
            "WHERE json_array_length(referent_ids) > 0"
        )
        op.drop_column(table, "referent_ids")
    op.create_index("ix_events_referent_id", "events", ["referent_id"])
