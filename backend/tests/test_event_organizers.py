from fastapi.testclient import TestClient

from test_events import payload, setup_planning


def test_event_without_organizer_must_be_open_to_registrations(admin: TestClient) -> None:
    section, gym = setup_planning(admin)
    team = admin.post('/api/v1/teams', json={'name': 'Loisir 1', 'section_id': section}).json()['id']
    closed = payload(section, gym) | {'section_ids': [], 'team_ids': []}
    refused = admin.post('/api/v1/events', json=closed)
    assert refused.status_code == 422
    assert 'Sans section organisatrice' in refused.json()['detail']
    opened = admin.post('/api/v1/events', json=closed | {'registration_team_ids': [team], 'registration_limit': 12})
    assert opened.status_code == 201, opened.text
    assert opened.json()['section_ids'] == []
    event = opened.json()
    # Retirer ensuite les inscriptions libres d’un événement sans organisateur est refusé.
    patch = {'base_version': event['version'], 'changes': {'registration_team_ids': [], 'registration_limit': None}}
    assert admin.patch(f"/api/v1/events/{event['id']}", json=patch).status_code == 422
    # Un événement organisé peut perdre ses sections s’il reste ouvert aux inscriptions.
    organised = admin.post('/api/v1/events', json=payload(section, gym, start='2026-10-16T18:00:00+02:00', end='2026-10-16T20:00:00+02:00') | {'registration_section_ids': [section], 'registration_limit': 5}).json()
    patch = {'base_version': organised['version'], 'changes': {'section_ids': []}}
    assert admin.patch(f"/api/v1/events/{organised['id']}", json=patch).json()['section_ids'] == []


def test_user_sex_is_optional_and_limited_to_m_or_f(admin: TestClient) -> None:
    body = {'first_name': 'Eve', 'last_name': 'Martin', 'category': 'adult', 'roles': ['member']}
    created = admin.post('/api/v1/users', json=body).json()['user']
    assert created['sex'] is None
    user = created['id']
    assert admin.put(f'/api/v1/users/{user}', json=body | {'sex': 'F'}).json()['sex'] == 'F'
    assert admin.put(f'/api/v1/users/{user}', json=body | {'sex': 'X'}).status_code == 422
    assert admin.put(f'/api/v1/users/{user}', json=body | {'sex': None}).json()['sex'] is None
