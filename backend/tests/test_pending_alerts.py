from fastapi.testclient import TestClient
from sqlalchemy import select, update

from app.persistence.database import SessionFactory
from app.api.social import waiting_threads
from app.persistence.models import FFVBSource, QuestionMessage, QuestionThread, StaffRequest, User
from conftest import add_user, login
from test_events import payload, setup_planning
from test_ffvb import configure


def flags(client: TestClient) -> tuple[bool, bool]:
    body = client.get('/api/v1/unread').json()
    # La pastille de la messagerie réunit celles de ses deux onglets.
    assert body['messaging_pending'] == (body['questions_pending'] or body['requests_pending'])
    return body['administration'], body['messaging_pending']


def tabs(client: TestClient) -> tuple[bool, bool]:
    """Pastilles des onglets Conversations et Demandes."""
    body = client.get('/api/v1/unread').json()
    return body['questions_pending'], body['requests_pending']


def explain() -> dict[str, object]:
    """Diagnostic : conversations vues comme sans réponse par l’administrateur, avec leur
    propriétaire et leurs messages, et conversations rattachées à une demande."""
    with SessionFactory() as db:
        found = waiting_threads(db, db.get_one(User, 'admin'))
        return {
            'found': {
                identifier: (
                    db.get_one(QuestionThread, identifier).user_id,
                    [
                        (message.author_id, message.created_at.isoformat(), message.body[:30])
                        for message in db.scalars(select(QuestionMessage).where(QuestionMessage.thread_id == identifier).order_by(QuestionMessage.created_at))
                    ],
                )
                for identifier in found
            },
            'threads': [(item.id, item.user_id, item.event_id, item.subject) for item in db.scalars(select(QuestionThread))],
            'linked': [(item.id, item.thread_id, item.status) for item in db.scalars(select(StaffRequest))],
        }


def test_administration_dot_follows_conflicts_and_ffvb_points(admin: TestClient) -> None:
    section, gym = setup_planning(admin)
    assert flags(admin) == (False, False)
    # Une équipe sans source FFVB : source à configurer, jusqu’à ce que l’avertissement soit ignoré.
    team = admin.post('/api/v1/teams', json={'name': 'Loisir 1', 'section_id': section}).json()['id']
    assert flags(admin)[0] is True
    assert admin.put(f'/api/v1/teams/{team}/ffvb-warning', json={'ignored': True}).status_code == 200
    assert flags(admin)[0] is False
    # Un événement à venir en conflit, jusqu’à ce que le conflit soit ignoré.
    event = admin.post('/api/v1/events', json=payload(section, gym, start='2099-10-15T18:00:00+02:00', end='2099-10-15T20:00:00+02:00')).json()['id']
    block = {'title': 'Travaux', 'gymnasium_id': gym, 'courts': 3, 'starts_at': '2099-10-15T17:00:00+02:00', 'ends_at': '2099-10-15T22:00:00+02:00'}
    assert admin.post('/api/v1/availability-blocks', json=block).status_code == 201
    assert flags(admin)[0] is True
    [conflict] = admin.get('/api/v1/event-conflicts').json()
    assert admin.post(f'/api/v1/event-conflicts/{event}/ignore', json={'signature': conflict['signature']}).status_code == 200
    assert flags(admin)[0] is False
    # Pastille réservée aux administrateurs.
    add_user('coach', ['member', 'coach'])
    assert flags(login('coach'))[0] is False


def test_administration_dot_for_a_failing_ffvb_source(admin: TestClient) -> None:
    source, _, _ = configure(admin)
    assert flags(admin)[0] is False
    with SessionFactory.begin() as db:
        db.execute(update(FFVBSource).where(FFVBSource.id == source).values(last_error='Page FFVB indisponible'))
    assert flags(admin)[0] is True
    with SessionFactory.begin() as db:
        db.execute(update(FFVBSource).where(FFVBSource.id == source).values(enabled=False))
    assert flags(admin)[0] is False


def test_messaging_dot_for_unanswered_questions_and_undecided_requests(admin: TestClient) -> None:
    section, gym = setup_planning(admin)
    add_user()
    member = login()
    event = admin.post('/api/v1/events', json=payload(section, gym)).json()['id']
    thread = member.post(f'/api/v1/events/{event}/questions', json={'body': 'Quel équipement apporter ?'}).json()['id']
    # Lue ou non, la question attend sa réponse ; l’adhérent n’a pas de pastille.
    assert flags(admin)[1] is True
    assert tabs(admin) == (True, False)
    assert flags(member)[1] is False
    assert admin.post(f'/api/v1/questions/{thread}/messages', json={'body': 'Des chaussures propres.'}).status_code == 201
    assert flags(admin)[1] is False
    # Une relance de l’adhérent la remet en attente, jusqu’à la suppression de la conversation.
    assert member.post(f'/api/v1/questions/{thread}/messages', json={'body': 'Merci !'}).status_code == 201
    assert flags(admin)[1] is True
    assert admin.delete(f'/api/v1/questions/{thread}').status_code == 204
    assert flags(admin)[1] is False
    # Une demande d’un coach attend la décision : pastille pour le coach et l’administrateur.
    add_user('coach', ['member', 'coach'])
    coach = login('coach')
    created = coach.post('/api/v1/requests', json={'kind': 'other', 'title': 'Ballons neufs'})
    assert created.status_code == 201, created.text
    assert flags(coach)[1] is True
    assert flags(admin)[1] is True
    with SessionFactory() as db:
        stored = db.get_one(User, 'coach')
        diagnostic = (list(stored.roles), waiting_threads(db, stored), coach.get('/api/v1/auth/me').json().get('id'), coach.get('/api/v1/unread').json())
    assert tabs(coach) == (False, True), diagnostic
    assert tabs(admin) == (False, True), explain()
    decided = admin.post(f"/api/v1/requests/{created.json()['id']}/decision", json={'accept': True})
    assert decided.status_code == 200, decided.text
    assert flags(coach)[1] is False
    # Côté administrateur : plus de demande en attente, et la conversation de la demande, close
    # par la décision, ne compte pas comme une question sans réponse.
    assert admin.get('/api/v1/requests', params={'status': 'pending'}).json() == []
    assert tabs(admin) == (False, False), (explain(), thread)
    assert flags(admin)[1] is False
