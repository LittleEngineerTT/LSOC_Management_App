from fastapi.testclient import TestClient
from sqlalchemy import select, text

from app.persistence.database import SessionFactory
from app.persistence.models import Event, FFVBMatchState, FFVBSource, Team
from conftest import add_user, login, set_referents
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
    """Premier référent de chaque match FFVB (un seul par match dans ces tests)."""
    with SessionFactory() as db:
        lists = db.scalars(select(Event.referent_ids).join(FFVBMatchState, FFVBMatchState.id == Event.ffvb_match_id))
        return {ids[0] if ids else None for ids in lists}


def test_only_coaches_and_admins_become_referents(admin: TestClient) -> None:
    source, section, gym = configure(admin)
    team = team_of(source)
    add_user('referent', ['member'])
    add_user('trainer', ['member', 'coach'])
    body = {'team_id': team, 'title': 'Stage', 'kind': 'training', 'starts_at': '2099-10-15T18:00:00+02:00', 'ends_at': '2099-10-15T20:00:00+02:00', 'gymnasium_id': None, 'courts': 0}
    referent = login('referent')
    assert referent.post('/api/v1/event-requests', json=body).status_code == 403
    refused = admin.put(f'/api/v1/teams/{team}', json={'name': 'LSO COLOMBES', 'section_id': section, 'referent_ids': ['referent']})
    assert refused.status_code == 422 and 'coachs et les administrateurs' in refused.text
    # Un référent déjà en place sans rôle coach le reste, mais ne devient pas référent d’un événement.
    set_referents(Team, team, ['admin', 'referent'])
    assert admin.put(f'/api/v1/teams/{team}', json={'name': 'LSO COLOMBES', 'section_id': section, 'referent_ids': ['admin', 'referent']}).status_code == 200
    assert referent.post('/api/v1/event-requests', json=body).status_code == 422
    # Un coach peut être désigné, et propose ses créneaux.
    assert admin.put(f'/api/v1/teams/{team}', json={'name': 'LSO COLOMBES', 'section_id': section, 'referent_ids': ['admin', 'trainer']}).status_code == 200
    response = login('trainer').post('/api/v1/event-requests', json=body)
    assert response.status_code == 201, response.text
    assert response.json()['proposal']['referent_ids'] == ['trainer']


def test_a_coach_attached_to_a_team_becomes_its_referent(admin: TestClient) -> None:
    source, _, _ = configure(admin)
    team = team_of(source)
    sync(source)
    add_user('trainer', ['member', 'coach'])
    assert admin.post('/api/v1/users/trainer/assignments', json={'team_id': team, 'kind': 'coach'}).status_code == 201
    assert next(t for t in admin.get('/api/v1/teams').json() if t['id'] == team)['referent_ids'] == ['admin', 'trainer']
    # Les matchs de l’équipe suivent leurs référents.
    with SessionFactory() as db:
        lists = set(tuple(ids) for ids in db.scalars(select(Event.referent_ids).where(Event.ffvb_match_id.is_not(None))))
    assert lists == {('admin', 'trainer')}
    # Déjà référent : pas de doublon au second rattachement.
    assert admin.post('/api/v1/users/trainer/assignments', json={'team_id': team, 'kind': 'coach'}).status_code in (201, 409)
    assert next(t for t in admin.get('/api/v1/teams').json() if t['id'] == team)['referent_ids'] == ['admin', 'trainer']
    # Détaché, il cesse d’être référent de l’équipe et de ses matchs.
    assignment = next(a for a in admin.get('/api/v1/users/trainer/assignments').json() if a['kind'] == 'coach')['id']
    assert admin.delete(f'/api/v1/users/trainer/assignments/{assignment}').status_code == 200
    assert next(t for t in admin.get('/api/v1/teams').json() if t['id'] == team)['referent_ids'] == ['admin']
    with SessionFactory() as db:
        lists = set(tuple(ids) for ids in db.scalars(select(Event.referent_ids).where(Event.ffvb_match_id.is_not(None))))
    assert lists == {('admin',)}



def test_changing_team_referent_updates_its_events_past_included(admin: TestClient) -> None:
    source, section, gym = configure(admin)
    team = team_of(source)
    sync(source)
    assert ffvb_referents() == {'admin'}
    add_user('coach', ['coach'])
    add_user('next', ['member', 'coach'])
    add_user('special', ['member', 'coach'])
    assert admin.post('/api/v1/users/coach/assignments', json={'team_id': team, 'kind': 'coach'}).status_code == 201
    coach = login('coach')
    request = coach.post('/api/v1/event-requests', json={'team_id': team, 'title': 'Séance passée', 'kind': 'training', 'starts_at': PAST[0], 'ends_at': PAST[1], 'gymnasium_id': None, 'courts': 0}).json()
    accepted = admin.post(f"/api/v1/event-requests/{request['id']}/decision", json={'accept': True}).json()
    requested = admin.get(f"/api/v1/events/{accepted['event_id']}").json()
    assert requested['referent_ids'] == ['coach']
    # Un match confié explicitement à un autre référent garde ce choix.
    with SessionFactory() as db:
        special = db.scalars(select(Event).where(Event.ffvb_match_id.is_not(None)).order_by(Event.starts_at)).first()
        assert special is not None
    detail = admin.get(f'/api/v1/events/{special.id}').json()
    assert admin.patch(f'/api/v1/events/{special.id}', json={'base_version': detail['version'], 'changes': {'referent_ids': ['special']}}).status_code == 200
    # Événement de la même section sans lien avec l’équipe : inchangé.
    other = admin.post('/api/v1/events', json={'title': 'Autre', 'kind': 'other', 'section_ids': [section], 'gymnasium_id': None, 'starts_at': PAST[0], 'ends_at': PAST[1], 'courts': 0, 'referent_ids': ['admin']}).json()
    assert admin.put(f'/api/v1/teams/{team}', json={'name': 'LSO COLOMBES', 'section_id': section, 'referent_ids': ['next']}).status_code == 200
    assert ffvb_referents() == {'next', 'special'}
    assert admin.get(f"/api/v1/events/{accepted['event_id']}").json()['referent_ids'] == ['coach']
    assert admin.get(f"/api/v1/events/{other['id']}").json()['referent_ids'] == ['admin']
    history = admin.get(f"/api/v1/events/{special.id}/history").json()
    assert history[-1]['after']['referent_ids'] == ['special']
    moved = next(e for e in admin.get('/api/v1/events?include_cancelled=true&limit=500').json() if e['ffvb_match_id'] and e['referent_ids'] == ['next'])
    assert admin.get(f"/api/v1/events/{moved['id']}/history").json()[-1]['before']['referent_ids'] == ['admin', 'coach']
    assert any(n['event_id'] == moved['id'] for n in login('next').get('/api/v1/notifications').json())


def test_migration_realigns_ffvb_matches_left_with_the_former_referent(admin: TestClient) -> None:
    source, section, gym = configure(admin)
    team = team_of(source)
    sync(source)
    add_user('next', ['member', 'coach'])
    add_user('special', ['member', 'coach'])
    with SessionFactory() as db:
        first, *others = db.scalars(select(Event).where(Event.ffvb_match_id.is_not(None)).order_by(Event.starts_at))
    detail = admin.get(f'/api/v1/events/{first.id}').json()
    assert admin.patch(f'/api/v1/events/{first.id}', json={'base_version': detail['version'], 'changes': {'referent_ids': ['special']}}).status_code == 200
    # Schéma d’avant le correctif (un seul référent) : l’équipe a changé de référent, pas ses matchs.
    run('stamp', '--purge', 'head')
    run('downgrade', '0008_event_description')
    with engine.begin() as db:
        db.execute(text("UPDATE teams SET referent_id='next' WHERE id=:id"), {'id': team})
    run('upgrade', '0009_realign_team_referents')
    with engine.begin() as db:
        realigned = set(db.scalars(text("SELECT e.referent_id FROM events e JOIN ffvb_matches m ON m.id = e.ffvb_match_id")))
    assert realigned == {'next', 'special'}
    run('upgrade', 'head')
    assert ffvb_referents() == {'next', 'special'}
    assert admin.get(f'/api/v1/events/{others[0].id}').json()['version'] == others[0].version + 1


def test_several_referents_share_the_rights_of_a_team_and_an_event(admin: TestClient) -> None:
    from test_events import payload, setup_planning

    section, gym = setup_planning(admin)
    for user in ('alix', 'bao', 'chris'):
        add_user(user, ['member', 'coach'] if user != 'chris' else None)
    team = admin.post('/api/v1/teams', json={'name': 'Loisir 1', 'section_id': section, 'referent_ids': ['alix', 'bao']})
    assert team.status_code == 201, team.text
    assert team.json()['referent_ids'] == ['alix', 'bao']
    assert admin.post('/api/v1/teams', json={'name': 'Doublon', 'section_id': section, 'referent_ids': ['alix', 'alix']}).status_code == 422
    body = {'team_id': team.json()['id'], 'title': 'Stage', 'kind': 'training', 'starts_at': '2099-10-15T18:00:00+02:00', 'ends_at': '2099-10-15T20:00:00+02:00', 'gymnasium_id': None, 'courts': 0}
    for user in ('alix', 'bao'):
        assert login(user).post('/api/v1/event-requests', json=body).status_code == 201, user
    assert login('chris').post('/api/v1/event-requests', json=body).status_code == 403
    event = admin.post('/api/v1/events', json=payload(section, gym, referent='alix') | {'referent_ids': ['alix', 'bao']}).json()
    assert admin.patch(f"/api/v1/events/{event['id']}", json={'base_version': 1, 'changes': {'direct_edit': True}}).status_code == 200
    renamed = login('bao').patch(f"/api/v1/events/{event['id']}", json={'base_version': 2, 'changes': {'title': 'Séance de Bao'}})
    assert renamed.status_code == 200, renamed.text
    assert login('chris').patch(f"/api/v1/events/{event['id']}", json={'base_version': 3, 'changes': {'title': 'Non'}}).status_code == 403
    assert any(n['event_id'] == event['id'] for n in login('alix').get('/api/v1/notifications').json())
    # Supprimer un référent laisse l’autre en place, sans alerte « référent à réattribuer ».
    assert admin.delete('/api/v1/users/alix').status_code == 204
    assert admin.get(f"/api/v1/events/{event['id']}").json()['referent_ids'] == ['bao']
    assert admin.get(f"/api/v1/teams").json()[0]['referent_ids'] == ['bao']
    assert 'referent_missing' not in [n['kind'] for n in admin.get('/api/v1/notifications').json()]
