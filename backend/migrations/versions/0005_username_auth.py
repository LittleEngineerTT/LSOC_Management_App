"""Identifiant de connexion ; adresse facultative pour les notifications."""

import re

import sqlalchemy as sa
from alembic import op

revision = "0005_username_auth"
down_revision = "0004_team_source_warning"
branch_labels = None
depends_on = None

# Copie figée de la règle de l’API au moment de la migration.
USERNAME_PATTERN = r"[a-z0-9][a-z0-9._+-]*(@[a-z0-9][a-z0-9.-]*)?"


def upgrade() -> None:
    op.add_column("users", sa.Column("username", sa.String(80), nullable=True))
    connection = op.get_bind()
    used: set[str] = set()
    for row in connection.execute(
        sa.text("SELECT id, email FROM users WHERE active OR password_hash IS NOT NULL ORDER BY id")
    ):
        address = (row.email or "").strip().lower()
        if 3 <= len(address) <= 80 and re.fullmatch(USERNAME_PATTERN, address):
            # L’ancienne adresse, unique jusqu’ici, reste l’identifiant de connexion.
            used.add(address)
            connection.execute(
                sa.text("UPDATE users SET username=:username WHERE id=:id"),
                {"username": address, "id": row.id},
            )
            continue
        stem = address.split("@")[0]
        stem = re.sub(r"[^a-z0-9._-]", "", stem).strip("._-")[:60]
        if len(stem) < 3:
            stem = "user-" + row.id.replace("-", "")[:20]
        candidate = stem
        suffix = 1
        while candidate in used:
            candidate = f"{stem}-{suffix}"
            suffix += 1
        used.add(candidate)
        connection.execute(
            sa.text("UPDATE users SET username=:username WHERE id=:id"),
            {"username": candidate, "id": row.id},
        )
    op.create_unique_constraint("users_username_key", "users", ["username"])
    op.drop_constraint("users_email_key", "users", type_="unique")
    op.execute(
        "UPDATE users SET active=true WHERE password_hash IS NOT NULL AND id IN (SELECT user_id FROM auth_tokens WHERE purpose='verify')"
    )
    op.execute("DELETE FROM auth_tokens WHERE purpose IN ('verify', 'recovery')")
    op.execute(
        "DELETE FROM email_jobs WHERE dedupe_key LIKE 'verify:%' OR dedupe_key LIKE 'recovery:%'"
    )


def downgrade() -> None:
    op.create_unique_constraint("users_email_key", "users", ["email"])
    op.drop_constraint("users_username_key", "users", type_="unique")
    op.drop_column("users", "username")
