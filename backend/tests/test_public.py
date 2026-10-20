from conftest import add_user, login
from fastapi.testclient import TestClient
from test_events import payload, setup_planning
from test_ffvb import configure, sync

from app.main import app


def test_guest_reads_only_ffvb_matches_without_internal_fields(admin: TestClient) -> None:
    source, section, gym = configure(admin)
    sync(source)
    local = admin.post('/api/v1/events', json=payload(section, gym)).json()['id']
    guest = TestClient(app)
    events = guest.get('/api/v1/public/events', params={'limit': 500})
    assert events.status_code == 200, events.text
    assert events.json() and all(e['ffvb_match_id'] for e in events.json())
    assert local not in {e['id'] for e in events.json()}
    assert not {'referent_ids', 'description', 'registration_count', 'courts'} & set(events.json()[0])
    match = events.json()[0]['id']
    assert guest.get(f'/api/v1/public/events/{match}').status_code == 200
    # Un événement local n’est pas plus visible par son identifiant.
    assert guest.get(f'/api/v1/public/events/{local}').status_code == 404
    assert guest.get('/api/v1/events').status_code == 401
    assert [g['name'] for g in guest.get('/api/v1/public/gymnasiums').json()] == ['Ambroise Paré']
    assert 'capacity' not in guest.get('/api/v1/public/gymnasiums').json()[0]
    assert [s['name'] for s in guest.get('/api/v1/public/sections').json()] == ['Loisir']


def test_guest_period_filter_and_cancelled_matches(admin: TestClient) -> None:
    source, _, _ = configure(admin)
    sync(source)
    guest = TestClient(app)
    every = guest.get('/api/v1/public/events', params={'limit': 500}).json()
    first = every[0]
    window = {'starts_at': first['starts_at'], 'ends_at': first['ends_at']}
    assert [e['id'] for e in guest.get('/api/v1/public/events', params=window).json()] == [first['id']]
    assert guest.get('/api/v1/public/events', params={'starts_at': first['ends_at'], 'ends_at': first['starts_at']}).status_code == 422
    assert admin.patch(f"/api/v1/events/{first['id']}", json={'base_version': admin.get(f"/api/v1/events/{first['id']}").json()['version'], 'changes': {'cancelled': True}, 'acknowledge_ffvb': True}).status_code == 200
    assert first['id'] not in {e['id'] for e in guest.get('/api/v1/public/events', params={'limit': 500}).json()}
    cancelled = guest.get('/api/v1/public/events', params={'limit': 500, 'include_cancelled': True}).json()
    assert next(e for e in cancelled if e['id'] == first['id'])['cancelled'] is True


def test_ffvb_match_belongs_to_its_source_team(admin: TestClient) -> None:
    source, section, gym = configure(admin)
    sync(source)
    team = admin.get('/api/v1/teams').json()[0]['id']
    guest = TestClient(app)
    match = guest.get('/api/v1/public/events', params={'limit': 500}).json()[0]
    assert match['team_ids'] == [team]
    assert admin.get(f"/api/v1/events/{match['id']}").json()['team_ids'] == [team]
    assert guest.get('/api/v1/public/teams').json() == [{'id': team, 'name': 'LSO COLOMBES', 'section_id': section}]


def test_admin_event_with_several_organizing_teams_adds_their_sections(admin: TestClient) -> None:
    section, gym = setup_planning(admin)
    other = admin.post('/api/v1/sections', json={'name': 'Compétition'}).json()['id']
    first = admin.post('/api/v1/teams', json={'name': 'Loisir 1', 'section_id': section}).json()['id']
    second = admin.post('/api/v1/teams', json={'name': 'Compét 1', 'section_id': other}).json()['id']
    body = payload(section, gym) | {'section_ids': [], 'team_ids': [first, second]}
    event = admin.post('/api/v1/events', json=body)
    assert event.status_code == 201, event.text
    assert event.json()['team_ids'] == [first, second]
    assert sorted(event.json()['section_ids']) == sorted([section, other])
    assert admin.post('/api/v1/events', json=body | {'team_ids': [first, first]}).status_code == 422
    assert admin.post('/api/v1/events', json=body | {'team_ids': []}).status_code == 422
    changed = admin.patch(f"/api/v1/events/{event.json()['id']}", json={'base_version': 1, 'changes': {'team_ids': [second]}})
    assert changed.status_code == 200 and changed.json()['team_ids'] == [second]
    # Supprimer une équipe la retire des organisatrices sans toucher à l’événement.
    assert admin.delete(f'/api/v1/teams/{second}').status_code == 204
    assert admin.get(f"/api/v1/events/{event.json()['id']}").json()['team_ids'] == []


def test_coach_request_with_several_coached_teams_applies_to_every_occurrence(admin: TestClient) -> None:
    section, _ = setup_planning(admin)
    first = admin.post('/api/v1/teams', json={'name': 'Loisir 1', 'section_id': section}).json()['id']
    second = admin.post('/api/v1/teams', json={'name': 'Loisir 2', 'section_id': section}).json()['id']
    stranger = admin.post('/api/v1/teams', json={'name': 'Loisir 3', 'section_id': section}).json()['id']
    add_user('coach', ['coach'])
    for team in (first, second):
        assert admin.post('/api/v1/users/coach/assignments', json={'team_id': team, 'kind': 'coach'}).status_code == 201
    coach = login('coach')
    body = {'team_id': first, 'team_ids': [second], 'title': 'Séance commune', 'kind': 'training', 'starts_at': '2099-10-15T18:00:00+02:00', 'ends_at': '2099-10-15T20:00:00+02:00', 'gymnasium_id': None, 'courts': 0, 'until': '2099-10-29'}
    assert coach.post('/api/v1/event-requests', json=body | {'team_ids': [stranger]}).status_code == 403
    request = coach.post('/api/v1/event-requests', json=body)
    assert request.status_code == 201, request.text
    assert request.json()['proposal']['team_ids'] == [first, second]
    accepted = admin.post(f"/api/v1/event-requests/{request.json()['id']}/decision", json={'accept': True}).json()
    series = admin.get(f"/api/v1/events/{accepted['event_id']}").json()['series_id']
    occurrences = admin.get('/api/v1/events', params={'series_id': series}).json()
    assert len(occurrences) == 3 and all(e['team_ids'] == [first, second] for e in occurrences)
