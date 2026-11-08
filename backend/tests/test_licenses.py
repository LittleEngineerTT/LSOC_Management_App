from fastapi.testclient import TestClient

from conftest import add_user, login


def setup(admin: TestClient) -> tuple[str, str, str, str]:
    loisir = admin.post('/api/v1/sections', json={'name': 'Loisir'}).json()['id']
    competition = admin.post('/api/v1/sections', json={'name': 'Compétition'}).json()['id']
    team_l = admin.post('/api/v1/teams', json={'name': 'Loisir 1', 'section_id': loisir}).json()['id']
    team_c = admin.post('/api/v1/teams', json={'name': 'Régionale', 'section_id': competition}).json()['id']
    for user, team, kind in (('alice', team_l, 'player'), ('bob', team_c, 'player'), ('carla', team_c, 'coach')):
        add_user(user, ['member', 'coach'] if kind == 'coach' else None)
        assert admin.post(f'/api/v1/users/{user}/assignments', json={'team_id': team, 'kind': kind}).status_code == 201
    return loisir, competition, team_l, team_c


def status(admin: TestClient, user: str, value: str, number: str | None = None) -> int:
    return admin.put(f'/api/v1/licenses/{user}', json={'status': value, 'number': number}).status_code


def test_member_only_sees_own_status(admin: TestClient) -> None:
    setup(admin)
    alice = login('alice')
    assert alice.get('/api/v1/licenses/me').json() == {'status': 'none', 'coach_status': 'none', 'coach': False}
    assert alice.get('/api/v1/licenses').status_code == 403
    assert alice.put('/api/v1/licenses/alice', json={'status': 'active', 'number': '1'}).status_code == 403
    assert status(admin, 'alice', 'in_progress', 'alice') == 200
    assert alice.get('/api/v1/licenses/me').json()['status'] == 'in_progress'
    assert alice.get('/api/v1/notifications').json()[0]['title'] == 'Licence joueur : En cours'


def test_active_can_be_chosen_directly_but_requires_a_number(admin: TestClient) -> None:
    # Directive du 11 octobre : plus d’étape préalable avant « active ».
    setup(admin)
    assert status(admin, 'alice', 'active') == 422
    assert status(admin, 'alice', 'active', 'alice') == 200
    assert status(admin, 'alice', 'payment_pending', 'alice') == 200
    assert status(admin, 'alice', 'active', 'alice') == 200
    # Corrections possibles dans l’autre sens ; numéro unique.
    assert status(admin, 'bob', 'in_progress', 'alice') == 409
    assert status(admin, 'alice', 'payment_pending', 'alice') == 200
    assert status(admin, 'bob', 'in_progress', ' ') == 200


def test_missing_licenses_by_section_team_and_overall(admin: TestClient) -> None:
    loisir, competition, team_l, team_c = setup(admin)
    every = admin.get('/api/v1/licenses').json()
    assert {item['user_id'] for item in every} == {'admin', 'alice', 'bob', 'carla'}
    missing = admin.get('/api/v1/licenses?missing=true').json()
    # Le coach et l’admin sans équipe ne sont pas des joueurs : aucune licence ne leur manque.
    assert [item['user_id'] for item in missing] == ['alice', 'bob']
    section = admin.get(f'/api/v1/licenses?section_id={competition}').json()
    assert [(item['user_id'], item['missing']) for item in section] == [('bob', True), ('carla', False)]
    assert [item['user_id'] for item in admin.get(f'/api/v1/licenses?team_id={team_l}&missing=true').json()] == ['alice']
    for step in ('in_progress', 'payment_pending', 'active'):
        assert status(admin, 'alice', step, 'alice') == 200
    assert [item['user_id'] for item in admin.get('/api/v1/licenses?missing=true').json()] == ['bob']
    alice = next(item for item in admin.get('/api/v1/licenses').json() if item['user_id'] == 'alice')
    assert (alice['number'], alice['status'], alice['teams']) == ('alice', 'active', [{'team_id': team_l, 'kind': 'player'}])


def coach_status(admin: TestClient, user: str, value: str, number: str | None = None) -> int:
    return admin.put(f'/api/v1/licenses/{user}', json={'coach_status': value, 'coach_number': number}).status_code


def test_coach_license_has_no_payment_and_its_own_number(admin: TestClient) -> None:
    loisir, competition, team_l, team_c = setup(admin)
    # Carla est coach de la Régionale : sa licence coach manque, pas sa licence joueur.
    assert [i['user_id'] for i in admin.get('/api/v1/licenses?kind=coach&missing=true').json()] == ['carla']
    assert 'carla' not in [i['user_id'] for i in admin.get('/api/v1/licenses?missing=true').json()]
    # La licence coach n’a pas d’étape de paiement ; « active » se choisit directement.
    assert admin.put('/api/v1/licenses/carla', json={'coach_status': 'payment_pending', 'coach_number': 'carla'}).status_code == 422
    assert coach_status(admin, 'carla', 'active') == 422
    assert coach_status(admin, 'carla', 'active', 'carla') == 200
    assert admin.get('/api/v1/licenses?kind=coach&missing=true').json() == []
    carla = login('carla')
    assert carla.get('/api/v1/licenses/me').json() == {'status': 'none', 'coach_status': 'active', 'coach': True}
    assert carla.get('/api/v1/notifications').json()[0]['title'] == 'Licence coach : Active'
    # Le statut joueur évolue séparément ; une même personne peut garder le même numéro.
    assert status(admin, 'carla', 'in_progress', 'carla') == 200
    record = next(i for i in admin.get('/api/v1/licenses?kind=coach').json() if i['user_id'] == 'carla')
    assert (record['number'], record['coach_number'], record['status'], record['coach_status']) == ('carla', 'carla', 'in_progress', 'active')
    # Retirer le numéro coach est impossible tant que la licence coach est active.
    assert admin.put('/api/v1/licenses/carla', json={'coach_number': None}).status_code == 422
    # Le numéro joueur, lui, se retire : la licence joueur n’est pas active.
    assert status(admin, 'carla', 'in_progress', None) == 200


def test_player_and_coach_licenses_have_distinct_numbers(admin: TestClient) -> None:
    setup(admin)
    # Numéros différents : le numéro joueur devient l’identifiant du compte.
    response = admin.put('/api/v1/licenses/carla', json={'number': 'J-1', 'status': 'active', 'coach_number': 'C-1', 'coach_status': 'active'})
    assert response.status_code == 200, response.text
    record = response.json()
    assert (record['user_id'], record['number'], record['coach_number']) == ('J-1', 'J-1', 'C-1')
    # Un numéro n’appartient qu’à une personne, quelle que soit la licence.
    assert admin.put('/api/v1/licenses/alice', json={'number': 'C-1'}).status_code == 409
    assert admin.put('/api/v1/licenses/alice', json={'coach_number': 'J-1'}).status_code == 409
    # Un champ absent reste inchangé.
    assert admin.put('/api/v1/licenses/J-1', json={'coach_status': 'in_progress'}).json()['number'] == 'J-1'


def test_coach_list_only_shows_coaches_and_filters_by_team(admin: TestClient) -> None:
    loisir, competition, team_l, team_c = setup(admin)
    assert [i['user_id'] for i in admin.get('/api/v1/licenses?kind=coach').json()] == ['carla']
    assert admin.get(f'/api/v1/licenses?kind=coach&team_id={team_l}').json() == []
    team = admin.get(f'/api/v1/licenses?kind=coach&section_id={competition}').json()
    assert [(i['user_id'], i['missing'], i['teams']) for i in team] == [('carla', True, [{'team_id': team_c, 'kind': 'coach'}])]
