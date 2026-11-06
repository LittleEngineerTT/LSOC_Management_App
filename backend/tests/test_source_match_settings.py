from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient

from app.services import ffvb as ffvb_service
from test_ffvb import configure, match_event, sync

BODY = {'season': '2026/2027', 'entity': 'PTIDF92', 'pool': 'BRC', 'team_number': '6', 'team_name': 'LSO COLOMBES', 'club_code': '0926620'}


def source_body(admin: TestClient, source: str, **values: object) -> dict[str, object]:
    current = next(item for item in admin.get('/api/v1/ffvb/sources').json() if item['id'] == source)
    return {key: current[key] for key in ('team_id', *BODY, 'enabled', 'before_minutes', 'after_minutes', 'courts')} | {'interval_days': 1} | values


def test_imports_use_source_settings_or_club_defaults(admin: TestClient) -> None:
    source, _, gym = configure(admin)
    assert next(s for s in admin.get('/api/v1/ffvb/sources').json() if s['id'] == source)['courts'] is None
    assert admin.put('/api/v1/ffvb/defaults', json={'before_minutes': 60, 'after_minutes': 120, 'courts': 2}).status_code == 200
    updated = admin.put(f'/api/v1/ffvb/sources/{source}', json=source_body(admin, source, courts=1, before_minutes=30))
    assert updated.status_code == 200, updated.text
    sync(source)
    event = match_event('BRC007')
    # Réglages propres pour terrains et marge avant, défaut du club pour la marge après.
    assert (event.match_courts, event.courts, event.before_minutes, event.after_minutes) == (1, 1, 30, 120)
    assert event.kickoff_at is not None
    assert event.starts_at == event.kickoff_at - timedelta(minutes=30)


def test_changing_source_settings_updates_upcoming_matches_except_manual_values(admin: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    # Avant BRC007 (2 novembre 2026) : ses matchs restent à venir quel que soit le jour du test.
    monkeypatch.setattr(ffvb_service, 'now', lambda: datetime(2026, 10, 21, 12, tzinfo=UTC))
    source, _, gym = configure(admin)
    sync(source)
    edited = match_event('BRC007')
    other = match_event('BRC014')
    assert (other.before_minutes, other.after_minutes, other.match_courts) == (75, 150, 3)
    assert admin.patch(f'/api/v1/events/{edited.id}', json={'base_version': edited.version, 'changes': {'before_minutes': 45}}).status_code == 200
    response = admin.put(f'/api/v1/ffvb/sources/{source}', json=source_body(admin, source, before_minutes=90, after_minutes=180, courts=2))
    assert response.status_code == 200, response.text
    assert (response.json()['before_minutes'], response.json()['courts']) == (90, 2)
    moved = match_event('BRC014')
    assert (moved.before_minutes, moved.after_minutes, moved.match_courts) == (90, 180, 2)
    assert moved.kickoff_at is not None and moved.ends_at == moved.kickoff_at + timedelta(minutes=180)
    kept = match_event('BRC007')
    assert (kept.before_minutes, kept.after_minutes, kept.match_courts) == (45, 180, 2)
    history = admin.get(f'/api/v1/events/{moved.id}/history').json()[-1]
    assert history['action'] == 'source_settings'
    assert (history['before']['before_minutes'], history['after']['before_minutes']) == (75, 90)
    # Vider les réglages rend la source au défaut du club.
    reset = admin.put(f'/api/v1/ffvb/sources/{source}', json=source_body(admin, source, before_minutes=None, after_minutes=None, courts=None))
    assert reset.status_code == 200
    assert (match_event('BRC014').before_minutes, match_event('BRC014').match_courts) == (75, 3)


def test_source_settings_are_validated(admin: TestClient) -> None:
    source, _, _ = configure(admin)
    for values in ({'courts': -1}, {'courts': 101}, {'after_minutes': 0}, {'before_minutes': -1}):
        assert admin.put(f'/api/v1/ffvb/sources/{source}', json=source_body(admin, source, **values)).status_code == 422


def test_a_whole_gym_match_follows_the_gym_capacity_without_alert(admin: TestClient) -> None:
    source, _, gym = configure(admin)
    # Zéro terrain : le match prend tout le gymnase, quelle que soit sa capacité.
    assert admin.put(f'/api/v1/ffvb/sources/{source}', json=source_body(admin, source, courts=0)).status_code == 200
    assert admin.put('/api/v1/gymnasiums/' + gym, json={'name': 'Ambroise Paré', 'capacity': 2}).status_code == 200
    sync(source)
    event = match_event('BRC007')
    assert (event.match_courts, event.courts) == (0, 2)
    assert not any(item['kind'] == 'capacity_conflict' for item in admin.get('/api/v1/notifications').json())
    assert admin.put('/api/v1/gymnasiums/' + gym, json={'name': 'Ambroise Paré', 'capacity': 4}).status_code == 200
    grown = match_event('BRC007')
    assert (grown.courts, grown.version) == (4, event.version + 1)
    # Revenir à un nombre fixe de terrains, puis de nouveau à tout le gymnase.
    fixed = admin.patch(f'/api/v1/events/{event.id}', json={'base_version': grown.version, 'changes': {'match_courts': 1}})
    assert fixed.status_code == 200, fixed.text
    assert (fixed.json()['match_courts'], fixed.json()['courts']) == (1, 1)
    whole = admin.patch(f'/api/v1/events/{event.id}', json={'base_version': fixed.json()['version'], 'changes': {'match_courts': 0}})
    assert (whole.json()['match_courts'], whole.json()['courts']) == (0, 4)


def test_overlapping_ffvb_matches_are_a_capacity_conflict() -> None:
    from app.domain.capacity import capacity_segments

    start = datetime(2026, 11, 2, 18, tzinfo=UTC)
    end = start + timedelta(hours=3)
    segments = capacity_segments(2, start, end, [(start, end, 2), (start + timedelta(hours=1), end, 2)])
    assert [(s.occupied, s.excess) for s in segments] == [(2, 0), (4, 2)]


def test_a_match_exceeding_capacity_is_never_refused(admin: TestClient) -> None:
    source, section, gym = configure(admin)
    sync(source)
    event = match_event('BRC007')
    assert event.starts_at is not None
    training = admin.post('/api/v1/events', json={'title': 'Entraînement', 'kind': 'training', 'section_ids': [section], 'gymnasium_id': gym, 'starts_at': event.starts_at.isoformat(), 'ends_at': event.ends_at.isoformat(), 'courts': 1, 'referent_ids': ['admin']})
    # Le match occupe déjà tous les terrains : l’entraînement est refusé.
    assert training.status_code == 409
    assert admin.put('/api/v1/gymnasiums/' + gym, json={'name': 'Ambroise Paré', 'capacity': 4}).status_code == 200
    created = admin.post('/api/v1/events', json={'title': 'Entraînement', 'kind': 'training', 'section_ids': [section], 'gymnasium_id': gym, 'starts_at': event.starts_at.isoformat(), 'ends_at': event.ends_at.isoformat(), 'courts': 1, 'referent_ids': ['admin']})
    assert created.status_code == 201, created.text
    current = match_event('BRC007')
    # Le match grandit au-delà de la capacité restante : accepté sans confirmation.
    grown = admin.patch(f'/api/v1/events/{event.id}', json={'base_version': current.version, 'changes': {'match_courts': 4}})
    assert grown.status_code == 200, grown.text
    assert grown.json()['courts'] == 4
    assert not grown.json()['cancelled']
    assert any(item['kind'] == 'capacity_conflict' and 'Capacité dépassée' in item['title'] for item in admin.get('/api/v1/notifications').json())
