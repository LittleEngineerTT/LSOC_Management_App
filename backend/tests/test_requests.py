from fastapi.testclient import TestClient

from conftest import add_user, login
from test_dossiers import club
from test_events import payload


def planning(admin: TestClient) -> tuple[str, str]:
    """Section et gymnase de l’équipe créée par club()."""
    section = admin.get('/api/v1/sections').json()[0]['id']
    gym = admin.post('/api/v1/gymnasiums', json={'name': 'Ambroise Paré', 'capacity': 3}).json()['id']
    return section, gym


def messages(client: TestClient, thread: str) -> list[str]:
    return [m['body'] for m in client.get(f'/api/v1/questions/{thread}/messages').json()]


def test_free_request_opens_a_conversation_from_an_event_or_globally(admin: TestClient) -> None:
    club(admin)
    coach = login('coach')
    assert login('player').post('/api/v1/requests', json={'kind': 'other', 'title': 'Ballons'}).status_code == 403
    assert coach.post('/api/v1/requests', json={'kind': 'other', 'title': '  '}).status_code == 422
    assert coach.post('/api/v1/requests', json={'kind': 'other', 'title': 'X', 'player_id': 'player'}).status_code == 422
    created = coach.post('/api/v1/requests', json={'kind': 'other', 'title': 'Ballons neufs', 'description': 'Dix ballons pour la reprise'})
    assert created.status_code == 201, created.text
    value = created.json()
    assert (value['kind'], value['status'], value['event_id'], value['link']) == ('other', 'pending', None, f"/app/messagerie?thread={value['thread_id']}")
    assert messages(coach, value['thread_id']) == ['Ballons neufs\n\nDix ballons pour la reprise']
    alerts = [(n['title'], n['link']) for n in admin.get('/api/v1/notifications').json() if n['kind'] == 'staff_request']
    assert alerts == [('Demande de coach : Ballons neufs', value['link'])]
    # Depuis un événement : la conversation est celle de l’événement.
    section, gym = planning(admin)
    event = admin.post('/api/v1/events', json=payload(section, gym)).json()['id']
    linked = coach.post('/api/v1/requests', json={'kind': 'other', 'title': 'Arbitre', 'event_id': event}).json()
    assert linked['event_id'] == event
    assert [t['event_id'] for t in coach.get('/api/v1/questions').json() if t['id'] == linked['thread_id']] == [event]
    # Décision : écrite dans la conversation, le demandeur est prévenu, l’alerte des admins disparaît.
    assert coach.post(f"/api/v1/requests/{value['id']}/decision", json={'accept': True}).status_code == 403
    decided = admin.post(f"/api/v1/requests/{value['id']}/decision", json={'accept': True, 'reason': 'Commandés'})
    assert decided.status_code == 200, decided.text
    assert decided.json()['status'] == 'accepted'
    assert messages(coach, value['thread_id'])[-1] == 'Demande acceptée : Ballons neufs\n\nCommandés'
    assert coach.get('/api/v1/notifications').json()[0]['kind'] == 'request_decided'
    assert admin.post(f"/api/v1/requests/{value['id']}/decision", json={'accept': False}).status_code == 409
    assert coach.post(f"/api/v1/requests/{linked['id']}/withdraw").json()['status'] == 'withdrawn'


def test_document_request_goes_to_admins_then_opens_the_player_dossier(admin: TestClient) -> None:
    club(admin)
    coach, player = login('coach'), login('player')
    documents = [{'kind': 'medical_certificate'}, {'kind': 'other', 'label': 'Autorisation parentale'}]
    assert coach.post('/api/v1/requests', json={'kind': 'document', 'player_id': 'player'}).status_code == 422
    assert coach.post('/api/v1/requests', json={'kind': 'document', 'player_id': 'stranger', 'documents': documents}).status_code == 403
    assert coach.post('/api/v1/requests', json={'kind': 'document', 'player_id': 'player', 'documents': [{'kind': 'other'}]}).status_code == 422
    created = coach.post('/api/v1/requests', json={'kind': 'document', 'player_id': 'player', 'documents': documents, 'description': 'Nouveau joueur'})
    assert created.status_code == 201, created.text
    value = created.json()
    assert (value['title'], value['player_id'], value['documents']) == ('Pièces à demander à player', 'player', [{'kind': 'medical_certificate', 'label': ''}, {'kind': 'other', 'label': 'Autorisation parentale'}])
    # Rien n’est demandé au joueur avant la décision des administrateurs.
    assert player.get('/api/v1/dossiers/me').json() is None
    assert admin.post(f"/api/v1/requests/{value['id']}/decision", json={'accept': True}).status_code == 200
    dossier = player.get('/api/v1/dossiers/me').json()
    assert [(d['kind'], d['label']) for d in dossier['documents']] == [('medical_certificate', ''), ('other', 'Autorisation parentale')]
    assert dossier['opened_by'] == 'admin'


def test_one_list_gathers_every_kind_of_request(admin: TestClient) -> None:
    club(admin)
    section, gym = planning(admin)
    add_user('referent', ['member', 'coach'])
    event = admin.post('/api/v1/events', json=payload(section, gym, referent='referent')).json()['id']
    referent, coach = login('referent'), login('coach')
    change = referent.post(f'/api/v1/events/{event}/change-requests', json={'base_version': 1, 'changes': {'title': 'Séance décalée'}, 'description': 'Le gymnase ferme plus tôt'})
    assert change.status_code == 201, change.text
    assert change.json()['description'] == 'Le gymnase ferme plus tôt'
    assert coach.post('/api/v1/requests', json={'kind': 'other', 'title': 'Maillots'}).status_code == 201
    every = admin.get('/api/v1/requests').json()
    assert [(r['kind'], r['title'], r['actor_name']) for r in every] == [('other', 'Maillots', 'coach'), ('event_change', 'Modification : Entraînement', 'referent')]
    assert every[1]['description'] == 'Le gymnase ferme plus tôt'
    assert every[1]['link'] == f"/app/administration?tab=requests&demande={change.json()['id']}"
    # Chacun ne voit que ses propres demandes.
    assert [r['kind'] for r in referent.get('/api/v1/requests').json()] == ['event_change']
    assert [r['kind'] for r in coach.get('/api/v1/requests?status=pending').json()] == ['other']
    assert coach.get('/api/v1/requests?status=accepted').json() == []


def test_document_request_from_an_admin_goes_straight_to_the_player(admin: TestClient) -> None:
    club(admin)
    add_user('coachadmin', ['member', 'coach', 'admin'])
    player = login('player')
    created = login('coachadmin').post('/api/v1/requests', json={'kind': 'document', 'player_id': 'player', 'documents': [{'kind': 'identity'}]})
    assert created.status_code == 201, created.text
    assert (created.json()['status'], created.json()['decider_name']) == ('accepted', 'coachadmin')
    dossier = player.get('/api/v1/dossiers/me').json()
    assert [d['kind'] for d in dossier['documents']] == ['identity']
    assert 'staff_request' not in [n['kind'] for n in admin.get('/api/v1/notifications').json()]
