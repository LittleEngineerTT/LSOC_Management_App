from fastapi.testclient import TestClient

from conftest import add_user, login
from test_licenses import setup


def details(admin: TestClient, user: str) -> str:
    return admin.get(f'/api/v1/users/{user}/assignments').json()[0]['id']


def test_admin_defines_positions_and_assigns_number_and_position(admin: TestClient) -> None:
    loisir, competition, team_l, team_c = setup(admin)
    setter = admin.post('/api/v1/positions', json={'name': 'Passeur'}).json()['id']
    libero = admin.post('/api/v1/positions', json={'name': 'Libéro'}).json()['id']
    assert [item['name'] for item in login('alice').get('/api/v1/positions').json()] == ['Libéro', 'Passeur']
    assert login('alice').post('/api/v1/positions', json={'name': 'Pointu'}).status_code == 403
    assert admin.post('/api/v1/positions', json={'name': 'Passeur'}).status_code == 409

    bob = details(admin, 'bob')
    updated = admin.put(f'/api/v1/users/bob/assignments/{bob}', json={'number': 7, 'position_id': setter})
    assert updated.status_code == 200
    assert (updated.json()['number'], updated.json()['position_id']) == (7, setter)
    # Le coach de l’équipe et le joueur voient le numéro et le poste, sans les modifier.
    assert [(item['user_id'], item['number']) for item in login('carla').get('/api/v1/assignments').json() if item['kind'] == 'player'] == [('bob', 7)]
    assert login('bob').get('/api/v1/users/bob/assignments').json()[0]['position_id'] == setter
    assert login('carla').put(f'/api/v1/users/bob/assignments/{bob}', json={'number': 8}).status_code == 403

    # Un numéro par joueur dans une équipe ; il reste libre dans une autre.
    add_user('dora')
    taken = admin.post('/api/v1/users/dora/assignments', json={'team_id': team_c, 'kind': 'player', 'number': 7})
    assert taken.status_code == 409
    assert admin.post('/api/v1/users/dora/assignments', json={'team_id': team_l, 'kind': 'player', 'number': 7, 'position_id': libero}).status_code == 201
    assert admin.put(f'/api/v1/users/bob/assignments/{bob}', json={'number': 100}).status_code == 422
    assert admin.put(f'/api/v1/users/bob/assignments/{bob}', json={'position_id': 'inconnu'}).status_code == 404

    # Un coach n’a ni numéro ni poste.
    carla = details(admin, 'carla')
    assert admin.put(f'/api/v1/users/carla/assignments/{carla}', json={'number': 1}).status_code == 422

    # Supprimer un poste le retire des joueurs, sans toucher au numéro.
    assert admin.delete(f'/api/v1/positions/{setter}').status_code == 204
    remaining = admin.get('/api/v1/users/bob/assignments').json()[0]
    assert (remaining['number'], remaining['position_id']) == (7, None)
