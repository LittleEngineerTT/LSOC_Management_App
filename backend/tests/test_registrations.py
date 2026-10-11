from concurrent.futures import ThreadPoolExecutor

from fastapi.testclient import TestClient

from conftest import add_user, login
from test_events import payload, setup_planning

START = '2099-10-15T18:00:00+02:00'
END = '2099-10-15T20:00:00+02:00'


def member_of(admin: TestClient, user: str, section: str) -> None:
    team = admin.post('/api/v1/teams', json={'name': f'Équipe {user}', 'section_id': section}).json()['id']
    assert admin.post(f'/api/v1/users/{user}/assignments', json={'team_id': team, 'kind': 'player'}).status_code == 201


def open_event(admin: TestClient, section: str, gym: str, sections: list[str], limit: int | None) -> str:
    body = payload(section, gym, start=START, end=END) | {'registration_section_ids': sections, 'registration_limit': limit}
    response = admin.post('/api/v1/events', json=body)
    assert response.status_code == 201, response.text
    return str(response.json()['id'])


def test_open_event_accepts_allowed_sections_until_limit(admin: TestClient) -> None:
    section, gym = setup_planning(admin)
    other_section = admin.post('/api/v1/sections', json={'name': 'Compétition'}).json()['id']
    for user in ('first', 'second', 'third', 'outsider'):
        add_user(user)
    for user in ('first', 'second', 'third'):
        member_of(admin, user, other_section)
    member_of(admin, 'outsider', section)
    event = open_event(admin, section, gym, [other_section], 2)
    first, second, third, outsider = (login(user) for user in ('first', 'second', 'third', 'outsider'))
    assert outsider.post(f'/api/v1/events/{event}/registration').status_code == 403
    assert outsider.get(f'/api/v1/events/{event}/registrations').json()['eligible'] is False
    assert first.post(f'/api/v1/events/{event}/registration').status_code == 201
    assert first.post(f'/api/v1/events/{event}/registration').status_code == 201
    assert second.post(f'/api/v1/events/{event}/registration').status_code == 201
    full = third.post(f'/api/v1/events/{event}/registration')
    assert full.status_code == 409 and full.json()['detail']['code'] == 'registration_full'
    summary = third.get(f'/api/v1/events/{event}/registrations').json()
    assert (summary['count'], summary['limit'], summary['registered'], summary['participants']) == (2, 2, False, None)
    assert admin.get(f'/api/v1/events/{event}').json()['registration_count'] == 2
    assert [p['user_id'] for p in admin.get(f'/api/v1/events/{event}/registrations').json()['participants']] == ['first', 'second']
    assert second.delete(f'/api/v1/events/{event}/registration').status_code == 204
    assert third.post(f'/api/v1/events/{event}/registration').status_code == 201
    assert [r['event_id'] for r in third.get('/api/v1/registrations').json()] == [event]


def test_closed_cancelled_and_limit_rules(admin: TestClient) -> None:
    section, gym = setup_planning(admin, capacity=10)
    add_user()
    member_of(admin, 'member', section)
    member = login()
    closed = admin.post('/api/v1/events', json=payload(section, gym, start=START, end=END)).json()
    assert closed['registration_section_ids'] == [] and closed['registration_limit'] is None
    response = member.post(f"/api/v1/events/{closed['id']}/registration")
    assert response.status_code == 409 and response.json()['detail']['code'] == 'registration_closed'
    body = payload(section, gym, start=START, end=END) | {'registration_section_ids': [section]}
    assert admin.post('/api/v1/events', json=body).status_code == 422
    event = open_event(admin, section, gym, [section], 1)
    assert member.post(f'/api/v1/events/{event}/registration').status_code == 201
    lowered = admin.patch(f'/api/v1/events/{event}', json={'base_version': 1, 'changes': {'registration_limit': None}})
    assert lowered.status_code == 422
    raised = admin.patch(f'/api/v1/events/{event}', json={'base_version': 1, 'changes': {'registration_limit': 3}})
    assert raised.status_code == 200, raised.text
    assert admin.patch(f'/api/v1/events/{event}', json={'base_version': 2, 'changes': {'cancelled': True}}).status_code == 200
    assert any(n['event_id'] == event for n in member.get('/api/v1/notifications').json())
    add_user('late')
    member_of(admin, 'late', section)
    assert login('late').post(f'/api/v1/events/{event}/registration').json()['detail']['code'] == 'registration_closed'
    past = admin.post('/api/v1/events', json=payload(section, gym, start='2020-10-15T18:00:00+02:00', end='2020-10-15T20:00:00+02:00') | {'registration_section_ids': [section], 'registration_limit': 5}).json()['id']
    assert member.post(f'/api/v1/events/{past}/registration').status_code == 409


def test_only_admins_open_events_and_remove_registrations(admin: TestClient) -> None:
    section, gym = setup_planning(admin)
    add_user()
    add_user('referent')
    member_of(admin, 'member', section)
    event = admin.post('/api/v1/events', json=payload(section, gym, start=START, end=END, referent='referent')).json()['id']
    assert admin.patch(f'/api/v1/events/{event}', json={'base_version': 1, 'changes': {'direct_edit': True}}).status_code == 200
    referent = login('referent')
    change = {'base_version': 2, 'changes': {'registration_section_ids': [section], 'registration_limit': 4}}
    assert referent.patch(f'/api/v1/events/{event}', json=change).status_code == 403
    assert admin.patch(f'/api/v1/events/{event}', json=change).status_code == 200
    member = login()
    assert member.post(f'/api/v1/events/{event}/registration').status_code == 201
    assert referent.get(f'/api/v1/events/{event}/registrations').json()['participants'][0]['first_name'] == 'member'
    assert member.delete(f'/api/v1/events/{event}/registrations/member').status_code == 403
    assert admin.delete(f'/api/v1/events/{event}/registrations/member').status_code == 204
    assert member.get(f'/api/v1/events/{event}/registrations').json()['registered'] is False
    assert member.get('/api/v1/notifications').json()[0]['kind'] == 'registration_removed'


def test_concurrent_registrations_never_exceed_limit(admin: TestClient) -> None:
    section, gym = setup_planning(admin)
    users = [f'player{index}' for index in range(6)]
    for user in users:
        add_user(user)
        member_of(admin, user, section)
    event = open_event(admin, section, gym, [section], 3)
    clients = [login(user) for user in users]
    with ThreadPoolExecutor(len(clients)) as pool:
        codes = list(pool.map(lambda c: c.post(f'/api/v1/events/{event}/registration').status_code, clients))
    assert sorted(codes) == [201, 201, 201, 409, 409, 409]
    assert admin.get(f'/api/v1/events/{event}/registrations').json()['count'] == 3
