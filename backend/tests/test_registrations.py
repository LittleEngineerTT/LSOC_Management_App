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
    add_user('referent', ['member', 'coach'])
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


def test_reserved_places_open_positions_of_a_section_beside_the_classic_opening(admin: TestClient) -> None:
    section, gym = setup_planning(admin)
    women = admin.post('/api/v1/sections', json={'name': 'Seniors F'}).json()['id']
    setter, libero, hitter = position(admin), position(admin, 'Libéro'), position(admin, 'Attaquant')
    team = admin.post('/api/v1/teams', json={'name': 'SF1', 'section_id': women}).json()['id']
    for user, usual in (('sf01', libero), ('sf02', hitter), ('sf03', setter)):
        add_user(user)
        assert admin.post(f'/api/v1/users/{user}/assignments', json={'team_id': team, 'kind': 'player', 'position_id': usual}).status_code == 201
    add_user('sm01')
    member_of(admin, 'sm01', section)
    quotas = [{'section_id': women, 'position_ids': [setter, libero], 'limit': 1}, {'section_id': women, 'position_ids': [hitter], 'limit': 2}]
    body = payload(section, gym, start=START, end=END) | {'registration_section_ids': [section], 'registration_limit': 1, 'registration_quotas': quotas}
    created = admin.post('/api/v1/events', json=body)
    assert created.status_code == 201, created.text
    event, stored = created.json()['id'], created.json()['registration_quotas']
    assert [(q['position_ids'], q['limit']) for q in stored] == [([setter, libero], 1), ([hitter], 2)]
    reserved = stored[0]['id']
    assert reserved and stored[1]['id'] != reserved
    sf01 = login('sf01')
    summary = sf01.get(f'/api/v1/events/{event}/registrations').json()
    assert (summary['open'], summary['eligible'], summary['allowed_position_ids']) == (True, True, [setter, libero, hitter])
    assert [q['count'] for q in summary['quotas']] == [0, 0]
    # Hors des postes réservés à sa section, un membre de Seniors F ne s’inscrit pas.
    add_user('sf04')
    assert admin.post('/api/v1/users/sf04/assignments', json={'team_id': team, 'kind': 'player'}).status_code == 201
    other = position(admin, 'Central')
    assert ask(login('sf04'), event, other).status_code == 403
    # Libéro, son poste en équipe : pas d’alerte.
    registered(admin, sf01, event, 'sf01', libero)
    # Passeur : les places réservées à ce poste sont complètes.
    sf02 = login('sf02')
    assert ask(sf02, event, setter).status_code == 409
    request = ask(sf02, event, hitter, 'Prêt')
    assert request.status_code == 201
    assert login('sf03').get(f'/api/v1/events/{event}/registrations').json()['quotas'][0]['count'] == 1
    # Poste différent de celui en équipe : alerte jointe à la demande.
    sf03 = login('sf03')
    assert ask(sf03, event, hitter).status_code == 201
    alert = next(n for n in admin.get('/api/v1/notifications').json() if n['title'].startswith('Demande d’inscription de sf03'))
    assert alert['body'] == 'Poste : Attaquant\nAttention : poste habituel en équipe : Passeur'
    participants = {p['user_id']: p for p in admin.get(f'/api/v1/events/{event}/registrations').json()['participants']}
    assert (participants['sf01']['quota_id'], participants['sf01']['position_warning']) == (reserved, False)
    assert (participants['sf03']['position_warning'], participants['sf03']['team_position_ids']) == (True, [setter])
    assert participants['sf02']['quota_id'] == stored[1]['id']
    # L’ouverture classique garde sa propre limite.
    registered(admin, login('sm01'), event, 'sm01', setter)
    summary = admin.get(f'/api/v1/events/{event}/registrations').json()
    assert (summary['count'], summary['limit']) == (2, 1)
    assert admin.get(f'/api/v1/events/{event}').json()['registration_count'] == 2
    # Des places occupées ne disparaissent ni ne diminuent sous leurs inscrits.
    version = admin.get(f'/api/v1/events/{event}').json()['version']
    removed = admin.patch(f'/api/v1/events/{event}', json={'base_version': version, 'changes': {'registration_quotas': [stored[1]]}})
    assert removed.status_code == 422
    kept = [stored[0], {**stored[1], 'limit': 3}, {'section_id': section, 'position_ids': [hitter], 'limit': 1}]
    changed = admin.patch(f'/api/v1/events/{event}', json={'base_version': version, 'changes': {'registration_quotas': kept}})
    assert changed.status_code == 200, changed.text
    after = changed.json()['registration_quotas']
    assert [q['id'] for q in after[:2]] == [reserved, stored[1]['id']] and after[2]['id'] not in (reserved, stored[1]['id'])
    # Un poste ou une section utilisés par des places réservées ne se suppriment pas.
    assert admin.delete(f'/api/v1/positions/{libero}').status_code == 409
    assert admin.delete(f'/api/v1/sections/{women}').status_code == 409


def test_only_admins_set_reserved_places_and_they_open_an_event_without_organizer(admin: TestClient) -> None:
    section, gym = setup_planning(admin)
    setter = position(admin)
    body = payload(section, gym, start=START, end=END) | {'section_ids': [], 'registration_quotas': [{'section_id': section, 'position_ids': [setter], 'limit': 2}]}
    created = admin.post('/api/v1/events', json=body)
    assert created.status_code == 201, created.text
    assert admin.post('/api/v1/events', json=body | {'registration_quotas': [{'section_id': section, 'position_ids': [setter, setter], 'limit': 2}]}).status_code == 422
    assert admin.post('/api/v1/events', json=body | {'registration_quotas': [{'section_id': section, 'position_ids': ['inconnu'], 'limit': 2}]}).status_code == 404
    add_user('coach1', ['member', 'coach'])
    event = created.json()['id']
    assert admin.patch(f'/api/v1/events/{event}', json={'base_version': 1, 'changes': {'referent_ids': ['coach1'], 'direct_edit': True}}).status_code == 200
    change = {'base_version': 2, 'changes': {'registration_quotas': []}}
    assert login('coach1').patch(f'/api/v1/events/{event}', json=change).status_code == 403


def test_registration_requests_are_listed_in_requests_for_admins_and_event_referents(admin: TestClient) -> None:
    section, gym = setup_planning(admin)
    setter, libero = position(admin), position(admin, 'Libéro')
    team = admin.post('/api/v1/teams', json={'name': 'Équipe', 'section_id': section}).json()['id']
    add_user()
    assert admin.post('/api/v1/users/member/assignments', json={'team_id': team, 'kind': 'player', 'position_id': libero}).status_code == 201
    add_user('coach1', ['member', 'coach'])
    add_user('coach2', ['member', 'coach'])
    body = payload(section, gym, start=START, end=END, referent='coach1') | {'registration_section_ids': [section], 'registration_limit': 2}
    event = admin.post('/api/v1/events', json=body).json()['id']
    assert ask(login(), event, setter, 'Je veux essayer').status_code == 201
    [item] = [r for r in admin.get('/api/v1/requests?status=pending').json() if r['kind'] == 'registration']
    assert (item['actor_id'], item['actor_name'], item['event_id'], item['position_warning']) == ('member', 'member', event, True)
    assert item['title'] == 'Inscription : Entraînement du 15/10/2099'
    assert item['description'] == 'Poste : Passeur. Poste habituel en équipe : Libéro. « Je veux essayer »'
    assert item['link'] == f'/app/planning?event={event}'
    # Le référent de l’événement la voit ; un autre coach non.
    referent = login('coach1')
    assert [r['id'] for r in referent.get('/api/v1/requests').json()] == [item['id']]
    assert [r['kind'] for r in login('coach2').get('/api/v1/requests').json()] == []
    # Décidée depuis la liste (même route que l’événement), elle quitte « À traiter ».
    assert decide(referent, event, 'member', True).status_code == 200
    assert referent.get('/api/v1/requests?status=pending').json() == []
    assert [r['status'] for r in referent.get('/api/v1/requests?status=accepted').json()] == ['accepted']
    assert referent.get('/api/v1/requests?status=withdrawn').json() == []
