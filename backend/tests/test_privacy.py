from datetime import UTC, datetime, timedelta

from conftest import PASSWORD, add_user, login
from fastapi.testclient import TestClient
from sqlalchemy import select
from test_events import payload, setup_planning

from app.persistence.database import SessionFactory
from app.persistence.models import ClubSettings, License, Notification, User
from app.services.privacy import apply_retention, reset_licenses


def test_export_contains_own_data_without_secrets(admin: TestClient) -> None:
    add_user('member')
    member = login('member')
    exported = member.get('/api/v1/me/export')
    assert exported.status_code == 200
    data = exported.json()
    assert data['compte']['id'] == 'member'
    assert 'password_hash' not in data['compte']
    assert data['licence']['number'] == 'member'


def test_member_erases_own_account_after_password_check(admin: TestClient) -> None:
    add_user('member')
    member = login('member')
    assert member.post('/api/v1/me/delete', json={'password': 'wrong-password'}).status_code == 403
    assert member.post('/api/v1/me/delete', json={'password': PASSWORD}).status_code == 204
    with SessionFactory() as db:
        assert db.get(User, 'member') is None
    assert member.get('/api/v1/auth/me').status_code == 401
    # Le dernier administrateur ne peut pas disparaître.
    assert admin.post('/api/v1/me/delete', json={'password': PASSWORD}).status_code == 409


def test_retention_purges_old_data_and_inactive_accounts(admin: TestClient) -> None:
    add_user('active')
    add_user('dormant')
    section, gym = setup_planning(admin)
    admin.post('/api/v1/events', json=payload(section, gym, referent='dormant'))
    old = datetime.now(UTC) - timedelta(days=800)
    with SessionFactory.begin() as db:
        dormant = db.get(User, 'dormant')
        assert dormant is not None
        dormant.last_seen_at = old
        db.add(Notification(user_id='active', kind='info', title='Ancienne', dedupe_key='old', created_at=old, read_at=old))
        db.add(Notification(user_id='active', kind='info', title='Récente', dedupe_key='new'))
    with SessionFactory.begin() as db:
        assert apply_retention(db) == 1
    with SessionFactory() as db:
        assert db.get(User, 'dormant') is None and db.get(User, 'active') is not None
        assert db.get(User, 'admin') is not None
        titles = set(db.scalars(select(Notification.title).where(Notification.user_id == 'active')))
        assert titles == {'Récente'}


def test_licenses_reset_every_august_first_once(admin: TestClient) -> None:
    add_user('member')
    with SessionFactory.begin() as db:
        license = db.get(License, 'member')
        assert license is not None
        license.status, license.coach_status = 'active', 'active'
    with SessionFactory.begin() as db:
        # Première exécution : la saison en cours est déjà considérée comme commencée.
        assert reset_licenses(db, datetime(2026, 10, 11, tzinfo=UTC)) is False
    with SessionFactory.begin() as db:
        assert reset_licenses(db, datetime(2027, 7, 31, 12, tzinfo=UTC)) is False
    with SessionFactory.begin() as db:
        assert reset_licenses(db, datetime(2027, 8, 1, 8, tzinfo=UTC)) is True
    with SessionFactory.begin() as db:
        assert reset_licenses(db, datetime(2027, 8, 2, tzinfo=UTC)) is False
    with SessionFactory() as db:
        license = db.get(License, 'member')
        assert license is not None
        assert (license.status, license.coach_status, license.number) == ('none', 'none', 'member')
        club = db.get(ClubSettings, 1)
        assert club is not None and str(club.licenses_reset_on) == '2027-08-01'
    # Le numéro conservé garde l’accès ; l’adhérent est invité à renouveler.
    member = login('member')
    titles = [n['title'] for n in member.get('/api/v1/notifications').json()]
    assert 'Nouvelle saison 2027/2028 : renouvelez votre licence' in titles
