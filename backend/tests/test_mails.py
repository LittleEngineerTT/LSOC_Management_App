import json
from typing import Any

from fastapi.testclient import TestClient
from sqlalchemy import select

from app.core.config import settings
from app.core.security import cipher
from app.jobs.worker import compose
from app.persistence.database import SessionFactory
from app.persistence.models import EmailJob, User
from app.services.notifications import email
from conftest import add_user, login
from test_events import payload, setup_planning


def queued(user_id: str) -> list[dict[str, Any]]:
    """Contenu des e-mails en file pour un compte."""
    with SessionFactory() as db:
        jobs = db.scalars(select(EmailJob).where(EmailJob.user_id == user_id).order_by(EmailJob.due_at))
        return [json.loads(cipher().decrypt(job.encrypted_payload.encode())) for job in jobs]


def test_change_email_compares_before_and_after_and_opens_the_event(admin: TestClient) -> None:
    section, gym = setup_planning(admin)
    other = admin.post('/api/v1/gymnasiums', json={'name': 'Henri Dunant', 'capacity': 3}).json()['id']
    event = admin.post('/api/v1/events', json=payload(section, gym)).json()['id']
    add_user()
    member = login()
    assert member.post(f'/api/v1/events/{event}/follow').status_code == 201
    changes = {'gymnasium_id': other, 'starts_at': '2026-10-16T19:00:00+02:00', 'ends_at': '2026-10-16T21:00:00+02:00'}
    assert admin.patch(f'/api/v1/events/{event}', json={'base_version': 1, 'changes': changes}).status_code == 200
    [sent] = queued('member')
    assert sent['subject'] == 'Événement modifié : Entraînement'
    # L’écran où l’e-mail se traite : le planning sur la nouvelle semaine, l’événement ouvert.
    assert sent['link'] == f'/app/planning?semaine=2026-10-16&event={event}'
    body = sent['body']
    assert 'Modifié par Admin : date, horaire, lieu.' in body
    assert 'Date : jeudi 15 octobre 2026 → vendredi 16 octobre 2026' in body
    assert 'Horaire : 18 h 00 – 20 h 00 → 19 h 00 – 21 h 00' in body
    assert 'Lieu : Ambroise Paré → Henri Dunant' in body
    # Ce qui ne change pas reste visible, à part.
    assert body.index('Sans changement :') < body.index('Type : Entraînement')
    assert 'Sections : Loisir' in body
    # En HTML, l’ancienne valeur est barrée et la ligne modifiée surlignée.
    assert 'text-decoration:line-through;">Ambroise Paré</td>' in sent['html']
    assert 'font-weight:bold;">Henri Dunant</td>' in sent['html']


def test_deletion_email_keeps_the_event_card(admin: TestClient) -> None:
    section, gym = setup_planning(admin)
    event = admin.post('/api/v1/events', json=payload(section, gym)).json()['id']
    add_user()
    member = login()
    assert member.post(f'/api/v1/events/{event}/follow').status_code == 201
    assert admin.delete(f'/api/v1/events/{event}').status_code == 204
    [sent] = queued('member')
    assert sent['link'] == '/app/mon-planning'
    for line in ('Date : jeudi 15 octobre 2026', 'Horaire : 18 h 00 – 20 h 00', 'Lieu : Ambroise Paré', 'Référents : Admin'):
        assert line in sent['body']


def test_email_ends_with_a_button_to_the_resolution_screen() -> None:
    with SessionFactory.begin() as db:
        email(db, db.get_one(User, 'admin'), 'request:1', 'Nouvelle demande', 'Une demande attend.', link='/app/administration?tab=requests')
    with SessionFactory() as db:
        subject, text, html = compose(list(db.scalars(select(EmailJob))))
    url = f'{settings.frontend_url}/login?suite=/app/administration%3Ftab%3Drequests'
    assert subject == 'Nouvelle demande'
    assert f'Examiner la demande : {url}' in text
    assert f'href="{url}"' in html and 'Examiner la demande →' in html
    # Le pied de page mène aux préférences d’e-mail.
    assert f'{settings.frontend_url}/login?suite=/app/profil' in text
