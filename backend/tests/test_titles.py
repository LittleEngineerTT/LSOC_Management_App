from fastapi.testclient import TestClient


def user(first: str, roles: list[str]) -> dict[str, object]:
    return {'first_name': first, 'last_name': 'Durand', 'category': 'adult', 'roles': roles}


def test_president_and_vice_president_are_held_by_one_account_each(admin: TestClient) -> None:
    created = admin.post('/api/v1/users', json=user('Camille', ['member', 'president']))
    assert created.status_code == 201, created.text
    president = created.json()['user']
    assert president['roles'] == ['member', 'president']
    # Un second président est refusé, qu’il soit créé ou promu.
    refused = admin.post('/api/v1/users', json=user('Alex', ['president']))
    assert refused.status_code == 409
    assert refused.json()['detail'] == 'La présidence est déjà attribuée à Camille : retirez-lui ce rôle d’abord'
    vice = admin.post('/api/v1/users', json=user('Alex', ['member', 'vice_president'])).json()['user']
    promoted = admin.put(f"/api/v1/users/{vice['id']}", json=user('Alex', ['member', 'president']))
    assert promoted.status_code == 409
    # Le titulaire garde son titre en modifiant son compte ; une fois libéré, le titre se transmet.
    assert admin.put(f"/api/v1/users/{president['id']}", json=user('Camille', ['member', 'president'])).status_code == 200
    assert admin.put(f"/api/v1/users/{president['id']}", json=user('Camille', ['member'])).status_code == 200
    assert admin.put(f"/api/v1/users/{vice['id']}", json=user('Alex', ['member', 'president'])).status_code == 200
