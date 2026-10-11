from datetime import timedelta

from fastapi.testclient import TestClient
from sqlalchemy import select

from app.core.security import now
from app.persistence.database import SessionFactory
from app.persistence.models import AuthToken, EmailJob, LoginSession, User
from conftest import PASSWORD, add_user, grant_license, login


def test_bad_login_and_csrf(client: TestClient, admin: TestClient) -> None:
    assert client.post('/api/v1/auth/login', json={'username': 'unknown', 'password': PASSWORD}).status_code == 401
    admin.headers.pop('X-CSRF-Token')
    assert admin.post('/api/v1/sections', json={'name': 'Section'}).status_code == 403
    assert admin.get('/api/v1/auth/me').json()['email'] == 'admin@example.org'


def test_invitation_activation_single_use(admin: TestClient) -> None:
    response = admin.post('/api/v1/users', json={'last_name': 'Durand', 'first_name': 'Camille', 'category': 'M18', 'roles': ['member']})
    assert response.status_code == 201, response.text
    user_id = response.json()['user']['id']
    invitation = response.json()['invitation_token']
    visitor = TestClient(admin.app)
    payload = {'token': invitation, 'username': 'camille', 'password': PASSWORD}
    assert visitor.post('/api/v1/auth/activate', json=payload).status_code == 200
    assert visitor.post('/api/v1/auth/activate', json=payload).status_code == 400
    # Sans numéro de licence, le compte activé reste inaccessible.
    refused = visitor.post('/api/v1/auth/login', json={'username': 'camille', 'password': PASSWORD})
    assert refused.status_code == 403 and refused.json()['detail']['code'] == 'license_required'
    grant_license(admin, user_id)
    assert visitor.post('/api/v1/auth/login', json={'username': 'camille', 'password': PASSWORD}).status_code == 200
    with SessionFactory() as db:
        assert list(db.scalars(select(EmailJob).where(EmailJob.user_id == user_id))) == []


def test_expired_invitation_and_roles(admin: TestClient) -> None:
    result = admin.post('/api/v1/users', json={'last_name': 'Durand', 'first_name': 'Young', 'category': 'M15', 'roles': ['member']})
    assert result.status_code == 422
    result = admin.post('/api/v1/users', json={'last_name': 'Durand', 'first_name': 'Coach', 'category': 'M15', 'roles': ['coach']})
    assert result.status_code == 201
    with SessionFactory.begin() as db:
        t = db.scalar(select(AuthToken).where(AuthToken.user_id == result.json()['user']['id']))
        assert t is not None
        t.expires_at = now() - timedelta(seconds=1)
    assert admin.post('/api/v1/auth/activate', json={'token': result.json()['invitation_token'], 'username': 'coach', 'password': PASSWORD}).status_code == 400
    add_user()
    member = login()
    assert member.get('/api/v1/users').status_code == 403
    assert member.post('/api/v1/sections', json={'name': 'Blocked'}).status_code == 403
    assert admin.delete('/api/v1/users/admin').status_code == 409


def test_admin_recovery_revokes_sessions_and_is_single_use(admin: TestClient) -> None:
    add_user()
    member = login()
    visitor = TestClient(admin.app)
    link = admin.post('/api/v1/users/member/password-reset')
    assert link.status_code == 200, link.text
    assert visitor.post('/api/v1/users/member/password-reset').status_code == 401
    payload = {'token': link.json()['reset_token'], 'password': 'replacement-password-123'}
    assert visitor.post('/api/v1/auth/reset-password', json=payload).status_code == 200
    assert member.get('/api/v1/auth/me').status_code == 401
    assert visitor.post('/api/v1/auth/reset-password', json=payload).status_code == 400
    assert visitor.post('/api/v1/auth/login', json={'username': 'member', 'password': 'replacement-password-123'}).status_code == 200


def test_delete_account_invalidates_access_and_purges(admin: TestClient) -> None:
    add_user()
    member = login()
    assert admin.delete('/api/v1/users/member').status_code == 204
    assert member.get('/api/v1/auth/me').status_code == 401
    with SessionFactory() as db:
        assert db.get(User, 'member') is None
        assert list(db.scalars(select(EmailJob).where(EmailJob.user_id == 'member'))) == []


def test_session_expires_only_after_a_week_without_activity(client: TestClient) -> None:
    response = client.post('/api/v1/auth/login', json={'username': 'admin', 'password': PASSWORD})
    assert response.status_code == 200
    assert 'Max-Age=604800' in response.headers['set-cookie']
    client.headers['X-CSRF-Token'] = response.json()['csrf_token']

    def age(days: float) -> None:
        with SessionFactory.begin() as db:
            for record in db.scalars(select(LoginSession)):
                record.expires_at = now() + timedelta(days=7 - days)

    def remaining() -> timedelta:
        with SessionFactory() as db:
            return db.scalars(select(LoginSession)).one().expires_at - now()

    age(6)
    # Le rafraîchissement automatique des pastilles ne compte pas comme une activité.
    assert client.get('/api/v1/unread').status_code == 200
    assert remaining() < timedelta(days=1.1)
    refreshed = client.get('/api/v1/auth/me')
    assert refreshed.status_code == 200
    assert remaining() > timedelta(days=6.9)
    assert 'lsoc_session=' in refreshed.headers['set-cookie'] and 'lsoc_csrf=' in refreshed.headers['set-cookie']
    # Moins d’une heure après, aucune réécriture ni nouveau cookie.
    assert 'set-cookie' not in client.get('/api/v1/auth/me').headers
    age(7.01)
    assert client.get('/api/v1/auth/me').status_code == 401
