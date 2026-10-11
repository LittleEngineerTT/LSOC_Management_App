from fastapi.testclient import TestClient
from sqlalchemy import select, text

from app.persistence.database import SessionFactory
from app.persistence.models import Event, FFVBMatchState, FFVBSource
from conftest import add_user, login
from test_ffvb import configure, sync
from test_migrations import run

from app.persistence.database import engine

PAST = ('2020-10-15T18:00:00+02:00', '2020-10-15T20:00:00+02:00')


def team_of(source: str) -> str:
    with SessionFactory() as db:
        value = db.get(FFVBSource, source)
        assert value is not None
        return value.team_id


def ffvb_referents() -> set[str | None]:
    with SessionFactory() as db:
        return set(db.scalars(select(Event.referent_id).join(FFVBMatchState, FFVBMatchState.id == Event.ffvb_match_id)))


def test_team_referent_without_coach_role_can_request_an_event(admin: TestClient) -> None:
    source, section, gym = configure(admin)
    team = team_of(source)
    add_user('referent', ['member'])
    body = {'team_id': team, 'title': 'Stage', 'kind': 'training', 'starts_at': '2099-10-15T18:00:00+02:00', 'ends_at': '2099-10-15T20:00:00+02:00', 'gymnasium_id': None, 'courts': 0}
    referent = login('referent')
    assert referent.post('/api/v1/event-requests', json=body).status_code == 403
    assert admin.put(f'/api/v1/teams/{team}', json={'name': 'LSO COLOMBES', 'section_id': section, 'referent_id': 'referent'}).status_code == 200
    response = referent.post('/api/v1/event-requests', json=body)
    assert response.status_code == 201, response.text
    assert response.json()['proposal']['referent_id'] == 'referent'


def test_changing_team_referent_updates_its_events_past_included(admin: TestClient) -> None:
    source, section, gym = configure(admin)
    team = team_of(source)
    sync(source)
    assert ffvb_referents() == {'admin'}
    add_user('coach', ['coach'])
    add_user('next', ['member'])
    add_user('special', ['member'])
    assert admin.post('/api/v1/users/coach/assignments', json={'team_id': team, 'kind': 'coach'}).status_code == 201
    coach = login('coach')
    request = coach.post('/api/v1/event-requests', json={'team_id': team, 'title': 'Séance passée', 'kind': 'training', 'starts_at': PAST[0], 'ends_at': PAST[1], 'gymnasium_id': None, 'courts': 0}).json()
    accepted = admin.post(f"/api/v1/event-requests/{request['id']}/decision", json={'accept': True}).json()
    requested = admin.get(f"/api/v1/events/{accepted['event_id']}").json()
    assert requested['referent_id'] == 'coach'
    # Un match confié explicitement à un autre référent garde ce choix.
    with SessionFactory() as db:
        special = db.scalars(select(Event).where(Event.ffvb_match_id.is_not(None)).order_by(Event.starts_at)).first()
        assert special is not None
    detail = admin.get(f'/api/v1/events/{special.id}').json()
    assert admin.patch(f'/api/v1/events/{special.id}', json={'base_version': detail['version'], 'changes': {'referent_id': 'special'}}).status_code == 200
    # Événement de la même section sans lien avec l’équipe : inchangé.
    other = admin.post('/api/v1/events', json={'title': 'Autre', 'kind': 'other', 'section_ids': [section], 'gymnasium_id': None, 'starts_at': PAST[0], 'ends_at': PAST[1], 'courts': 0, 'referent_id': 'admin'}).json()
    assert admin.put(f'/api/v1/teams/{team}', json={'name': 'LSO COLOMBES', 'section_id': section, 'referent_id': 'next'}).status_code == 200
    assert ffvb_referents() == {'next', 'special'}
    assert admin.get(f"/api/v1/events/{accepted['event_id']}").json()['referent_id'] == 'coach'
    assert admin.get(f"/api/v1/events/{other['id']}").json()['referent_id'] == 'admin'
    history = admin.get(f"/api/v1/events/{special.id}/history").json()
    assert history[-1]['after']['referent_id'] == 'special'
    moved = next(e for e in admin.get('/api/v1/events?include_cancelled=true&limit=500').json() if e['ffvb_match_id'] and e['referent_id'] == 'next')
    assert admin.get(f"/api/v1/events/{moved['id']}/history").json()[-1]['before']['referent_id'] == 'admin'
    assert any(n['event_id'] == moved['id'] for n in login('next').get('/api/v1/notifications').json())


def test_migration_realigns_ffvb_matches_left_with_the_former_referent(admin: TestClient) -> None:
    source, section, gym = configure(admin)
    team = team_of(source)
    sync(source)
    add_user('next', ['member'])
    add_user('special', ['member'])
    with SessionFactory() as db:
        first, *others = db.scalars(select(Event).where(Event.ffvb_match_id.is_not(None)).order_by(Event.starts_at))
    detail = admin.get(f'/api/v1/events/{first.id}').json()
    assert admin.patch(f'/api/v1/events/{first.id}', json={'base_version': detail['version'], 'changes': {'referent_id': 'special'}}).status_code == 200
    # État d’avant le correctif : l’équipe a changé de référent, pas ses matchs.
    with engine.begin() as db:
        db.execute(text("UPDATE teams SET referent_id='next' WHERE id=:id"), {'id': team})
    run('stamp', '--purge', '0008_event_description')
    run('upgrade', 'head')
    assert ffvb_referents() == {'next', 'special'}
    assert admin.get(f'/api/v1/events/{others[0].id}').json()['version'] == others[0].version + 1
