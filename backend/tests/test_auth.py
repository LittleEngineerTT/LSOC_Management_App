import json
from datetime import timedelta

from fastapi.testclient import TestClient
from sqlalchemy import select

from app.core.security import cipher, now
from app.persistence.database import SessionFactory
from app.persistence.models import AuthToken, EmailJob, User
from conftest import PASSWORD, add_user, login


def test_bad_login_and_csrf(client: TestClient, admin: TestClient) -> None:
    assert client.post('/api/v1/auth/login', json={'email': 'unknown@example.org', 'password': PASSWORD}).status_code == 401
    admin.headers.pop('X-CSRF-Token')
    assert admin.post('/api/v1/sections', json={'name': 'Section'}).status_code == 403
    assert admin.get('/api/v1/auth/me').json()['email'] == 'admin@example.org'


def test_invitation_verification_single_use(admin: TestClient) -> None:
    response = admin.post('/api/v1/users', json={'first_name': 'Camille', 'category': 'M18', 'roles': ['member']})
    assert response.status_code == 201, response.text
    user_id = response.json()['user']['id']
    invitation = response.json()['invitation_token']
    visitor = TestClient(admin.app)
    payload = {'token': invitation, 'email': 'camille@example.org', 'password': PASSWORD}
    assert visitor.post('/api/v1/auth/activate', json=payload).status_code == 202
    assert visitor.post('/api/v1/auth/activate', json=payload).status_code == 400
    assert visitor.post('/api/v1/auth/login', json={'email': 'camille@example.org', 'password': PASSWORD}).status_code == 401
    with SessionFactory() as db:
        job = db.scalar(select(EmailJob).where(EmailJob.user_id == user_id))
        assert job is not None
        message = json.loads(cipher().decrypt(job.encrypted_payload.encode()))
        verification = message['body'].split('token=')[1].split()[0]
    assert visitor.post('/api/v1/auth/verify-email', json={'token': verification}).status_code == 200
    assert visitor.post('/api/v1/auth/verify-email', json={'token': verification}).status_code == 400
    assert visitor.post('/api/v1/auth/login', json={'email': 'camille@example.org', 'password': PASSWORD}).status_code == 200


def test_expired_invitation_and_roles(admin: TestClient) -> None:
    result = admin.post('/api/v1/users', json={'first_name': 'Young', 'category': 'M15', 'roles': ['member']})
    assert result.status_code == 422
    result = admin.post('/api/v1/users', json={'first_name': 'Coach', 'category': 'M15', 'roles': ['coach']})
    assert result.status_code == 201
    with SessionFactory.begin() as db:
        t = db.scalar(select(AuthToken).where(AuthToken.user_id == result.json()['user']['id']))
        assert t is not None
        t.expires_at = now() - timedelta(seconds=1)
    assert admin.post('/api/v1/auth/activate', json={'token': result.json()['invitation_token'], 'email': 'coach@example.org', 'password': PASSWORD}).status_code == 400
    add_user()
    member = login()
    assert member.get('/api/v1/users').status_code == 403
    assert member.post('/api/v1/sections', json={'name': 'Blocked'}).status_code == 403
    assert admin.delete('/api/v1/users/admin').status_code == 409


def test_recovery_revokes_sessions_and_does_not_enumerate(admin: TestClient) -> None:
    add_user()
    member = login()
    visitor = TestClient(admin.app)
    for email in ['member@example.org', 'unknown@example.org']:
        r = visitor.post('/api/v1/auth/forgot-password', json={'email': email})
        assert r.status_code == 202
    with SessionFactory() as db:
        job = db.scalar(select(EmailJob).where(EmailJob.user_id == 'member'))
        assert job is not None
        recovery = json.loads(cipher().decrypt(job.encrypted_payload.encode()))['body'].split('token=')[1].split()[0]
    payload = {'token': recovery, 'password': 'replacement-password-123'}
    assert visitor.post('/api/v1/auth/reset-password', json=payload).status_code == 200
    assert member.get('/api/v1/auth/me').status_code == 401
    assert visitor.post('/api/v1/auth/reset-password', json=payload).status_code == 400
    assert visitor.post('/api/v1/auth/login', json={'email': 'member@example.org', 'password': 'replacement-password-123'}).status_code == 200


def test_delete_account_invalidates_access_and_purges(admin: TestClient) -> None:
    add_user()
    member = login()
    assert admin.delete('/api/v1/users/member').status_code == 204
    assert member.get('/api/v1/auth/me').status_code == 401
    with SessionFactory() as db:
        assert db.get(User, 'member') is None
        assert list(db.scalars(select(EmailJob).where(EmailJob.user_id == 'member'))) == []
