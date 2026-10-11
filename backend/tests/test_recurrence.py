from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app.persistence.database import SessionFactory
from app.persistence.models import EventRevision, EventSeries
from conftest import add_user, login
from test_events import payload, setup_planning
from test_ffvb import configure, match_event, sync

# Mardi 13 octobre 2026, 20 h – 22 h (heure de Paris).
TUESDAY = payload('', None, start='2026-10-13T20:00:00+02:00', end='2026-10-13T22:00:00+02:00', courts=0)


def series(admin: TestClient, section: str, until: str, weekdays: list[int] | None) -> list[dict[str, object]]:
    body: dict[str, object] = {'event': TUESDAY | {'section_ids': [section]}, 'until': until}
    if weekdays is not None:
        body['weekdays'] = weekdays
    response = admin.post('/api/v1/series', json=body)
    assert response.status_code == 201, response.text
    return list(response.json())


def test_series_on_several_weekdays_keeps_local_time_across_dst(admin: TestClient) -> None:
    section, _ = setup_planning(admin)
    events = series(admin, section, '2026-11-05', [1, 3])
    days = [(str(e['starts_at'])[:10], str(e['starts_at'])[11:16]) for e in events]
    # Mardis et jeudis, 20 h à Paris : 18 h UTC en été, 19 h UTC après le 25 octobre.
    assert days == [('2026-10-13', '18:00'), ('2026-10-15', '18:00'), ('2026-10-20', '18:00'), ('2026-10-22', '18:00'),
                    ('2026-10-27', '19:00'), ('2026-10-29', '19:00'), ('2026-11-03', '19:00'), ('2026-11-05', '19:00')]
    assert len({e['series_id'] for e in events}) == 1
    # Sans jours précisés : le jour du premier événement, comme avant.
    assert len(series(admin, section, '2026-10-27', None)) == 3
    assert admin.post('/api/v1/series', json={'event': TUESDAY | {'section_ids': [section]}, 'until': '2026-10-27', 'weekdays': [1, 1]}).status_code == 422
    assert admin.post('/api/v1/series', json={'event': TUESDAY | {'section_ids': [section]}, 'until': '2026-10-14', 'weekdays': [0]}).status_code == 422


def test_delete_one_occurrence_or_the_following_ones(admin: TestClient) -> None:
    section, _ = setup_planning(admin)
    events = series(admin, section, '2026-11-03', None)
    assert len(events) == 4
    add_user()
    member = login()
    assert member.post(f"/api/v1/series/{events[0]['series_id']}/follow").status_code == 201
    assert member.post(f"/api/v1/events/{events[1]['id']}/questions", json={'body': 'Maintenu ?'}).status_code == 201
    assert member.delete(f"/api/v1/events/{events[1]['id']}").status_code == 403
    assert admin.delete(f"/api/v1/events/{events[1]['id']}").status_code == 204
    assert admin.get(f"/api/v1/events/{events[1]['id']}").status_code == 404
    titles = [n['title'] for n in member.get('/api/v1/notifications').json()]
    assert 'Événement supprimé : Entraînement du 20/10/2026' in titles
    remaining = admin.get('/api/v1/events', params={'series_id': events[0]['series_id']}).json()
    assert [e['id'] for e in remaining] == [events[0]['id'], events[2]['id'], events[3]['id']]
    assert admin.delete(f"/api/v1/events/{events[2]['id']}?scope=following").status_code == 204
    assert [e['id'] for e in admin.get('/api/v1/events', params={'series_id': events[0]['series_id']}).json()] == [events[0]['id']]
    assert admin.delete(f"/api/v1/events/{events[0]['id']}?scope=following").status_code == 204
    with SessionFactory() as db:
        assert db.scalar(select(func.count()).select_from(EventSeries)) == 0
        assert db.scalar(select(func.count()).select_from(EventRevision)) == 0
    single = admin.post('/api/v1/events', json=payload(section, None, courts=0)).json()['id']
    assert admin.delete(f'/api/v1/events/{single}?scope=following').status_code == 422


def test_ffvb_matches_cannot_be_deleted_individually(admin: TestClient) -> None:
    source, _, _ = configure(admin)
    sync(source)
    assert admin.delete(f"/api/v1/events/{match_event('BRC007').id}").status_code == 409
