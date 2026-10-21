from conftest import add_user, login, set_referents

from app.persistence.models import Event
from fastapi.testclient import TestClient
from test_events import payload, setup_planning


def test_referent_coach_deletes_own_event_and_admins_are_told(admin: TestClient) -> None:
    section, gym = setup_planning(admin)
    add_user('coach', ['coach'])
    add_user('other', ['coach'])
    add_user('referent', ['member'])
    own = admin.post('/api/v1/events', json=payload(section, gym, referent='coach')).json()['id']
    # Un compte sans rôle coach ne peut plus être désigné référent…
    body = payload(section, gym, start='2026-10-16T18:00:00+02:00', end='2026-10-16T20:00:00+02:00', referent='referent')
    assert admin.post('/api/v1/events', json=body).status_code == 422
    # … mais un référent déjà en place le reste.
    foreign = admin.post('/api/v1/events', json=body | {'referent_ids': ['admin']}).json()['id']
    set_referents(Event, foreign, ['referent'])
    assert login('other').delete(f'/api/v1/events/{own}').status_code == 403
    # Référent sans rôle coach : la suppression reste réservée.
    assert login('referent').delete(f'/api/v1/events/{foreign}').status_code == 403
    assert login('coach').delete(f'/api/v1/events/{own}').status_code == 204
    assert admin.get(f'/api/v1/events/{own}').status_code == 404
    titles = [n['title'] for n in admin.get('/api/v1/notifications').json()]
    assert 'Événement supprimé par coach : Entraînement du 15/10/2026' in titles


def test_coach_deletes_following_occurrences_only_if_referent_of_each(admin: TestClient) -> None:
    section, gym = setup_planning(admin)
    add_user('coach', ['coach'])
    body = payload(section, gym, referent='coach')
    events = admin.post('/api/v1/series', json={'event': body, 'until': '2026-10-29'}).json()
    assert len(events) == 3
    taken = admin.patch(f"/api/v1/events/{events[2]['id']}", json={'base_version': 1, 'changes': {'referent_ids': ['admin']}})
    assert taken.status_code == 200
    coach = login('coach')
    assert coach.delete(f"/api/v1/events/{events[0]['id']}", params={'scope': 'following'}).status_code == 403
    assert coach.delete(f"/api/v1/events/{events[1]['id']}").status_code == 204
    assert [e['id'] for e in admin.get('/api/v1/events', params={'series_id': events[0]['series_id']}).json()] == [events[0]['id'], events[2]['id']]
