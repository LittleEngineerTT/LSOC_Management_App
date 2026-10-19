import hashlib
from collections.abc import Iterator
from datetime import UTC, datetime

import httpx
import pytest
from conftest import add_user, login, record
from fastapi.testclient import TestClient
from test_licenses import setup

from app.core.config import settings
from app.integrations import s3
from app.persistence.database import SessionFactory
from app.persistence.models import License
from app.services.privacy import reset_licenses

PDF = b'%PDF-1.7\n%\xe2\xe3\xcf\xd3\nlicence\n%%EOF\n'
HOST = 'lsoc-licences.s3.eu-west-3.amazonaws.com'


@pytest.fixture
def bucket(monkeypatch: pytest.MonkeyPatch) -> Iterator[dict[str, bytes]]:
    """S3 simulé : un dictionnaire clé → contenu derrière le transport httpx."""
    objects: dict[str, bytes] = {}

    def handle(request: httpx.Request) -> httpx.Response:
        assert request.url.host == HOST
        assert request.headers['authorization'].startswith('AWS4-HMAC-SHA256 Credential=test-key/')
        assert request.headers['x-amz-content-sha256'] == hashlib.sha256(request.content).hexdigest()
        key = request.url.path.lstrip('/')
        if request.method == 'PUT':
            assert request.headers['content-type'] == 'application/pdf'
            objects[key] = request.content
            return httpx.Response(200)
        if request.method == 'DELETE':
            objects.pop(key, None)
            return httpx.Response(204)
        return httpx.Response(405)

    monkeypatch.setattr(s3, 'transport', httpx.MockTransport(handle))
    for name, value in (('s3_bucket', 'lsoc-licences'), ('s3_region', 'eu-west-3'), ('s3_endpoint_url', ''), ('s3_access_key', 'test-key'), ('s3_secret_key', 'test-secret'), ('s3_public_url', '')):
        monkeypatch.setattr(settings, name, value)
    yield objects


def upload(client: TestClient, user: str, body: bytes = PDF, content_type: str = 'application/pdf') -> httpx.Response:
    return client.put(f'/api/v1/licenses/{user}/file', content=body, headers={'Content-Type': content_type})


def row(client: TestClient, user: str, kind: str = 'player') -> dict[str, object]:
    return next(item for item in client.get(f'/api/v1/licenses?kind={kind}').json() if item['user_id'] == user)


def test_signature_matches_the_aws_reference(monkeypatch: pytest.MonkeyPatch) -> None:
    # Exemple « GET Object » de la documentation AWS Signature Version 4.
    for name, value in (('s3_region', 'us-east-1'), ('s3_access_key', 'AKIAIOSFODNN7EXAMPLE'), ('s3_secret_key', 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY')):
        monkeypatch.setattr(settings, name, value)
    headers = s3.signed_headers('GET', 'https://examplebucket.s3.amazonaws.com/test.txt', b'', {'Range': 'bytes=0-9'}, datetime(2013, 5, 24, tzinfo=UTC))
    assert headers['authorization'] == (
        'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, '
        'SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, '
        'Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41'
    )


def test_admin_uploads_replaces_and_removes_the_pdf(admin: TestClient, bucket: dict[str, bytes]) -> None:
    setup(admin)
    assert row(admin, 'alice')['file_url'] is None
    response = upload(admin, 'alice')
    assert response.status_code == 200, response.text
    url = response.json()['file_url']
    key = record(License, user_id='alice').file_key
    # Nom de 64 caractères aléatoires, servi directement par le bucket public.
    assert key.startswith('licences/') and len(key.removeprefix('licences/')) == 64
    assert url == f'https://{HOST}/{key}'
    assert bucket == {key: PDF}
    assert row(admin, 'alice')['file_url'] == url
    # Le remplacement supprime l’ancien objet.
    assert upload(admin, 'alice').status_code == 200
    replaced = record(License, user_id='alice').file_key
    assert replaced != key and list(bucket) == [replaced]
    assert admin.delete('/api/v1/licenses/alice/file').json()['file_url'] is None
    assert bucket == {}
    assert admin.delete('/api/v1/licenses/alice/file').status_code == 404


def test_upload_accepts_only_a_pdf(admin: TestClient, bucket: dict[str, bytes]) -> None:
    setup(admin)
    assert upload(admin, 'alice', b'not a pdf').status_code == 415
    assert upload(admin, 'alice', PDF, 'image/png').status_code == 415
    assert upload(admin, 'alice', PDF + b'0' * (10 * 1024 * 1024)).status_code == 413
    assert upload(admin, 'nobody').status_code == 404
    assert bucket == {}


def test_missing_bucket_is_explained(admin: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    setup(admin)
    error = '<?xml version="1.0"?><Error><Code>NoSuchBucket</Code><Message>missing</Message></Error>'
    monkeypatch.setattr(s3, 'transport', httpx.MockTransport(lambda request: httpx.Response(404, text=error)))
    monkeypatch.setattr(settings, 's3_bucket', 'lsoc-licences')
    response = upload(admin, 'alice')
    assert (response.status_code, response.json()['detail']) == (502, 'Bucket « lsoc-licences » introuvable dans le stockage')
    assert record(License, user_id='alice').file_key is None


def test_upload_without_storage_is_unavailable(admin: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    setup(admin)
    monkeypatch.setattr(settings, 's3_bucket', '')
    assert upload(admin, 'alice').status_code == 503


def test_public_url_can_point_to_a_local_s3(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, 's3_bucket', 'lsoc-licences')
    monkeypatch.setattr(settings, 's3_endpoint_url', 'http://s3mock:9090')
    assert s3.object_url('licences/abc') == 'http://s3mock:9090/lsoc-licences/licences/abc'
    assert s3.public_url('licences/abc') == 'http://s3mock:9090/lsoc-licences/licences/abc'
    monkeypatch.setattr(settings, 's3_public_url', 'http://localhost:9090/lsoc-licences/')
    assert s3.public_url('licences/abc') == 'http://localhost:9090/lsoc-licences/licences/abc'


def test_coach_reads_only_the_licenses_of_his_teams(admin: TestClient, bucket: dict[str, bytes]) -> None:
    loisir, competition, team_l, team_c = setup(admin)
    assert upload(admin, 'bob').status_code == 200
    assert upload(admin, 'alice').status_code == 200
    # Carla coache la Régionale : elle voit Bob et elle-même, pas Alice (Loisir 1).
    carla = login('carla')
    assert [item['user_id'] for item in carla.get('/api/v1/licenses').json()] == ['bob', 'carla']
    assert row(carla, 'bob')['file_url'] == row(admin, 'bob')['file_url']
    assert carla.get(f'/api/v1/licenses?team_id={team_l}').json() == []
    assert carla.get(f'/api/v1/licenses?section_id={loisir}').json() == []
    assert [item['user_id'] for item in carla.get('/api/v1/licenses?kind=coach').json()] == ['carla']
    # Lecture seule.
    assert upload(carla, 'bob').status_code == 403
    assert carla.delete('/api/v1/licenses/bob/file').status_code == 403
    assert carla.put('/api/v1/licenses/bob', json={'status': 'active', 'number': 'bob'}).status_code == 403
    # Le référent d’une équipe la voit aussi, sans y être rattaché comme coach.
    add_user('dave', ['member', 'coach'])
    assert admin.put(f'/api/v1/teams/{team_l}', json={'name': 'Loisir 1', 'section_id': loisir, 'referent_id': 'dave'}).status_code == 200
    assert [item['user_id'] for item in login('dave').get('/api/v1/licenses').json()] == ['alice']
    # Un adhérent n’y a pas accès.
    assert login('alice').get('/api/v1/licenses').status_code == 403


def test_erasure_and_new_season_delete_the_pdf(admin: TestClient, bucket: dict[str, bytes]) -> None:
    setup(admin)
    assert upload(admin, 'alice').status_code == 200
    assert upload(admin, 'bob').status_code == 200
    assert admin.delete('/api/v1/users/alice').status_code == 204
    assert list(bucket) == [record(License, user_id='bob').file_key]
    with SessionFactory.begin() as db:
        reset_licenses(db, datetime(2026, 9, 1, tzinfo=UTC))
        assert reset_licenses(db, datetime(2027, 8, 1, 12, tzinfo=UTC))
    assert bucket == {}
    assert record(License, user_id='bob').file_key is None


def test_users_can_be_filtered_by_their_assignments(admin: TestClient) -> None:
    loisir, competition, team_l, team_c = setup(admin)
    every = admin.get('/api/v1/assignments').json()
    assert sorted((item['user_id'], item['team_id'], item['kind']) for item in every) == [
        ('alice', team_l, 'player'),
        ('bob', team_c, 'player'),
        ('carla', team_c, 'coach'),
    ]
    assert login('alice').get('/api/v1/assignments').status_code == 403


def test_coach_reads_only_the_users_of_his_teams(admin: TestClient) -> None:
    loisir, competition, team_l, team_c = setup(admin)
    carla = login('carla')
    # Carla coache la Régionale : Bob (joueur) et elle-même, pas Alice ni l’admin.
    assert [item['id'] for item in carla.get('/api/v1/users').json()] == ['bob', 'carla']
    assert sorted((item['user_id'], item['team_id']) for item in carla.get('/api/v1/assignments').json()) == [('bob', team_c), ('carla', team_c)]
    # Lecture seule.
    assert carla.post('/api/v1/users', json={'first_name': 'Eve', 'last_name': 'X', 'category': 'adult', 'roles': ['member']}).status_code == 403
    assert carla.delete('/api/v1/users/bob').status_code == 403
    assert carla.post('/api/v1/users/bob/assignments', json={'team_id': team_l, 'kind': 'player'}).status_code == 403
    assert len(admin.get('/api/v1/users').json()) == 4


def test_body_is_not_read_before_authorization(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    from app.api import licenses

    read: list[bool] = []
    original = licenses.pdf_body

    async def spy(request):  # type: ignore[no-untyped-def]
        read.append(True)
        return await original(request)

    monkeypatch.setattr(licenses, 'pdf_body', spy)
    assert upload(client, 'admin').status_code == 401
    assert read == []
