from datetime import UTC, datetime
from pathlib import Path

import pytest
from conftest import add_user, login
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from test_ffvb import configure, sync

from app.services import ffvb as ffvb_service
from app.integrations.ffvb import Result, parse_calendar
from app.persistence.database import SessionFactory
from app.persistence.models import FFVBResult

FIXTURES = Path(__file__).with_name('fixtures')
# Page du 21 octobre 2026 : BRC005 joué (défaite 3-1 à Meudon), les autres à venir.
PLAYED = FIXTURES.joinpath('ffvb-brc-resultats.html').read_bytes()


def test_parser_reads_sets_set_scores_and_points() -> None:
    matches = {m.code: m for m in parse_calendar(PLAYED, '2026/2027', 'PTIDF92', 'BRC', 'LSO COLOMBES')}
    assert matches['BRC005'].result == Result(3, 1, ('23:21', '21:8', '18:21', '21:9'), '83-59')
    assert matches['BRC005'].location is None
    assert matches['BRC007'].result is None
    tie_break = parse_calendar(FIXTURES.joinpath('ffvb-liidf-2mc.html').read_bytes(), '2026/2027', 'LIIDF', '2MC', 'LSO COLOMBES 1')
    assert {m.code: m.result for m in tie_break if m.result}['2MCA002'] == Result(2, 3, ('23:25', '28:30', '25:14', '25:19', '13:15'), '114-103')


def test_recent_results_of_each_source_with_its_section(admin: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(ffvb_service, 'now', lambda: datetime(2026, 10, 21, 12, tzinfo=UTC))
    source, section, _ = configure(admin)
    # Un match joué avant le premier import a quand même son résultat.
    sync(source, PLAYED)
    sync(source, PLAYED)
    with SessionFactory() as db:
        assert db.scalar(select(func.count()).select_from(FFVBResult)) == 1
    add_user()
    [item] = login().get('/api/v1/ffvb/results').json()
    assert (item['source_id'], item['team_name'], item['club_team'], item['section_id'], item['section_name'], item['pool']) == (source, 'LSO COLOMBES', 'LSO COLOMBES', section, 'Loisir', 'BRC')
    [result] = item['results']
    assert (result['match_code'], result['home_team'], result['away_team']) == ('BRC005', 'MEUDON CHAVILLE SEVRES VOLLEY 2', 'LSO COLOMBES')
    assert (result['home_sets'], result['away_sets'], result['set_scores'], result['points']) == (3, 1, ['23:21', '21:8', '18:21', '21:9'], '83-59')
    assert result['kickoff_at'] == '2026-10-15T18:50:00Z'
    # Hors de la fenêtre demandée : la source reste listée, sans résultat.
    assert admin.get('/api/v1/ffvb/results?days=3').json()[0]['results'] == []
    assert TestClient(admin.app).get('/api/v1/ffvb/results').status_code == 401
    # Les invités lisent les mêmes résultats, publiés par la FFVB.
    guest = TestClient(admin.app).get('/api/v1/public/ffvb/results')
    assert guest.status_code == 200
    assert guest.json()[0]['results'][0]['match_code'] == 'BRC005'
