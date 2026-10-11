from conftest import add_user, login
from fastapi.testclient import TestClient
from test_events import payload, setup_planning

BLOCK = {'title': 'Travaux', 'starts_at': '2026-10-15T17:00:00+02:00', 'ends_at': '2026-10-15T22:00:00+02:00'}


def kinds(client: TestClient) -> list[str]:
    return [n['kind'] for n in client.get('/api/v1/notifications').json()]


def test_unavailability_cancels_silently_and_notifies_team_registered_and_referent(admin: TestClient) -> None:
    section, gym = setup_planning(admin, capacity=3)
    team = admin.post('/api/v1/teams', json={'name': 'Loisir 1', 'section_id': section}).json()['id']
    for name in ('player', 'registered', 'referent', 'outsider'):
        add_user(name)
    assert admin.post('/api/v1/users/player/assignments', json={'team_id': team, 'kind': 'player'}).status_code == 201
    # Inscrit par sa section, sans appartenir à l’équipe organisatrice.
    other = admin.post('/api/v1/teams', json={'name': 'Loisir 2', 'section_id': section}).json()['id']
    assert admin.post('/api/v1/users/registered/assignments', json={'team_id': other, 'kind': 'player'}).status_code == 201
    body = payload(section, gym, courts=2, referent='referent') | {'team_ids': [team], 'registration_section_ids': [section], 'registration_limit': 10}
    event = admin.post('/api/v1/events', json=body).json()
    assert login('registered').post(f"/api/v1/events/{event['id']}/registration").status_code == 201
    # Une indisponibilité partielle qui laisse assez de terrains ne change rien.
    small = admin.post('/api/v1/availability-blocks', json=BLOCK | {'gymnasium_id': gym, 'courts': 1})
    assert small.status_code == 201
    assert admin.get(f"/api/v1/events/{event['id']}").json()['cancelled'] is False
    # Sans assez de terrains, l’événement est annulé sans erreur.
    assert admin.put(f"/api/v1/availability-blocks/{small.json()['id']}", json=BLOCK | {'gymnasium_id': gym, 'courts': 2}).status_code == 200
    assert admin.get(f"/api/v1/events/{event['id']}").json()['cancelled'] is True
    for name in ('player', 'registered', 'referent'):
        assert 'event_cancelled' in kinds(login(name)), name
    assert 'event_cancelled' not in kinds(login('outsider'))
    history = admin.get(f"/api/v1/events/{event['id']}/history").json()
    assert history[-1]['action'] == 'unavailability_cancel'


def test_event_created_on_unavailability_is_cancelled_instead_of_refused(admin: TestClient) -> None:
    section, gym = setup_planning(admin, capacity=3)
    assert admin.post('/api/v1/availability-blocks', json=BLOCK | {'gymnasium_id': gym, 'courts': 3}).status_code == 201
    created = admin.post('/api/v1/events', json=payload(section, gym))
    assert created.status_code == 201, created.text
    assert created.json()['cancelled'] is True
    # Un conflit entre événements seuls reste refusé sans forçage.
    other_day = payload(section, gym, start='2026-10-16T18:00:00+02:00', end='2026-10-16T20:00:00+02:00', courts=2)
    assert admin.post('/api/v1/events', json=other_day).status_code == 201
    assert admin.post('/api/v1/events', json=other_day).status_code == 409
