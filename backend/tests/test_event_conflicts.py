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


def test_ffvb_divergences_join_the_conflicts_tab_and_past_ones_are_hidden(admin: TestClient) -> None:
    from datetime import UTC, datetime

    from test_ffvb import configure, match_event, sync

    from app.persistence.models import FFVBConflict

    source, _, _ = configure(admin)
    sync(source)
    upcoming, played = match_event('BRC007'), match_event('BRC005')
    with SessionFactory.begin() as db:
        for identifier, year in ((upcoming.id, 2099), (played.id, 2020)):
            event = db.get_one(Event, identifier)
            event.starts_at = datetime(year, 10, 20, 16, tzinfo=UTC)
            event.ends_at = datetime(year, 10, 20, 20, tzinfo=UTC)
        for match in (upcoming.ffvb_match_id, played.ffvb_match_id):
            assert match is not None
            db.add(FFVBConflict(match_id=match, field='kickoff_at', official_value='2099-10-20T17:00:00+00:00', local_value='2099-10-20T16:30:00+00:00'))
    listed = {item['event']['id']: item for item in admin.get('/api/v1/event-conflicts').json()}
    # Le match déjà joué ne figure plus, même avec une divergence ouverte.
    assert played.id not in listed
    divergence = listed[upcoming.id]['divergences']
    assert [(item['field'], item['local_value'], item['official_value']) for item in divergence] == [('kickoff_at', '2099-10-20T16:30:00+00:00', '2099-10-20T17:00:00+00:00')]
    assert 'ffvb_divergence' in [problem['code'] for problem in listed[upcoming.id]['problems']]


def test_an_ignored_conflict_stays_hidden_until_it_changes(admin: TestClient) -> None:
    section, gym = setup_planning(admin, capacity=3)
    event = admin.post('/api/v1/events', json=payload(section, gym, start=at(18), end=at(20))).json()
    with SessionFactory.begin() as db:
        db.get_one(Event, event['id']).referent_ids = []

    def listing(include_ignored: bool = False) -> dict[str, dict[str, object]]:
        url = '/api/v1/event-conflicts' + ('?include_ignored=true' if include_ignored else '')
        return {item['event']['id']: item for item in admin.get(url).json()}

    signature = listing()[event['id']]['signature']
    add_user('coach', ['member', 'coach'])
    assert login('coach').post(f"/api/v1/event-conflicts/{event['id']}/ignore", json={'signature': signature}).status_code == 403
    assert admin.post(f"/api/v1/event-conflicts/{event['id']}/ignore", json={'signature': 'autre'}).status_code == 409
    ignored = admin.post(f"/api/v1/event-conflicts/{event['id']}/ignore", json={'signature': signature})
    assert ignored.status_code == 200, ignored.text
    assert (ignored.json()['ignored'], ignored.json()['ignorer_name']) == (True, 'Admin')
    assert event['id'] not in listing()
    shown = listing(include_ignored=True)[event['id']]
    assert (shown['ignored'], shown['ignorer_name']) == (True, 'Admin')
    # Un nouveau problème (dépassement de capacité) fait réapparaître le conflit.
    admin.post('/api/v1/events?force=true', json=payload(section, gym, start=at(19), end=at(21)) | {'courts': 2})
    back = listing()[event['id']]
    assert back['ignored'] is False
    assert {problem['code'] for problem in back['problems']} == {'no_referent', 'capacity_exceeded'}
    # Ignoré à nouveau puis rétabli.
    assert admin.post(f"/api/v1/event-conflicts/{event['id']}/ignore", json={'signature': back['signature']}).status_code == 200
    assert event['id'] not in listing()
    assert admin.delete(f"/api/v1/event-conflicts/{event['id']}/ignore").status_code == 204
    assert listing()[event['id']]['ignored'] is False
    assert admin.post('/api/v1/event-conflicts/inconnu/ignore', json={'signature': signature}).status_code == 404
