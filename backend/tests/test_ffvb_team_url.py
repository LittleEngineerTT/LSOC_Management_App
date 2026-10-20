from pathlib import Path

import httpx
import pytest
from bs4 import BeautifulSoup
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.api import ffvb
from app.integrations.ffvb import parse_calendar
from app.persistence.database import SessionFactory
from app.persistence.models import Event, FFVBMatchState, FFVBSource
from test_events import setup_planning

HTML = (Path(__file__).parent / 'fixtures/ffvb-liidf-2mc.html').read_bytes()
TEAM_URL = 'https://www.ffvbbeach.org/ffvbapp/resu/vbspo_calendrier.php?saison=2026%2F2027&codent=LIIDF&poule=2MC&calend=COMPLET&equipe=9&x=6&y=9'


def test_team_url_with_encoded_season_and_extra_parameters_selects_the_team(admin: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(ffvb, 'fetch', lambda *args: HTML)
    admin.put('/api/v1/ffvb/club', json={'club_code': '0926620'})
    section = admin.post('/api/v1/sections', json={'name': 'Régionale'}).json()['id']
    team = admin.post('/api/v1/teams', json={'name': 'LSO COLOMBES 1', 'section_id': section, 'referent_ids': ['admin']}).json()['id']
    result = admin.post('/api/v1/ffvb/sources/preview', json={'url': TEAM_URL})
    assert result.status_code == 200, result.text
    body = result.json()
    assert (body['season'], body['entity'], body['pool'], body['warning']) == ('2026/2027', 'LIIDF', '2MC', None)
    # Le nom vient du classement, pas du rang ni des ratios voisins.
    assert body['candidates'] == [{'team_name': 'LSO COLOMBES 1', 'team_number': '9', 'team_id': team}]


def test_lettered_match_codes_and_played_matches_without_venue() -> None:
    matches = {match.code: match for match in parse_calendar(HTML, '2026/2027', 'LIIDF', '2MC', 'LSO COLOMBES 1')}
    assert len(matches) == 18
    # Match joué : la colonne du lieu porte le score, le lieu reste inconnu.
    assert matches['2MCA010'].location is None
    assert matches['2MCA022'].location == 'GYMNASE AMBROISE PARÉ'


def test_sync_skips_unknown_played_matches_and_keeps_known_venues(admin: TestClient) -> None:
    section, gym = setup_planning(admin)
    team = admin.post('/api/v1/teams', json={'name': 'LSO COLOMBES 1', 'section_id': section, 'referent_ids': ['admin']}).json()['id']
    source = admin.post('/api/v1/ffvb/sources', json={'team_id': team, 'season': '2026/2027', 'entity': 'LIIDF', 'pool': '2MC', 'team_number': '9', 'team_name': 'LSO COLOMBES 1', 'club_code': '0926620'})
    assert source.status_code == 201, source.text
    assert admin.post('/api/v1/ffvb/gym-mappings', json={'official_name': 'GYMNASE AMBROISE PARÉ', 'gymnasium_id': gym}).status_code == 201
    # Avant résultat, le match 2MCA022 affiche son lieu ; ensuite, son score.
    soup = BeautifulSoup(HTML, 'html.parser')
    row = next(tr for tr in soup.find_all('tr') if (td := tr.find('td', recursive=False)) and td.get_text(strip=True) == '2MCA022')
    cells = row.find_all('td')
    for index, value in ((6, '3'), (7, '1'), (8, '25:20, 25:18, 22:25, 25:21')):
        cells[index].string = value
    played = str(soup).encode()
    from app.services.ffvb import sync_source

    def sync(html: bytes) -> None:
        with httpx.Client(transport=httpx.MockTransport(lambda request: httpx.Response(200, content=html))) as client:
            with SessionFactory.begin() as db:
                value = db.get(FFVBSource, source.json()['id'])
                assert value is not None
                sync_source(db, value, client)

    sync(HTML)
    with SessionFactory() as db:
        codes = set(db.scalars(select(FFVBMatchState.match_code)))
        assert '2MCA010' not in codes and '2MCA022' in codes
        event = db.scalar(select(Event).join(FFVBMatchState, FFVBMatchState.id == Event.ffvb_match_id).where(FFVBMatchState.match_code == '2MCA022'))
        assert event is not None and event.gymnasium_id == gym and event.location == 'GYMNASE AMBROISE PARÉ'
        version = event.version
    sync(played)
    with SessionFactory() as db:
        after = db.get(Event, event.id)
        assert after is not None
        assert (after.gymnasium_id, after.location, after.version) == (gym, 'GYMNASE AMBROISE PARÉ', version)
