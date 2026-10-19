from fastapi.testclient import TestClient

from conftest import PASSWORD, add_user, login

NEW = 'brand-new-password-42'


def test_member_changes_password_and_other_sessions_are_closed() -> None:
    add_user()
    phone, laptop = login(), login()
    wrong = phone.post('/api/v1/me/password', json={'current_password': 'nope', 'new_password': NEW})
    assert wrong.status_code == 403
    assert phone.post('/api/v1/me/password', json={'current_password': PASSWORD, 'new_password': 'short'}).status_code == 422
    assert phone.post('/api/v1/me/password', json={'current_password': PASSWORD, 'new_password': NEW}).status_code == 204
    assert phone.get('/api/v1/auth/me').status_code == 200
    assert laptop.get('/api/v1/auth/me').status_code == 401
    with TestClient(phone.app) as other:
        assert other.post('/api/v1/auth/login', json={'username': 'member', 'password': PASSWORD}).status_code == 401
        assert other.post('/api/v1/auth/login', json={'username': 'member', 'password': NEW}).status_code == 200


def test_member_closes_other_sessions() -> None:
    add_user()
    phone, laptop = login(), login()
    assert phone.post('/api/v1/me/sessions/revoke').status_code == 204
    assert phone.get('/api/v1/auth/me').status_code == 200
    assert laptop.get('/api/v1/auth/me').status_code == 401


def test_self_service_requires_csrf() -> None:
    add_user()
    member = login()
    del member.headers['X-CSRF-Token']
    assert member.post('/api/v1/me/sessions/revoke').status_code == 403
    assert member.post('/api/v1/me/password', json={'current_password': PASSWORD, 'new_password': NEW}).status_code == 403
