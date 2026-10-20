from concurrent.futures import ThreadPoolExecutor

import httpx
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


def position(admin: TestClient, name: str = 'Passeur') -> str:
    return str(admin.post('/api/v1/positions', json={'name': name}).json()['id'])


def ask(client: TestClient, event: str, position_id: str, message: str = '') -> httpx.Response:
    return client.post(f'/api/v1/events/{event}/registration', json={'position_id': position_id, 'message': message})


def decide(client: TestClient, event: str, user: str, accept: bool, reason: str = '') -> httpx.Response:
    return client.post(f'/api/v1/events/{event}/registrations/{user}/decision', json={'accept': accept, 'reason': reason})


def registered(admin: TestClient, client: TestClient, event: str, user: str, position_id: str) -> None:
    assert ask(client, event, position_id).status_code == 201
    assert decide(admin, event, user, True).status_code == 200


def test_request_waits_for_a_decision_and_carries_position_and_message(admin: TestClient) -> None:
    section, gym = setup_planning(admin)
    setter = position(admin)
    add_user()
    member_of(admin, 'member', section)
    event = open_event(admin, section, gym, [section], 2)
    member = login()
    assert member.post(f'/api/v1/events/{event}/registration', json={'message': 'Sans poste'}).status_code == 422
    assert ask(member, event, 'inconnu').status_code == 422
    request = ask(member, event, setter, 'Je découvre le poste')
    assert request.status_code == 201, request.text
    assert (request.json()['status'], request.json()['position_id'], request.json()['message']) == ('pending', setter, 'Je découvre le poste')
    summary = member.get(f'/api/v1/events/{event}/registrations').json()
    assert (summary['count'], summary['pending'], summary['registered'], summary['status']) == (0, 1, False, 'pending')
    assert admin.get(f'/api/v1/events/{event}').json()['registration_count'] == 0
    alert = admin.get('/api/v1/notifications').json()[0]
    assert (alert['kind'], alert['title'], alert['event_id']) == ('registration_request', 'Demande d’inscription de member : Entraînement du 15/10/2099', event)
    assert alert['body'] == 'Poste : Passeur\n\nJe découvre le poste'
    participants = admin.get(f'/api/v1/events/{event}/registrations').json()['participants']
    assert [(p['user_id'], p['status'], p['position_id'], p['message']) for p in participants] == [('member', 'pending', setter, 'Je découvre le poste')]
    # Une demande en attente se corrige.
    libero = position(admin, 'Libéro')
    assert ask(member, event, libero).json()['position_id'] == libero
    assert decide(member, event, 'member', True).status_code == 403
    accepted = decide(admin, event, 'member', True, 'Bienvenue')
    assert accepted.status_code == 200, accepted.text
    assert accepted.json()['status'] == 'accepted'
    assert decide(admin, event, 'member', False).status_code == 409
    summary = member.get(f'/api/v1/events/{event}/registrations').json()
    assert (summary['count'], summary['pending'], summary['registered'], summary['status']) == (1, 0, True, 'accepted')
    assert admin.get(f'/api/v1/events/{event}').json()['registration_count'] == 1
    assert admin.get('/api/v1/unread').json()['notifications'] == 0
    decision = member.get('/api/v1/notifications').json()[0]
    assert (decision['kind'], decision['title'], decision['body']) == ('registration_decision', 'Inscription acceptée : Entraînement du 15/10/2099', 'Bienvenue')


def test_rejected_request_can_be_renewed(admin: TestClient) -> None:
    section, gym = setup_planning(admin)
    setter = position(admin)
    add_user()
    member_of(admin, 'member', section)
    event = open_event(admin, section, gym, [section], 2)
    member = login()
    assert ask(member, event, setter).status_code == 201
    assert decide(admin, event, 'member', False, 'Groupe déjà complet en passeurs').status_code == 200
    summary = member.get(f'/api/v1/events/{event}/registrations').json()
    assert (summary['status'], summary['decision'], summary['registered']) == ('rejected', 'Groupe déjà complet en passeurs', False)
    assert admin.get(f'/api/v1/events/{event}/registrations').json()['participants'] == []
    assert member.get('/api/v1/notifications').json()[0]['title'] == 'Demande d’inscription refusée : Entraînement du 15/10/2099'
    renewed = ask(member, event, setter, 'Je peux aussi jouer libéro')
    assert renewed.status_code == 201 and renewed.json()['status'] == 'pending'
    assert admin.get('/api/v1/unread').json()['notifications'] == 1


def test_open_event_accepts_allowed_sections_until_limit(admin: TestClient) -> None:
    section, gym = setup_planning(admin)
    setter = position(admin)
    other_section = admin.post('/api/v1/sections', json={'name': 'Compétition'}).json()['id']
    for user in ('first', 'second', 'third', 'outsider'):
        add_user(user)
    for user in ('first', 'second', 'third'):
        member_of(admin, user, other_section)
    member_of(admin, 'outsider', section)
    event = open_event(admin, section, gym, [other_section], 2)
    first, second, third, outsider = (login(user) for user in ('first', 'second', 'third', 'outsider'))
    assert ask(outsider, event, setter).status_code == 403
    assert outsider.get(f'/api/v1/events/{event}/registrations').json()['eligible'] is False
    registered(admin, first, event, 'first', setter)
    assert ask(first, event, setter).status_code == 201
    assert ask(second, event, setter).status_code == 201
    assert ask(third, event, setter).status_code == 201
    assert decide(admin, event, 'second', True).status_code == 200
    full = decide(admin, event, 'third', True)
    assert full.status_code == 409 and full.json()['detail']['code'] == 'registration_full'
    summary = third.get(f'/api/v1/events/{event}/registrations').json()
    assert (summary['count'], summary['limit'], summary['registered'], summary['participants']) == (2, 2, False, None)
    assert admin.get(f'/api/v1/events/{event}').json()['registration_count'] == 2
    assert [p['user_id'] for p in admin.get(f'/api/v1/events/{event}/registrations').json()['participants']] == ['first', 'second', 'third']
    assert second.delete(f'/api/v1/events/{event}/registration').status_code == 204
    assert decide(admin, event, 'third', True).status_code == 200
    assert [(r['event_id'], r['status']) for r in third.get('/api/v1/registrations').json()] == [(event, 'accepted')]


def test_closed_cancelled_and_limit_rules(admin: TestClient) -> None:
    section, gym = setup_planning(admin, capacity=10)
    setter = position(admin)
    add_user()
    member_of(admin, 'member', section)
    member = login()
    closed = admin.post('/api/v1/events', json=payload(section, gym, start=START, end=END)).json()
    assert closed['registration_section_ids'] == [] and closed['registration_limit'] is None
    response = ask(member, closed['id'], setter)
    assert response.status_code == 409 and response.json()['detail']['code'] == 'registration_closed'
    body = payload(section, gym, start=START, end=END) | {'registration_section_ids': [section]}
    assert admin.post('/api/v1/events', json=body).status_code == 422
    event = open_event(admin, section, gym, [section], 1)
    registered(admin, member, event, 'member', setter)
    lowered = admin.patch(f'/api/v1/events/{event}', json={'base_version': 1, 'changes': {'registration_limit': None}})
    assert lowered.status_code == 422
    raised = admin.patch(f'/api/v1/events/{event}', json={'base_version': 1, 'changes': {'registration_limit': 3}})
    assert raised.status_code == 200, raised.text
    assert admin.patch(f'/api/v1/events/{event}', json={'base_version': 2, 'changes': {'cancelled': True}}).status_code == 200
    assert any(n['event_id'] == event for n in member.get('/api/v1/notifications').json())
    add_user('late')
    member_of(admin, 'late', section)
    assert ask(login('late'), event, setter).json()['detail']['code'] == 'registration_closed'
    past = admin.post('/api/v1/events', json=payload(section, gym, start='2020-10-15T18:00:00+02:00', end='2020-10-15T20:00:00+02:00') | {'registration_section_ids': [section], 'registration_limit': 5}).json()['id']
    assert ask(member, past, setter).status_code == 409


def test_referent_decides_and_only_admins_open_events_and_remove_registrations(admin: TestClient) -> None:
    section, gym = setup_planning(admin)
    setter = position(admin)
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
    assert ask(member, event, setter, 'Premier essai').status_code == 201
    assert 'registration_request' in [n['kind'] for n in referent.get('/api/v1/notifications').json()]
    assert referent.get(f'/api/v1/events/{event}/registrations').json()['participants'][0]['first_name'] == 'member'
    assert decide(referent, event, 'member', True).status_code == 200
    assert member.delete(f'/api/v1/events/{event}/registrations/member').status_code == 403
    assert admin.delete(f'/api/v1/events/{event}/registrations/member').status_code == 204
    assert member.get(f'/api/v1/events/{event}/registrations').json()['registered'] is False
    assert member.get('/api/v1/notifications').json()[0]['kind'] == 'registration_removed'


def test_concurrent_acceptances_never_exceed_limit(admin: TestClient) -> None:
    section, gym = setup_planning(admin)
    setter = position(admin)
    users = [f'player{index}' for index in range(6)]
    for user in users:
        add_user(user)
        member_of(admin, user, section)
    event = open_event(admin, section, gym, [section], 3)
    for user in users:
        assert ask(login(user), event, setter).status_code == 201
    cookies, csrf = dict(admin.cookies), admin.headers['X-CSRF-Token']

    def accept(user: str) -> int:
        with TestClient(admin.app, cookies=cookies, headers={'X-CSRF-Token': csrf}) as client:
            return decide(client, event, user, True).status_code

    with ThreadPoolExecutor(len(users)) as pool:
        codes = list(pool.map(accept, users))
    assert sorted(codes) == [200, 200, 200, 409, 409, 409]
    assert admin.get(f'/api/v1/events/{event}/registrations').json()['count'] == 3
