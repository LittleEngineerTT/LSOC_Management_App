from datetime import UTC, datetime, timedelta

from conftest import add_user, login, record
from fastapi.testclient import TestClient
from sqlalchemy import select
from test_events import setup_planning

from app.main import app
from app.persistence.database import SessionFactory
from app.persistence.models import ContactRequest, EmailJob, Notification
from app.services.privacy import apply_retention


def team(admin: TestClient, name: str = 'Seniors 1') -> str:
    section, _ = setup_planning(admin)
    response = admin.post('/api/v1/teams', json={'name': name, 'section_id': section})
    assert response.status_code == 201, response.text
    return response.json()['id']


def test_a_guest_leaves_a_contact_request_and_admins_are_notified(admin: TestClient) -> None:
    identifier = team(admin)
    guest = TestClient(app)
    body = {'email': 'parent@example.org', 'phone': '', 'message': 'Mon fils peut-il faire un essai ?', 'team_ids': [identifier]}
    response = guest.post('/api/v1/contact', json=body)
    assert response.status_code == 201, response.text
    # Le formulaire est public : la réponse ne renvoie rien de la demande.
    assert response.json() == {'message': 'Demande envoyée'}
    stored = record(ContactRequest, email='parent@example.org')
    assert (stored.phone, stored.team_ids, stored.status) == (None, [identifier], 'open')
    alert = record(Notification, user_id='admin', kind='contact_request')
    assert alert.title == 'Une nouvelle demande de contact a été reçue'
    assert alert.link == '/app/contact'
    assert 'Seniors 1' in alert.body and 'essai' in alert.body
    # Chaque administrateur reçoit aussi un e-mail, groupé avec ses autres demandes.
    job = record(EmailJob, user_id='admin', dedupe_key=f'contact:{stored.id}')
    assert job is not None and job.category == 'request'
    assert admin.get('/api/v1/unread').json()['contacts'] == 1
    add_user('member')
    assert login('member').get('/api/v1/unread').json()['contacts'] == 0


def test_contact_request_needs_a_way_to_answer_a_question_and_known_teams(admin: TestClient) -> None:
    identifier = team(admin)
    guest = TestClient(app)
    base = {'message': 'Question', 'team_ids': [identifier]}
    assert guest.post('/api/v1/contact', json=base).status_code == 422
    assert guest.post('/api/v1/contact', json=base | {'email': ' ', 'phone': ''}).status_code == 422
    assert guest.post('/api/v1/contact', json=base | {'email': 'pas-un-mail'}).status_code == 422
    assert guest.post('/api/v1/contact', json=base | {'phone': '12'}).status_code == 422
    assert guest.post('/api/v1/contact', json=base | {'phone': '06 12', 'email': None}).status_code == 422
    assert guest.post('/api/v1/contact', json={'phone': '06 12 34 56 78', 'message': '', 'team_ids': [identifier]}).status_code == 422
    assert guest.post('/api/v1/contact', json={'phone': '06 12 34 56 78', 'message': 'Question', 'team_ids': []}).status_code == 422
    assert guest.post('/api/v1/contact', json={'phone': '06 12 34 56 78', 'message': 'Question', 'team_ids': ['inconnue']}).status_code == 422
    assert guest.post('/api/v1/contact', json=base | {'phone': '+33 6 12 34 56 78'}).status_code == 201


def test_admins_take_charge_resolve_and_filter_contact_requests(admin: TestClient) -> None:
    identifier = team(admin)
    add_user('second', ['admin'])
    add_user('coach', ['member', 'coach'])
    second, coach = login('second'), login('coach')
    guest = TestClient(app)
    for message in ('Première', 'Seconde'):
        assert guest.post('/api/v1/contact', json={'phone': '0612345678', 'message': message, 'team_ids': [identifier]}).status_code == 201
    assert coach.get('/api/v1/contact-requests').status_code == 403
    listed = admin.get('/api/v1/contact-requests?status=open').json()
    assert [item['message'] for item in listed] == ['Seconde', 'Première']
    first, latest = listed[1]['id'], listed[0]['id']
    assert coach.post(f'/api/v1/contact-requests/{first}/take').status_code == 403
    taken = admin.post(f'/api/v1/contact-requests/{first}/take').json()
    assert (taken['handler_name'], taken['status']) == ('Admin', 'open')
    # Résolue par un collègue : la prise en charge reste celle du premier administrateur.
    resolved = second.post(f'/api/v1/contact-requests/{first}/resolve').json()
    assert (resolved['handler_name'], resolved['status']) == ('Admin', 'resolved')
    assert resolved['resolved_at'] is not None
    assert second.post(f'/api/v1/contact-requests/{first}/resolve').status_code == 409
    assert second.post(f'/api/v1/contact-requests/{first}/take').status_code == 409
    # Sans prise en charge, celui qui résout en devient le responsable.
    assert second.post(f'/api/v1/contact-requests/{latest}/resolve').json()['handler_name'] == 'second'
    assert admin.get('/api/v1/contact-requests?status=open').json() == []
    assert len(admin.get('/api/v1/contact-requests').json()) == 2
    assert admin.get('/api/v1/unread').json()['contacts'] == 0
    reopened = admin.post(f'/api/v1/contact-requests/{latest}/reopen').json()
    assert (reopened['status'], reopened['resolved_at'], reopened['handler_name']) == ('open', None, 'second')
    assert admin.post(f'/api/v1/contact-requests/{latest}/reopen').status_code == 409
    assert admin.get('/api/v1/unread').json()['contacts'] == 1
    assert admin.post('/api/v1/contact-requests/inconnue/resolve').status_code == 404
    # Résoudre une demande ne marque pas sa notification comme lue (2 demandes, 2 admins).
    with SessionFactory() as db:
        unread = db.scalars(select(Notification).where(Notification.kind == 'contact_request', Notification.read_at.is_(None)))
        assert len(list(unread)) == 4


def test_resolved_contact_requests_are_erased_with_the_history(admin: TestClient) -> None:
    identifier = team(admin)
    old = datetime.now(UTC) - timedelta(days=800)
    with SessionFactory.begin() as db:
        db.add(ContactRequest(email='old@example.org', message='Ancienne', team_ids=[identifier], status='resolved', resolved_at=old, created_at=old))
        db.add(ContactRequest(email='open@example.org', message='En cours', team_ids=[identifier], created_at=old))
    with SessionFactory.begin() as db:
        apply_retention(db)
    assert record(ContactRequest, email='old@example.org') is None
    assert record(ContactRequest, email='open@example.org') is not None
