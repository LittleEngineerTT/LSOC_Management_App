from fastapi.testclient import TestClient

from conftest import add_user, login
from test_coach_event_requests import coach_setup, request_event
from test_events import payload, setup_planning


def unread(client: TestClient, kind: str) -> list[dict[str, object]]:
    return [n for n in client.get('/api/v1/notifications?unread_only=true').json() if n['kind'] == kind]


def test_change_request_links_to_its_validation_and_messages_the_referent(admin: TestClient) -> None:
    add_user('member', ['member', 'coach'])
    add_user('second', ['admin'])
    member, second = login(), login('second')
    section, gym = setup_planning(admin)
    event = admin.post('/api/v1/events', json=payload(section, gym, referent='member')).json()['id']
    request = member.post(f'/api/v1/events/{event}/change-requests', json={'base_version': 1, 'changes': {'title': 'Séance décalée'}}).json()['id']
    alert = unread(admin, 'change_request')[0]
    assert alert['link'] == f'/app/administration?tab=requests&demande={request}'
    assert len(unread(second, 'change_request')) == 1
    decided = admin.post(f'/api/v1/change-requests/{request}/decision', json={'accept': False, 'reason': 'Gymnase réservé par la mairie ce soir-là.'})
    assert decided.status_code == 200, decided.text
    # La demande traitée disparaît pour tous les admins.
    assert unread(admin, 'change_request') == [] and unread(second, 'change_request') == []
    message = unread(member, 'decision')[0]
    assert message['title'] == 'Modification refusée : Entraînement'
    assert message['body'] == 'Gymnase réservé par la mairie ce soir-là.'
    assert message['event_id'] == event


def test_event_request_links_to_its_validation_and_messages_the_coach(admin: TestClient) -> None:
    coach, team, section, gym = coach_setup(admin)
    request = request_event(coach, team, gym)
    alert = unread(admin, 'event_request')[0]
    assert alert['link'] == f"/app/administration?tab=requests&type=events&demande={request['id']}"
    decided = admin.post(f"/api/v1/event-requests/{request['id']}/decision", json={'accept': True, 'reason': 'Bon stage !'})
    assert decided.status_code == 200, decided.text
    assert unread(admin, 'event_request') == [] and unread(admin, 'event_request_decided') == []
    message = unread(coach, 'event_request_decided')[0]
    assert (message['body'], message['event_id']) == ('Bon stage !', decided.json()['event_id'])


def test_decisions_are_written_in_the_referent_messaging(admin: TestClient) -> None:
    add_user('member', ['member', 'coach'])
    member = login()
    section, gym = setup_planning(admin)
    event = admin.post('/api/v1/events', json=payload(section, gym, referent='member')).json()['id']
    request = member.post(f'/api/v1/events/{event}/change-requests', json={'base_version': 1, 'changes': {'title': 'Séance décalée'}}).json()['id']
    admin.post(f'/api/v1/change-requests/{request}/decision', json={'accept': False, 'reason': 'Gymnase indisponible.'})
    notification = unread(member, 'decision')[0]
    thread = member.get('/api/v1/questions').json()[0]
    assert (thread['event_id'], notification['link']) == (event, f"/app/messagerie?thread={thread['id']}")
    messages = member.get(f"/api/v1/questions/{thread['id']}/messages").json()
    assert messages[-1]['author_id'] == 'admin' and messages[-1]['body'].endswith('Gymnase indisponible.')
    assert member.get('/api/v1/unread').json()['messages'] == 1
    # Lire la conversation fait disparaître la notification correspondante.
    assert member.post(f"/api/v1/questions/{thread['id']}/read").status_code == 204
    assert unread(member, 'decision') == []
    # Le référent peut répondre : les admins sont alertés avec un lien vers le fil.
    assert member.post(f"/api/v1/questions/{thread['id']}/messages", json={'body': 'Et jeudi ?'}).status_code == 201
    assert unread(admin, 'question')[0]['link'] == f"/app/messagerie?thread={thread['id']}"


def test_refused_event_request_opens_a_thread_with_a_subject(admin: TestClient) -> None:
    coach, team, section, gym = coach_setup(admin)
    request = request_event(coach, team, gym)
    admin.post(f"/api/v1/event-requests/{request['id']}/decision", json={'accept': False, 'reason': 'Créneau déjà pris.'})
    thread = coach.get('/api/v1/questions').json()[0]
    assert (thread['event_id'], thread['subject']) == (None, 'Demande d’événement : Stage proposé')
    notification = unread(coach, 'event_request_decided')[0]
    assert notification['link'] == f"/app/messagerie?thread={thread['id']}"
    assert coach.get(f"/api/v1/questions/{thread['id']}/messages").json()[0]['body'].endswith('Créneau déjà pris.')
