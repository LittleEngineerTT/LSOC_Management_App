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


def test_unavailability_puts_the_event_in_conflict_and_only_warns_admins_and_referents(admin: TestClient) -> None:
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
    assert ask(login('registered'), event['id'], position(admin)).status_code == 201
    # Une indisponibilité partielle qui laisse assez de terrains ne change rien.
    small = admin.post('/api/v1/availability-blocks', json=BLOCK | {'gymnasium_id': gym, 'courts': 1})
    assert small.status_code == 201
    assert admin.get(f"/api/v1/events/{event['id']}").json()['conflict'] is False
    # Sans assez de terrains, l’événement passe en conflit, sans être annulé.
    assert admin.put(f"/api/v1/availability-blocks/{small.json()['id']}", json=BLOCK | {'gymnasium_id': gym, 'courts': 2}).status_code == 200
    current = admin.get(f"/api/v1/events/{event['id']}").json()
    assert (current['cancelled'], current['conflict'], current['conflict_note']) == (False, True, 'Travaux')
    # Seuls le référent et les administrateurs sont prévenus, pas les membres.
    assert 'event_conflict' in kinds(login('referent'))
    assert 'event_conflict' in kinds(admin)
    for name in ('player', 'registered', 'outsider'):
        assert 'event_conflict' not in kinds(login(name)), name
    history = admin.get(f"/api/v1/events/{event['id']}/history").json()
    assert history[-1]['action'] == 'unavailability_conflict'
    # L’indisponibilité réduite libère l’événement : le conflit se lève seul.
    assert admin.put(f"/api/v1/availability-blocks/{small.json()['id']}", json=BLOCK | {'gymnasium_id': gym, 'courts': 1}).status_code == 200
    lifted = admin.get(f"/api/v1/events/{event['id']}").json()
    assert (lifted['conflict'], lifted['conflict_note']) == (False, '')
    assert admin.get(f"/api/v1/events/{event['id']}/history").json()[-1]['action'] == 'conflict_lifted'
    assert any(n['title'].startswith('Conflit levé') for n in login('referent').get('/api/v1/notifications').json())
    for name in ('player', 'registered'):
        assert 'event_conflict' not in kinds(login(name)), name


def test_event_created_on_unavailability_is_in_conflict_instead_of_refused(admin: TestClient) -> None:
    section, gym = setup_planning(admin, capacity=3)
    assert admin.post('/api/v1/availability-blocks', json=BLOCK | {'gymnasium_id': gym, 'courts': 3}).status_code == 201
    created = admin.post('/api/v1/events', json=payload(section, gym))
    assert created.status_code == 201, created.text
    assert (created.json()['cancelled'], created.json()['conflict']) == (False, True)
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
    assert admin.get(f"/api/v1/events/{accepted.json()['event_id']}").json()['conflict'] is True


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


def test_recurring_request_warns_of_conflicting_occurrences_but_is_still_sent(admin: TestClient) -> None:
    coach, gym, body = coach_request(admin, capacity=3)
    section = str(body.pop('section'))
    # Le jeudi 22 : 2 terrains déjà pris, la séance en demande 2 de plus sur 3 ; le 29 : complet.
    assert admin.post('/api/v1/events', json=payload(section, gym, courts=2, start='2099-10-22T18:00:00+02:00', end='2099-10-22T20:00:00+02:00')).status_code == 201
    assert admin.post('/api/v1/events', json=payload(section, gym, courts=3, start='2099-10-29T19:00:00+01:00', end='2099-10-29T21:00:00+01:00')).status_code == 201
    series = body | {'until': '2099-10-29', 'weekdays': [3]}
    conflicts = coach.post('/api/v1/event-requests/conflicts', json=series)
    assert conflicts.status_code == 200, conflicts.text
    assert [(item['starts_at'][:10], item['missing']) for item in conflicts.json()] == [('2099-10-22', 1), ('2099-10-29', 2)]
    # L’aperçu ne crée rien ; la demande récurrente part malgré ses conflits.
    assert admin.get('/api/v1/event-requests').json() == []
    request = coach.post('/api/v1/event-requests', json=series)
    assert request.status_code == 201, request.text
    # L’administrateur tranche à l’acceptation : il doit forcer le dépassement.
    decision = f"/api/v1/event-requests/{request.json()['id']}/decision"
    assert admin.post(decision, json={'accept': True}).status_code == 409
    # Sans gymnase, aucun conflit à signaler.
    assert coach.post('/api/v1/event-requests/conflicts', json=series | {'gymnasium_id': None, 'courts': 0}).json() == []


def test_a_conflict_is_listed_until_the_event_is_really_cancelled(admin: TestClient) -> None:
    section, gym = setup_planning(admin, capacity=3)
    add_user('referent', ['member', 'coach'])
    event = admin.post('/api/v1/events', json=payload(section, gym, courts=2, referent='referent')).json()
    # Une annulation manuelle n’est pas un conflit.
    manual = admin.post('/api/v1/events', json=payload(section, gym, courts=1, start='2099-10-16T18:00:00+02:00', end='2099-10-16T20:00:00+02:00')).json()
    assert admin.post(f"/api/v1/events/{manual['id']}/cancellation", json={'base_version': manual['version']}).status_code == 200
    assert admin.post('/api/v1/availability-blocks', json=BLOCK | {'gymnasium_id': gym, 'courts': 3}).status_code == 201
    listed = admin.get('/api/v1/event-conflicts').json()
    assert [item['event']['id'] for item in listed] == [event['id']]
    assert listed[0]['problems'] == [{'code': 'unavailability_conflict', 'message': 'Conflit : gymnase indisponible (Travaux) : à déplacer, reporter ou annuler'}]
    # L’administrateur, ni référent ni inscrit, est prévenu et renvoyé vers les conflits.
    warned = [n for n in admin.get('/api/v1/notifications').json() if n['kind'] == 'event_conflict']
    assert len(warned) == 1
    assert warned[0]['link'] == '/app/administration?tab=conflicts'
    # Annulé pour de bon : le statut devient « annulé » et l’événement quitte la liste.
    current = admin.get(f"/api/v1/events/{event['id']}").json()
    cancelled = admin.post(f"/api/v1/events/{event['id']}/cancellation", json={'base_version': current['version']})
    assert cancelled.status_code == 200, cancelled.text
    assert (cancelled.json()['cancelled'], cancelled.json()['conflict']) == (True, False)
    assert admin.get('/api/v1/event-conflicts').json() == []
    # Rétabli alors que le gymnase reste indisponible : il repasse en conflit.
    reopened = admin.delete(f"/api/v1/events/{event['id']}/cancellation", params={'base_version': cancelled.json()['version']})
    assert reopened.status_code == 200, reopened.text
    assert (reopened.json()['cancelled'], reopened.json()['conflict']) == (False, True)
