from fastapi.testclient import TestClient

from conftest import add_user, login


def test_warning_preference_persists_and_is_admin_only(admin: TestClient) -> None:
    section = admin.post('/api/v1/sections', json={'name': 'Loisir'}).json()['id']
    team = admin.post('/api/v1/teams', json={'name': 'Loisir A', 'section_id': section}).json()
    assert team['ffvb_source_warning_ignored'] is False
    path = f"/api/v1/teams/{team['id']}/ffvb-warning"
    assert admin.put(path, json={'ignored': True}).json()['ffvb_source_warning_ignored'] is True
    assert admin.get('/api/v1/teams').json()[0]['ffvb_source_warning_ignored'] is True
    # Editing the team must preserve its separate warning preference.
    assert admin.put(f"/api/v1/teams/{team['id']}", json={'name': 'Loisir B', 'section_id': section}).json()['ffvb_source_warning_ignored'] is True
    add_user()
    with login() as member:
        assert member.put(path, json={'ignored': False}).status_code == 403
    assert admin.put(path, json={'ignored': False}).json()['ffvb_source_warning_ignored'] is False
