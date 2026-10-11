"""Identifiant de compte = numéro de licence : initiale du nom et clés mises à jour en cascade."""

import sqlalchemy as sa
from alembic import op

revision = "0015_user_identity"
down_revision = "0014_coach_licenses"
branch_labels = None
depends_on = None

FOREIGN_KEYS = """
SELECT c.conrelid::regclass::text, c.conname, pg_get_constraintdef(c.oid)
FROM pg_constraint c
WHERE c.contype = 'f' AND c.confrelid = 'users'::regclass
ORDER BY 1, 2
"""


def rebuild(cascade: bool) -> None:
    connection = op.get_bind()
    for table, name, definition in connection.execute(sa.text(FOREIGN_KEYS)).all():
        definition = definition.replace(" ON UPDATE CASCADE", "")
        if cascade:
            definition += " ON UPDATE CASCADE"
        op.execute(f'ALTER TABLE {table} DROP CONSTRAINT "{name}"')
        op.execute(f'ALTER TABLE {table} ADD CONSTRAINT "{name}" {definition}')


def upgrade() -> None:
    op.add_column(
        "users", sa.Column("last_initial", sa.String(length=1), nullable=False, server_default="")
    )
    # Un changement de numéro de licence renomme le compte partout où il est référencé.
    rebuild(cascade=True)


def downgrade() -> None:
    rebuild(cascade=False)
    op.drop_column("users", "last_initial")
