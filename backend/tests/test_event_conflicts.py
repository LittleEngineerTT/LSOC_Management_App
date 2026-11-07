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


def test_disabled_and_suspended_ffvb_matches_are_listed_until_reactivated(admin: TestClient) -> None:
    from datetime import UTC, datetime, timedelta

    from test_ffvb import configure, match_event, sync

    from app.persistence.models import FFVBMatchState

    source, _, _ = configure(admin)
    sync(source)
    disabled, suspended = match_event('BRC007'), match_event('BRC005')
    with SessionFactory.begin() as db:
        # Les matchs du fichier de référence sont ramenés dans l’avenir pour être « à venir ».
        for identifier, day in ((disabled.id, 20), (suspended.id, 21)):
            event = db.get_one(Event, identifier)
            event.starts_at = datetime(2099, 10, day, 16, tzinfo=UTC)
            event.ends_at = datetime(2099, 10, day, 20, tzinfo=UTC)
        db.get_one(FFVBMatchState, disabled.ffvb_match_id).disabled = True
        db.get_one(FFVBMatchState, suspended.ffvb_match_id).suspended_until = datetime.now(UTC) + timedelta(hours=48)

    def codes() -> dict[str, list[str]]:
        return {item['event']['id']: [problem['code'] for problem in item['problems']] for item in admin.get('/api/v1/event-conflicts').json()}

    found = codes()
    assert 'ffvb_disabled' in found[disabled.id]
    assert 'ffvb_suspended' in found[suspended.id]
    for event in (disabled, suspended):
        assert admin.post(f'/api/v1/ffvb/matches/{event.ffvb_match_id}/reactivate', json={}).status_code == 200
    found = codes()
    assert not {'ffvb_disabled', 'ffvb_suspended'} & set(found.get(disabled.id, []) + found.get(suspended.id, []))
