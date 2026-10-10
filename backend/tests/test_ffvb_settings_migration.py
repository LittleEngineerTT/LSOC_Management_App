import os
import subprocess
from pathlib import Path

import pytest
from sqlalchemy import text

from app.persistence.database import SessionFactory, engine
from app.persistence.models import Base, FFVBSource, Section

BACKEND = Path(__file__).resolve().parents[1]


def migrate(revision: str) -> None:
    subprocess.run([str(BACKEND / '.venv/bin/alembic'), '-c', str(BACKEND / 'alembic.ini'), 'upgrade', revision], cwd=BACKEND, env=os.environ.copy(), capture_output=True, text=True, check=True)


@pytest.fixture
def legacy_schema():
    Base.metadata.drop_all(engine)
    with engine.begin() as db:
        db.execute(text('DROP TABLE IF EXISTS alembic_version'))
    try:
        yield
    finally:
        Base.metadata.drop_all(engine)
        with engine.begin() as db:
            db.execute(text('DROP TABLE IF EXISTS alembic_version'))


def test_settings_migration_preserves_sources_and_locks_existing_club(legacy_schema) -> None:
    migrate('0002_audit_match_settings')
    with SessionFactory.begin() as db:
        db.execute(text("INSERT INTO users (id, first_name, category, roles, active, messaging_allowed, followed_email, referent_email, admin_email) VALUES ('legacy-admin', 'Admin', 'adult', '[\"admin\"]', true, true, true, true, true)"))
        db.add(Section(id='legacy-section', name='Loisir'))
        db.flush()
        db.execute(text("INSERT INTO teams (id, name, section_id, referent_id) VALUES ('legacy-team', 'LSO COLOMBES', 'legacy-section', 'legacy-admin')"))
        db.flush()
        db.add(FFVBSource(id='legacy-source', team_id='legacy-team', season='2026/2027', entity='PTIDF92', pool='BRC', team_number='6', team_name='LSO COLOMBES', club_code='0926620', interval_minutes=15))
    migrate('head')
    with engine.connect() as db:
        assert db.scalar(text('SELECT club_code FROM club_settings WHERE id=1')) == '0926620'
        assert db.scalar(text("SELECT interval_minutes FROM ffvb_sources WHERE id='legacy-source'")) == 1440
        assert db.scalar(text('SELECT COUNT(*) FROM ffvb_sources')) == 1


def test_username_migration_keeps_passwords_handles_collisions_and_pending_activation(legacy_schema) -> None:
    migrate('0004_team_source_warning')
    with engine.begin() as db:
        for identifier, address, password, active in [('a', 'alex@example.org', 'hash-a', True), ('b', 'alex@other.org', 'hash-b', True), ('c', 'pending@example.org', 'hash-c', False), ('d', None, None, False), ('e', 'expired@example.org', 'hash-e', False)]:
            db.execute(text("INSERT INTO users (id, first_name, category, roles, email, password_hash, active, messaging_allowed, followed_email, referent_email, admin_email) VALUES (:id, 'Legacy', 'adult', '[\"member\"]', :email, :password, :active, true, true, true, true)"), {'id': identifier, 'email': address, 'password': password, 'active': active})
        db.execute(text("INSERT INTO auth_tokens (hash, user_id, purpose, expires_at) VALUES ('verify-hash', 'c', 'verify', CURRENT_TIMESTAMP + INTERVAL '1 day'), ('invitation-hash', 'd', 'invitation', CURRENT_TIMESTAMP + INTERVAL '1 day')"))
    migrate('head')
    with engine.connect() as db:
        values = {row.id: row for row in db.execute(text('SELECT id, username, email, password_hash, active FROM users'))}
        assert values['a'].username == 'alex' and values['b'].username == 'alex-1'
        assert values['a'].password_hash == 'hash-a' and values['b'].email == 'alex@other.org'
        assert values['c'].active is True and values['c'].username == 'pending'
        assert values['d'].active is False and values['d'].username is None
        assert values['e'].active is True and values['e'].username == 'expired'
        assert list(db.scalars(text('SELECT purpose FROM auth_tokens'))) == ['invitation']
        # A shared notification address is independent of login identity.
        db.execute(text("UPDATE users SET email='shared@example.org' WHERE id IN ('a', 'b')"))
