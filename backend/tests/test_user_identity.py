from fastapi.testclient import TestClient
from sqlalchemy import select

from app.persistence.database import SessionFactory
from app.persistence.models import EventRevision, License, User
from conftest import PASSWORD, add_user, login
from test_events import payload, setup_planning


def create(admin: TestClient, first: str, last: str) -> str:
    response = admin.post('/api/v1/users', json={'first_name': first, 'last_name': last, 'category': 'M18', 'roles': ['member']})
    assert response.status_code == 201, response.text
    return str(response.json()['user']['id'])


def test_only_the_last_name_initial_is_stored_and_required(admin: TestClient) -> None:
    assert admin.post('/api/v1/users', json={'first_name': 'Camille', 'roles': ['member']}).status_code == 422
    identifier = create(admin, 'Camille', 'dupont')
    assert identifier == 'd-camille-sans-section'
    user = admin.get(f'/api/v1/users/{identifier}').json()
    assert (user['first_name'], user['last_initial']) == ('Camille', 'D')
    with SessionFactory() as db:
        stored = db.get(User, identifier)
        assert stored is not None and 'upont' not in str(vars(stored))


def test_temporary_id_follows_the_section_with_a_three_letter_suffix_for_twins(admin: TestClient) -> None:
    section, _ = setup_planning(admin)
    team = admin.post('/api/v1/teams', json={'name': 'Loisir 1', 'section_id': section}).json()['id']
    first = create(admin, 'Éloïse', 'Martin')
    assert first == 'm-eloise-sans-section'
    assigned = admin.post(f'/api/v1/users/{first}/assignments', json={'team_id': team, 'kind': 'player'})
    assert assigned.status_code == 201 and assigned.json()['user_id'] == 'm-eloise-loisir'
    second = create(admin, 'Eloise', 'Moreau')
    renamed = admin.post(f'/api/v1/users/{second}/assignments', json={'team_id': team, 'kind': 'player'}).json()['user_id']
    assert renamed.startswith('m-eloise-loisir-') and len(renamed) == len('m-eloise-loisir-') + 3
    # Même prénom et même initiale dans la section : alerte de doublon pour les admins.
    alerts = [n for n in admin.get('/api/v1/notifications').json() if n['kind'] == 'duplicate_user']
    assert alerts and alerts[0]['title'] == 'Doublon possible dans Loisir : Eloise M.'


def test_license_number_becomes_the_id_everywhere(admin: TestClient) -> None:
    section, gym = setup_planning(admin)
    # Compte actif sans licence : un référent d’événement doit être actif.
    identifier = 'd-camille-sans-section'
    add_user(identifier, licensed=False)
    event = admin.post('/api/v1/events', json=payload(section, gym, referent=identifier)).json()['id']
    assert admin.patch(f'/api/v1/events/{event}', json={'base_version': 1, 'changes': {'title': 'Séance'}}).status_code == 200
    licensed = admin.put(f'/api/v1/licenses/{identifier}', json={'status': 'in_progress', 'number': 'LIC-2026-42'})
    assert licensed.status_code == 200, licensed.text
    assert licensed.json()['user_id'] == 'LIC-2026-42'
    assert admin.get(f'/api/v1/users/{identifier}').status_code == 404
    assert admin.get('/api/v1/users/LIC-2026-42').json()['first_name'] == identifier
    assert admin.get(f'/api/v1/events/{event}').json()['referent_id'] == 'LIC-2026-42'
    with SessionFactory() as db:
        assert db.get(License, 'LIC-2026-42') is not None
        revisions = list(db.scalars(select(EventRevision).where(EventRevision.event_id == event)))
        assert all(r.after.get('referent_id') == 'LIC-2026-42' for r in revisions)
    # Un numéro déjà porté par un autre compte est refusé.
    other = create(admin, 'Alex', 'Petit')
    assert admin.put(f'/api/v1/licenses/{other}', json={'status': 'in_progress', 'number': 'LIC-2026-42'}).status_code == 409


def test_accounts_without_license_have_no_access_but_admins_do(admin: TestClient) -> None:
    add_user('nolicense', licensed=False)
    refused = TestClient(admin.app).post('/api/v1/auth/login', json={'username': 'nolicense', 'password': PASSWORD})
    assert refused.status_code == 403 and refused.json()['detail']['code'] == 'license_required'
    add_user()
    member = login()  # licencié par défaut
    assert member.get('/api/v1/auth/me').status_code == 200
    with SessionFactory.begin() as db:
        value = db.get(License, 'member')
        assert value is not None
        value.number = None
    # Une session ouverte cesse de fonctionner dès que le numéro disparaît.
    assert member.get('/api/v1/auth/me').status_code == 401
    assert admin.get('/api/v1/auth/me').status_code == 200
    assert admin.get('/api/v1/users/nolicense').status_code == 200
