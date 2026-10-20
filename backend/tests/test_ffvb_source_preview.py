from pathlib import Path

import pytest
import httpx
from fastapi.testclient import TestClient

from app.api import ffvb

URL = 'https://www.ffvbbeach.org/ffvbapp/resu/vbspo_calendrier.php?saison=2026/2027&codent=PTIDF92&poule=BRC'


def test_preview_detects_club_team_from_calendar(admin: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    html = (Path(__file__).parent / 'fixtures/ffvb-original.html').read_bytes()
    monkeypatch.setattr(ffvb, 'fetch', lambda *args: html)
    admin.put('/api/v1/ffvb/club', json={'club_code': '0926620'})
    section = admin.post('/api/v1/sections', json={'name': 'Compétition'}).json()['id']
    team = admin.post('/api/v1/teams', json={'name': 'LSO COLOMBES', 'section_id': section, 'referent_ids': ['admin']}).json()['id']
    result = admin.post('/api/v1/ffvb/sources/preview', json={'url': URL})
    assert result.status_code == 200, result.text
    body = result.json()
    assert (body['season'], body['entity'], body['pool']) == ('2026/2027', 'PTIDF92', 'BRC')
    assert body['candidates'] == [{'team_name': 'LSO COLOMBES', 'team_number': '6', 'team_id': team}]
    assert body['warning'] is None
    assert admin.get('/api/v1/ffvb/sources').json() == []


@pytest.mark.parametrize('url', [
    'http://localhost:8000/api/v1/users',
    'https://www.ffvbbeach.org.evil.example/ffvbapp/resu/vbspo_calendrier.php?saison=2026/2027&codent=PTIDF92&poule=BRC',
    URL + '&poule=OTHER',
    URL.replace('vbspo_calendrier.php', '../private.php'),
])
def test_preview_rejects_unsafe_or_ambiguous_urls(admin: TestClient, url: str) -> None:
    assert admin.post('/api/v1/ffvb/sources/preview', json={'url': url}).status_code == 422


def test_preview_network_failure_keeps_url_fields_for_manual_form(admin: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    admin.put('/api/v1/ffvb/club', json={'club_code': '0926620'})
    def offline(*args: object) -> bytes:
        raise httpx.ConnectError('Indisponible')
    monkeypatch.setattr(ffvb, 'fetch', offline)
    result = admin.post('/api/v1/ffvb/sources/preview', json={'url': URL})
    assert result.status_code == 200
    assert result.json()['pool'] == 'BRC'
    assert result.json()['candidates'] == []
    assert result.json()['warning']
