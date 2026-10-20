from collections.abc import Iterator

import httpx
import pytest
from conftest import add_user, login
from fastapi.testclient import TestClient

from app.core.config import settings
from app.integrations import s3

PDF = b'%PDF-1.7\ncertificat\n%%EOF\n'
PNG = b'\x89PNG\r\n\x1a\nqr-code'


@pytest.fixture
def bucket(monkeypatch: pytest.MonkeyPatch) -> Iterator[dict[str, bytes]]:
    """S3 simulé : un dictionnaire clé → contenu tel qu’il est réellement stocké."""
    objects: dict[str, bytes] = {}

    def handle(request: httpx.Request) -> httpx.Response:
        key = request.url.path.lstrip('/')
        if request.method == 'PUT':
            objects[key] = request.content
            return httpx.Response(200)
        if request.method == 'GET':
            return httpx.Response(200, content=objects[key]) if key in objects else httpx.Response(404, text='<Code>NoSuchKey</Code>')
        if request.method == 'DELETE':
            objects.pop(key, None)
            return httpx.Response(204)
        return httpx.Response(405)

    monkeypatch.setattr(s3, 'transport', httpx.MockTransport(handle))
    for name, value in (('s3_bucket', 'lsoc-licences'), ('s3_region', 'eu-west-3'), ('s3_endpoint_url', ''), ('s3_access_key', 'test-key'), ('s3_secret_key', 'test-secret'), ('s3_public_url', '')):
        monkeypatch.setattr(settings, name, value)
    yield objects


def club(admin: TestClient) -> None:
    """Un coach de l’équipe Loisir, un joueur de cette équipe et un joueur d’une autre équipe."""
    section = admin.post('/api/v1/sections', json={'name': 'Loisir'}).json()['id']
    loisir = admin.post('/api/v1/teams', json={'name': 'Loisir 1', 'section_id': section}).json()['id']
    other = admin.post('/api/v1/teams', json={'name': 'Loisir 2', 'section_id': section}).json()['id']
    add_user('coach', ['member', 'coach'])
    for user in ('player', 'stranger'):
        add_user(user)
    for user, team, kind in (('coach', loisir, 'coach'), ('player', loisir, 'player'), ('stranger', other, 'player')):
        assert admin.post(f'/api/v1/users/{user}/assignments', json={'team_id': team, 'kind': kind}).status_code == 201


def upload(client: TestClient, dossier: str, kind: str, body: bytes = PDF, content_type: str = 'application/pdf', name: str = 'certificat%20m%C3%A9dical.pdf') -> httpx.Response:
    return client.put(f'/api/v1/dossiers/{dossier}/documents/{kind}/file', content=body, headers={'Content-Type': content_type, 'X-File-Name': name})


def test_coach_requests_documents_only_for_players_of_his_teams(admin: TestClient) -> None:
    club(admin)
    coach, player = login('coach'), login('player')
    request = {'user_id': 'player', 'documents': ['medical_certificate', 'identity'], 'note': 'Avant le 1er septembre'}
    assert player.post('/api/v1/dossiers', json=request).status_code == 403
    assert coach.post('/api/v1/dossiers', json=request | {'user_id': 'stranger'}).status_code == 403
    assert coach.post('/api/v1/dossiers', json={'user_id': 'player'}).status_code == 422
    assert player.get('/api/v1/dossiers/me').json() is None
    opened = coach.post('/api/v1/dossiers', json=request)
    assert opened.status_code == 201, opened.text
    dossier = opened.json()
    assert [(d['kind'], d['status']) for d in dossier['documents']] == [('identity', 'requested'), ('medical_certificate', 'requested')]
    assert dossier['payment_requested'] is False
    assert coach.post('/api/v1/dossiers', json=request).status_code == 409
    alert = player.get('/api/v1/notifications').json()[0]
    assert (alert['kind'], alert['link']) == ('dossier', '/app/inscriptions')
    assert alert['body'] == '- Certificat médical\n- Carte d’identité ou passeport\n\nAvant le 1er septembre'
    assert player.get('/api/v1/dossiers/me').json()['id'] == dossier['id']
    assert [d['user_id'] for d in coach.get('/api/v1/dossiers').json()] == ['player']
    assert player.get('/api/v1/dossiers').status_code == 403
    # Des étapes s’ajoutent tant que le dossier est ouvert.
    added = coach.patch(f"/api/v1/dossiers/{dossier['id']}", json={'documents': ['identity', 'reduction_proof'], 'payment': True})
    assert added.status_code == 200, added.text
    assert [d['kind'] for d in added.json()['documents']] == ['identity', 'medical_certificate', 'reduction_proof']
    assert added.json()['payment_requested'] is True
    assert coach.patch(f"/api/v1/dossiers/{dossier['id']}", json={'documents': ['identity']}).status_code == 422


def test_player_uploads_encrypted_files_that_only_admins_open(admin: TestClient, bucket: dict[str, bytes]) -> None:
    club(admin)
    coach, player = login('coach'), login('player')
    dossier = coach.post('/api/v1/dossiers', json={'user_id': 'player', 'documents': ['medical_certificate', 'reduction_proof'], 'payment': True}).json()['id']
    assert upload(player, dossier, 'medical_certificate', b'not a pdf').status_code == 415
    assert upload(player, dossier, 'medical_certificate', PDF, 'text/plain').status_code == 415
    assert upload(player, dossier, 'identity').status_code == 404
    assert upload(login('stranger'), dossier, 'medical_certificate').status_code == 403
    sent = upload(player, dossier, 'medical_certificate')
    assert sent.status_code == 200, sent.text
    certificate = next(d for d in sent.json()['documents'] if d['kind'] == 'medical_certificate')
    assert (certificate['status'], certificate['file_name'], certificate['has_file']) == ('submitted', 'certificat médical.pdf', True)
    # Le stockage ne contient que du chiffré.
    [stored] = bucket.values()
    assert PDF not in stored and b'certificat' not in stored
    assert 'Pièce déposée par player : Certificat médical' in [n['title'] for n in coach.get('/api/v1/notifications').json()]
    assert coach.get(f'/api/v1/dossiers/{dossier}/documents/medical_certificate/file').status_code == 403
    assert coach.post(f'/api/v1/dossiers/{dossier}/documents/medical_certificate/decision', json={'accept': True}).status_code == 403
    downloaded = admin.get(f'/api/v1/dossiers/{dossier}/documents/medical_certificate/file')
    assert downloaded.status_code == 200
    assert downloaded.content == PDF
    assert downloaded.headers['content-type'] == 'application/pdf'
    assert downloaded.headers['cache-control'] == 'no-store'
    assert player.get(f'/api/v1/dossiers/{dossier}/documents/medical_certificate/file').content == PDF
    rejected = admin.post(f'/api/v1/dossiers/{dossier}/documents/medical_certificate/decision', json={'accept': False, 'reason': 'Certificat illisible'})
    assert rejected.status_code == 200
    assert player.get('/api/v1/notifications').json()[0]['title'] == 'Certificat médical : à déposer de nouveau'
    assert upload(player, dossier, 'medical_certificate').status_code == 200
    assert len(bucket) == 1
    assert admin.post(f'/api/v1/dossiers/{dossier}/documents/medical_certificate/decision', json={'accept': True}).status_code == 200
    assert upload(player, dossier, 'medical_certificate').status_code == 409
    assert upload(player, dossier, 'reduction_proof', PNG, 'image/png', 'qr.png').status_code == 200
    assert coach.post(f'/api/v1/dossiers/{dossier}/payment').status_code == 403
    paid = admin.post(f'/api/v1/dossiers/{dossier}/payment').json()
    assert paid['payment_validated_at'] is not None
    # La clôture efface les fichiers et ferme l’application au joueur.
    closed = coach.post(f'/api/v1/dossiers/{dossier}/close')
    assert closed.status_code == 200, closed.text
    assert bucket == {}
    assert [(d['status'], d['has_file']) for d in closed.json()['documents']] == [('validated', False), ('submitted', False)]
    assert player.get('/api/v1/dossiers/me').json() is None
    assert upload(player, dossier, 'reduction_proof', PNG, 'image/png').status_code == 409
    assert admin.get(f'/api/v1/dossiers/{dossier}/documents/medical_certificate/file').status_code == 404
    assert [d['id'] for d in admin.get('/api/v1/dossiers?state=closed').json()] == [dossier]
    # Un nouveau dossier peut ensuite être ouvert.
    assert admin.post('/api/v1/dossiers', json={'user_id': 'player', 'payment': True}).status_code == 201


def test_account_erasure_removes_dossier_files(admin: TestClient, bucket: dict[str, bytes]) -> None:
    club(admin)
    player = login('player')
    dossier = admin.post('/api/v1/dossiers', json={'user_id': 'player', 'documents': ['identity']}).json()['id']
    assert upload(player, dossier, 'identity').status_code == 200
    assert len(bucket) == 1
    assert admin.delete('/api/v1/users/player').status_code == 204
    assert bucket == {}
