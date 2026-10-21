from conftest import add_user, login
from fastapi.testclient import TestClient
from test_events import payload as base_payload, setup_planning
from test_registrations import ask, position


def payload(*args, **kwargs):  # type: ignore[no-untyped-def]
    # Date fixe dans le futur : une séance passée refuse les inscriptions.
    kwargs.setdefault('start', '2099-10-15T18:00:00+02:00')
    kwargs.setdefault('end', '2099-10-15T20:00:00+02:00')
    return base_payload(*args, **kwargs)

BLOCK = {'title': 'Travaux', 'starts_at': '2099-10-15T17:00:00+02:00', 'ends_at': '2099-10-15T22:00:00+02:00'}


def kinds(client: TestClient) -> list[str]:
    return [n['kind'] for n in client.get('/api/v1/notifications').json()]


def test_unavailability_cancels_silently_and_notifies_team_registered_and_referent(admin: TestClient) -> None:
    section, gym = setup_planning(admin, capacity=3)
    team = admin.post('/api/v1/teams', json={'name': 'Loisir 1', 'section_id': section}).json()['id']
    for name in ('player', 'registered', 'referent', 'outsider'):
        add_user(name, ['member', 'coach'] if name == 'referent' else None)
    assert admin.post('/api/v1/users/player/assignments', json={'team_id': team, 'kind': 'player'}).status_code == 201
    # Inscrit par sa section, sans appartenir à l’équipe organisatrice.
    other = admin.post('/api/v1/teams', json={'name': 'Loisir 2', 'section_id': section}).json()['id']
    assert admin.post('/api/v1/users/registered/assignments', json={'team_id': other, 'kind': 'player'}).status_code == 201
    body = payload(section, gym, courts=2, referent='referent') | {'team_ids': [team], 'registration_section_ids': [section], 'registration_limit': 10}
    event = admin.post('/api/v1/events', json=body).json()
    # Une demande en attente suffit pour être prévenu.
    assert ask(login('registered'), event['id'], position(admin)).status_code == 201
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
    other_day = payload(section, gym, start='2099-10-16T18:00:00+02:00', end='2099-10-16T20:00:00+02:00', courts=2)
    assert admin.post('/api/v1/events', json=other_day).status_code == 201
    assert admin.post('/api/v1/events', json=other_day).status_code == 409


def coach_request(admin: TestClient, capacity: int) -> tuple[TestClient, str, dict[str, object]]:
    section, gym = setup_planning(admin, capacity=capacity)
    team = admin.post('/api/v1/teams', json={'name': 'Loisir 1', 'section_id': section}).json()['id']
    add_user('coach', ['coach'])
    assert admin.post('/api/v1/users/coach/assignments', json={'team_id': team, 'kind': 'coach'}).status_code == 201
    body: dict[str, object] = {'team_id': team, 'title': 'Séance', 'kind': 'training', 'starts_at': '2099-10-15T18:00:00+02:00', 'ends_at': '2099-10-15T20:00:00+02:00', 'gymnasium_id': gym, 'courts': 2}
    return login('coach'), gym, body | {'section': section}


def test_request_on_a_full_gym_is_refused_to_its_author(admin: TestClient) -> None:
    coach, gym, body = coach_request(admin, capacity=2)
    section = str(body.pop('section'))
    assert admin.post('/api/v1/events', json=payload(section, gym, courts=2)).status_code == 201
    refused = coach.post('/api/v1/event-requests', json=body)
    assert refused.status_code == 409
    assert refused.json()['detail']['code'] == 'no_courts'
    assert '15/10/2099 à 18:00' in refused.json()['detail']['message']


def test_request_on_unavailability_only_warns_the_admin(admin: TestClient) -> None:
    coach, gym, body = coach_request(admin, capacity=3)
    body.pop('section')
    assert admin.post('/api/v1/availability-blocks', json=BLOCK | {'gymnasium_id': gym, 'courts': 3}).status_code == 201
    request = coach.post('/api/v1/event-requests', json=body)
    assert request.status_code == 201, request.text
    pending = admin.get('/api/v1/event-requests').json()[0]
    assert pending['unavailability'] == ['15/10/2099 : Travaux']
    accepted = admin.post(f"/api/v1/event-requests/{pending['id']}/decision", json={'accept': True})
    assert accepted.status_code == 200, accepted.text
    assert admin.get(f"/api/v1/events/{accepted.json()['event_id']}").json()['cancelled'] is True


def test_partial_overbooking_still_asks_the_admin_to_force(admin: TestClient) -> None:
    coach, gym, body = coach_request(admin, capacity=3)
    section = str(body.pop('section'))
    assert admin.post('/api/v1/events', json=payload(section, gym, courts=2)).status_code == 201
    request = coach.post('/api/v1/event-requests', json=body)
    assert request.status_code == 201, request.text
    assert request.json()['unavailability'] == []
    decision = f"/api/v1/event-requests/{request.json()['id']}/decision"
    assert admin.post(decision, json={'accept': True}).status_code == 409
    assert admin.post(decision, json={'accept': True, 'force': True}).status_code == 200
