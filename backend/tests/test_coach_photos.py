import hashlib
from collections.abc import Iterator

import httpx
import pytest
from conftest import add_user, login
from fastapi.testclient import TestClient

from app.core.config import settings
from app.integrations import s3
from app.main import app

HOST = 'lsoc-licences.s3.eu-west-3.amazonaws.com'
JPEG = b'\xff\xd8\xff\xe0\x00\x10JFIF\x00photo'
PNG = b'\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDRphoto'
WEBP = b'RIFF\x10\x00\x00\x00WEBPVP8 photo'


@pytest.fixture
def bucket(monkeypatch: pytest.MonkeyPatch) -> Iterator[dict[str, tuple[bytes, str]]]:
    """S3 simulé : clé → (contenu, type) derrière le transport httpx."""
    objects: dict[str, tuple[bytes, str]] = {}

    def handle(request: httpx.Request) -> httpx.Response:
        assert request.url.host == HOST
        assert request.headers['x-amz-content-sha256'] == hashlib.sha256(request.content).hexdigest()
        key = request.url.path.lstrip('/')
        if request.method == 'PUT':
            assert request.headers['content-disposition'] == 'inline'
            objects[key] = (request.content, request.headers['content-type'])
            return httpx.Response(200)
        if request.method == 'DELETE':
            objects.pop(key, None)
            return httpx.Response(204)
        return httpx.Response(405)

    monkeypatch.setattr(s3, 'transport', httpx.MockTransport(handle))
    for name, value in (('s3_bucket', 'lsoc-licences'), ('s3_region', 'eu-west-3'), ('s3_endpoint_url', ''), ('s3_access_key', 'test-key'), ('s3_secret_key', 'test-secret'), ('s3_public_url', '')):
        monkeypatch.setattr(settings, name, value)
    yield objects


def put(client: TestClient, path: str, body: bytes, content_type: str) -> httpx.Response:
    return client.put(f'/api/v1{path}', content=body, headers={'Content-Type': content_type})


def staff_photo(first_name: str) -> str | None:
    staff = TestClient(app).get('/api/v1/public/staff').json()
    return next(person['photo'] for person in staff if person['first_name'] == first_name)


def test_coach_adds_replaces_and_removes_their_photo_shown_in_our_club(admin: TestClient, bucket: dict[str, tuple[bytes, str]]) -> None:
    add_user('coach1', ['member', 'coach'])
    coach = login('coach1')
    response = put(coach, '/me/photo', JPEG, 'image/jpeg')
    assert response.status_code == 200, response.text
    url = response.json()['photo_url']
    [key] = bucket
    assert key.startswith('photos/') and len(key) == len('photos/') + 64
    assert bucket[key] == (JPEG, 'image/jpeg')
    assert url == f'https://{HOST}/{key}'
    assert coach.get('/api/v1/auth/me').json()['photo_url'] == url
    assert staff_photo('coach1') == url
    # Remplacée : l’ancienne quitte le stockage.
    replaced = put(coach, '/me/photo', WEBP, 'image/webp').json()['photo_url']
    assert replaced != url and list(bucket.values()) == [(WEBP, 'image/webp')]
    assert coach.delete('/api/v1/me/photo').json()['photo_url'] is None
    assert bucket == {} and staff_photo('coach1') is None
    assert coach.delete('/api/v1/me/photo').status_code == 404


def test_only_coaches_have_a_photo_and_only_real_images_are_accepted(admin: TestClient, bucket: dict[str, tuple[bytes, str]]) -> None:
    add_user()
    assert put(login(), '/me/photo', JPEG, 'image/jpeg').status_code == 409
    add_user('coach1', ['coach'])
    coach = login('coach1')
    assert put(coach, '/me/photo', b'%PDF-1.7', 'application/pdf').status_code == 415
    # Type annoncé démenti par le contenu.
    assert put(coach, '/me/photo', b'<svg></svg>', 'image/png').status_code == 415
    assert put(coach, '/me/photo', JPEG + b'\x00' * (5 * 1024 * 1024), 'image/jpeg').status_code == 413
    assert TestClient(admin.app).put('/api/v1/me/photo', content=JPEG, headers={'Content-Type': 'image/jpeg'}).status_code == 401
    assert bucket == {}


def test_admin_sets_the_photo_of_a_new_coach_and_it_leaves_with_the_role_or_the_account(admin: TestClient, bucket: dict[str, tuple[bytes, str]]) -> None:
    body = {'first_name': 'Alice', 'last_name': 'Durand', 'category': 'adult', 'roles': ['coach']}
    created = admin.post('/api/v1/users', json=body).json()['user']
    assert created['photo_url'] is None
    response = put(admin, f"/users/{created['id']}/photo", PNG, 'image/png')
    assert response.status_code == 200, response.text
    assert response.json()['photo_url'] is not None and len(bucket) == 1
    assert staff_photo('Alice') == response.json()['photo_url']
    # Un coach ne dépose pas la photo d’un autre compte.
    add_user('coach1', ['coach'])
    assert put(login('coach1'), f"/users/{created['id']}/photo", PNG, 'image/png').status_code == 403
    # Sans le rôle coach, la photo disparaît.
    updated = admin.put(f"/api/v1/users/{created['id']}", json={**body, 'roles': ['member']})
    assert updated.status_code == 200, updated.text
    assert updated.json()['photo_url'] is None and bucket == {}
    assert put(admin, f"/users/{created['id']}/photo", PNG, 'image/png').status_code == 409
    # La suppression du compte efface aussi sa photo.
    assert put(admin, '/users/coach1/photo', JPEG, 'image/jpeg').status_code == 200
    assert admin.delete('/api/v1/users/coach1').status_code == 204
    assert bucket == {}


def test_photo_requires_a_configured_storage(admin: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, 's3_bucket', '')
    add_user('coach1', ['coach'])
    assert put(login('coach1'), '/me/photo', JPEG, 'image/jpeg').status_code == 503
