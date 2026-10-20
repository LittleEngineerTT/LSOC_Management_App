from fastapi.testclient import TestClient
from app.persistence.database import SessionFactory
from app.persistence.models import Section, Team, FFVBSource


def test_club_code_is_set_once_and_reused(admin: TestClient) -> None:
    assert admin.get('/api/v1/ffvb/club').json() == {'club_code': None}
    assert admin.put('/api/v1/ffvb/club', json={'club_code': '0926620'}).json() == {'club_code': '0926620'}
    assert admin.put('/api/v1/ffvb/club', json={'club_code': '0926620'}).status_code == 200
    assert admin.put('/api/v1/ffvb/club', json={'club_code': '9999999'}).status_code == 409
    section = admin.post('/api/v1/sections', json={'name': 'Compétition'}).json()['id']
    team = admin.post('/api/v1/teams', json={'name': 'Équipe', 'section_id': section, 'referent_ids': ['admin']}).json()['id']
    body = {'team_id': team, 'season': '2026/2027', 'entity': 'PTIDF92', 'pool': 'BRC', 'team_number': '6', 'team_name': 'LSO COLOMBES', 'club_code': '0926620', 'interval_days': 7}
    result = admin.post('/api/v1/ffvb/sources', json=body)
    assert result.status_code == 201, result.text
    assert result.json()['interval_days'] == 7
    assert result.json()['interval_minutes'] == 10080
    body['club_code'] = '9999999'
    assert admin.put('/api/v1/ffvb/sources/' + result.json()['id'], json=body).status_code == 409


def test_days_are_validated_and_first_legacy_source_initializes_club(admin: TestClient) -> None:
    section = admin.post('/api/v1/sections', json={'name': 'Compétition'}).json()['id']
    team = admin.post('/api/v1/teams', json={'name': 'Équipe', 'section_id': section, 'referent_ids': ['admin']}).json()['id']
    body = {'team_id': team, 'season': '2026/2027', 'entity': 'PTIDF92', 'pool': 'BRC', 'team_number': '6', 'team_name': 'LSO COLOMBES', 'club_code': '0926620', 'interval_days': 0}
    assert admin.post('/api/v1/ffvb/sources', json=body).status_code == 422
    body['interval_days'] = 366
    assert admin.post('/api/v1/ffvb/sources', json=body).status_code == 422
    body.pop('interval_days')
    source = admin.post('/api/v1/ffvb/sources', json=body)
    assert source.status_code == 201, source.text
    assert source.json()['interval_days'] == 1
    assert admin.get('/api/v1/ffvb/club').json()['club_code'] == '0926620'


def test_multiple_legacy_clubs_can_be_administered_without_rewriting_their_codes(admin: TestClient) -> None:
    with SessionFactory.begin() as db:
        db.add(Section(id='s', name='Legacy'))
        db.flush()
        for identifier, code in [('one', '0926620'), ('two', '9999999')]:
            db.add(Team(id='team-' + identifier, name=identifier, section_id='s', referent_ids=['admin']))
            db.flush()
            db.add(FFVBSource(id=identifier, team_id='team-' + identifier, season='2026/2027', entity='PTIDF92', pool='BRC', team_number='6', team_name=identifier, club_code=code))
    assert admin.get('/api/v1/ffvb/club').json()['club_code'] is None
    assert admin.put('/api/v1/ffvb/club', json={'club_code': '0926620'}).status_code == 200
    body = {'team_id': 'team-two', 'season': '2026/2027', 'entity': 'PTIDF92', 'pool': 'BRC', 'team_number': '6', 'team_name': 'two', 'club_code': '9999999', 'enabled': False, 'interval_days': 3}
    assert admin.put('/api/v1/ffvb/sources/two', json=body).status_code == 200
    body['club_code'] = '0926620'
    assert admin.put('/api/v1/ffvb/sources/two', json=body).status_code == 409
