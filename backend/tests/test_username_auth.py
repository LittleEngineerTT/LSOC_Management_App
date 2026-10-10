from fastapi.testclient import TestClient
from sqlalchemy import select
from concurrent.futures import ThreadPoolExecutor, TimeoutError
from threading import Event
import pytest

from app.persistence.database import SessionFactory
from app.persistence.models import EmailJob
from conftest import PASSWORD, add_user
from app.api import auth


def test_activation_without_email_and_admin_reset(admin: TestClient) -> None:
    created = admin.post('/api/v1/users', json={'first_name': 'Camille', 'category': 'M18', 'roles': ['member']}).json()
    with TestClient(admin.app) as visitor:
        result = visitor.post('/api/v1/auth/activate', json={'token': created['invitation_token'], 'username': 'Camille.Volley', 'password': PASSWORD})
        assert result.status_code == 200, result.text
        result = visitor.post('/api/v1/auth/login', json={'username': 'CAMILLE.VOLLEY', 'password': PASSWORD})
        assert result.status_code == 200, result.text
        assert result.json()['user']['email'] is None
        assert result.json()['user']['username'] == 'camille.volley'
        visitor.headers['X-CSRF-Token'] = result.json()['csrf_token']
        assert visitor.post(f"/api/v1/users/{created['user']['id']}/password-reset").status_code == 403
        link = admin.post(f"/api/v1/users/{created['user']['id']}/password-reset").json()
        assert 'reset-password?token=' in link['reset_url']
        assert visitor.post('/api/v1/auth/reset-password', json={'token': link['reset_token'], 'password': 'nouveau-password-123'}).status_code == 200
        assert visitor.get('/api/v1/auth/me').status_code == 401
        assert visitor.post('/api/v1/auth/reset-password', json={'token': link['reset_token'], 'password': 'nouveau-password-123'}).status_code == 400
    with SessionFactory() as db:
        assert list(db.scalars(select(EmailJob).where(EmailJob.user_id == created['user']['id']))) == []


def test_identifier_uniqueness_and_admin_rename(admin: TestClient) -> None:
    created = admin.post('/api/v1/users', json={'first_name': 'Camille', 'roles': ['member']}).json()
    body = {'token': created['invitation_token'], 'username': 'admin', 'password': PASSWORD}
    assert admin.post('/api/v1/auth/activate', json=body).status_code == 409
    body['username'] = 'camille'
    assert admin.post('/api/v1/auth/activate', json=body).status_code == 200
    path = f"/api/v1/users/{created['user']['id']}/username"
    assert admin.put(path, json={'username': 'ADMIN'}).status_code == 409
    assert admin.put(path, json={'username': 'Camille.New'}).json()['username'] == 'camille.new'
    assert admin.post('/api/v1/auth/login', json={'username': 'camille', 'password': PASSWORD}).status_code == 401
    assert admin.post('/api/v1/auth/login', json={'username': 'camille.new', 'password': PASSWORD}).status_code == 200
    assert admin.post('/api/v1/auth/login', json={'email': 'admin@example.org', 'password': PASSWORD}).status_code == 422


def test_email_is_optional_preferences_only_and_verification_routes_removed(admin: TestClient) -> None:
    assert admin.put('/api/v1/preferences', json={'email': 'notifications@example.org', 'followed_email': False}).json()['email'] == 'notifications@example.org'
    assert admin.get('/api/v1/auth/me').json()['active'] is True
    assert admin.put('/api/v1/preferences', json={'email': None}).json()['email'] is None
    assert admin.put('/api/v1/preferences', json={'email': 'invalid'}).status_code == 422
    for path in ['verify-email', 'resend-verification', 'forgot-password']:
        assert admin.post('/api/v1/auth/' + path, json={'email': 'admin@example.org'}).status_code == 404


@pytest.mark.parametrize('action', ['rename', 'reset'])
def test_login_cannot_recreate_a_session_after_credential_revocation(admin: TestClient, monkeypatch, action: str) -> None:
    add_user()
    reset_token = admin.post('/api/v1/users/member/password-reset').json()['reset_token']
    verifying, release = Event(), Event()
    original = auth.verify_password
    def paused(password, hashed):
        result = original(password, hashed)
        verifying.set()
        assert release.wait(5)
        return result
    monkeypatch.setattr(auth, 'verify_password', paused)
    with TestClient(admin.app) as visitor, ThreadPoolExecutor(max_workers=2) as pool:
        pending = pool.submit(lambda: visitor.post('/api/v1/auth/login', json={'username': 'member', 'password': PASSWORD}))
        assert verifying.wait(5)
        if action == 'rename':
            mutation = pool.submit(lambda: admin.put('/api/v1/users/member/username', json={'username': 'member-new'}))
        else:
            mutation = pool.submit(lambda: admin.post('/api/v1/auth/reset-password', json={'token': reset_token, 'password': 'changed-password-123'}))
        try:
            with pytest.raises(TimeoutError):
                mutation.result(timeout=0.3)
        finally:
            release.set()
        assert pending.result(timeout=5).status_code == 200
        assert mutation.result(timeout=5).status_code == 200
        assert visitor.get('/api/v1/auth/me').status_code == 401


def test_username_may_be_an_unverified_email_address(admin: TestClient) -> None:
    created = admin.post('/api/v1/users', json={'first_name': 'Camille', 'roles': ['member']}).json()
    body = {'token': created['invitation_token'], 'username': ' Camille+Club@Example.ORG ', 'password': PASSWORD}
    assert admin.post('/api/v1/auth/activate', json=body).status_code == 200
    with TestClient(admin.app) as visitor:
        result = visitor.post('/api/v1/auth/login', json={'username': 'camille+club@example.org', 'password': PASSWORD})
        assert result.status_code == 200, result.text
        assert result.json()['user']['username'] == 'camille+club@example.org'
        assert result.json()['user']['email'] is None
    with SessionFactory() as db:
        assert list(db.scalars(select(EmailJob).where(EmailJob.user_id == created['user']['id']))) == []
    path = f"/api/v1/users/{created['user']['id']}/username"
    for invalid in ['a@b@c.org', '@example.org', 'camille@', 'camille volley']:
        assert admin.put(path, json={'username': invalid}).status_code == 422, invalid
