from conftest import add_user, login
from fastapi.testclient import TestClient
from test_events import payload, setup_planning

from app.persistence.database import SessionFactory
from app.persistence.models import Event


def at(hour: int, day: str = '2099-10-15') -> str:
    return f'{day}T{hour:02d}:00:00+02:00'


def test_conflicts_list_capacity_excess_and_erroneous_events(admin: TestClient) -> None:
    section, gym = setup_planning(admin, capacity=3)
    first = admin.post('/api/v1/events', json=payload(section, gym, start=at(18), end=at(20))).json()
    second = admin.post('/api/v1/events?force=true', json=payload(section, gym, start=at(19), end=at(21))).json()
    # Un événement voisin, sans chevauchement, n’est pas en conflit.
    admin.post('/api/v1/events', json=payload(section, gym, start=at(21), end=at(22)))
    away = admin.post('/api/v1/events', json={**payload(section, None, courts=0, start=at(18, '2099-10-16'), end=at(20, '2099-10-16')), 'location': 'Extérieur'}).json()
    orphan = admin.post('/api/v1/events', json=payload(section, gym, start=at(10, '2099-10-17'), end=at(12, '2099-10-17'))).json()
    past = admin.post('/api/v1/events', json=payload(section, gym, start='2020-10-15T18:00:00+02:00', end='2020-10-15T20:00:00+02:00')).json()
    with SessionFactory.begin() as db:
        # Match à domicile sans gymnase associé, et événement dont le référent a disparu.
        db.get_one(Event, away['id']).occupancy_unknown = True
        db.get_one(Event, orphan['id']).referent_ids = []
        db.get_one(Event, past['id']).referent_ids = []
    response = admin.get('/api/v1/event-conflicts')
    assert response.status_code == 200, response.text
    found = {item['event']['id']: [problem['code'] for problem in item['problems']] for item in response.json()}
    assert found == {
        first['id']: ['capacity_exceeded'],
        second['id']: ['capacity_exceeded'],
        away['id']: ['missing_gymnasium'],
        orphan['id']: ['no_referent'],
    }
    excess = next(item for item in response.json() if item['event']['id'] == first['id'])
    assert excess['problems'][0]['message'] == 'Capacité du gymnase dépassée de 1 terrain'
    # Un événement annulé ne pèse plus sur la capacité ni ne figure dans la liste.
    cancelled = admin.post(f"/api/v1/events/{second['id']}/cancellation", json={'base_version': second['version']})
    assert cancelled.status_code == 200, cancelled.text
    assert {item['event']['id'] for item in admin.get('/api/v1/event-conflicts').json()} == {away['id'], orphan['id']}


def test_conflicts_are_reserved_to_admins(admin: TestClient) -> None:
    add_user('coach', ['member', 'coach'])
    assert login('coach').get('/api/v1/event-conflicts').status_code == 403
