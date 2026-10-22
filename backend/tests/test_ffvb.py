from datetime import timedelta
from pathlib import Path

import httpx
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.core.security import now
from app.persistence.database import SessionFactory
from app.persistence.models import EmailJob, Event, FFVBConflict, FFVBMatchState, FFVBSource
from conftest import add_user, login
from test_events import payload, setup_planning

HTML = Path(__file__).with_name('fixtures').joinpath('ffvb-original.html').read_bytes()


def configure(admin: TestClient) -> tuple[str,str,str]:
    section,gym=setup_planning(admin)
    team=admin.post('/api/v1/teams',json={'name':'LSO COLOMBES','section_id':section,'referent_ids': ['admin']}).json()['id']
    source=admin.post('/api/v1/ffvb/sources',json={'team_id':team,'season':'2026/2027','entity':'PTIDF92','pool':'BRC','team_number':'6','team_name':'LSO COLOMBES','club_code':'0926620'})
    assert source.status_code==201,source.text
    assert admin.post('/api/v1/ffvb/gym-mappings',json={'official_name':'GYMNASE AMBROISE PARE','gymnasium_id':gym}).status_code==201
    return source.json()['id'],section,gym


def sync(source_id: str, html: bytes = HTML) -> None:
    from app.services.ffvb import sync_source
    with httpx.Client(transport=httpx.MockTransport(lambda request: httpx.Response(200,content=html))) as client:
        with SessionFactory.begin() as db:
            source=db.get(FFVBSource,source_id)
            assert source is not None
            sync_source(db,source,client)


def match_event(code: str) -> Event:
    with SessionFactory() as db:
        state=db.scalar(select(FFVBMatchState).where(FFVBMatchState.match_code==code))
        assert state is not None
        event=db.scalar(select(Event).where(Event.ffvb_match_id==state.id))
        assert event is not None
        return event


def test_parser_real_html_reservations_and_idempotency(admin: TestClient) -> None:
    source,_,gym=configure(admin)
    sync(source)
    away,home=match_event('BRC005'),match_event('BRC007')
    assert away.gymnasium_id is None and away.courts==0
    assert home.gymnasium_id==gym and home.courts==3
    assert home.kickoff_at.isoformat()=='2026-11-02T19:30:00+00:00'
    assert home.starts_at.isoformat()=='2026-11-02T18:15:00+00:00'
    assert home.ends_at.isoformat()=='2026-11-02T22:00:00+00:00'
    with SessionFactory() as db:
        count=len(list(db.scalars(select(Event))))
        emails=len(list(db.scalars(select(EmailJob))))
        verified=db.get(FFVBMatchState,home.ffvb_match_id).last_verified_at
    sync(source)
    with SessionFactory() as db:
        assert len(list(db.scalars(select(Event))))==count
        assert len(list(db.scalars(select(EmailJob))))==emails
        assert db.get(FFVBMatchState,home.ffvb_match_id).last_verified_at>verified


def test_manual_conflict_only_author_notified_and_suspend(admin: TestClient) -> None:
    add_user('otheradmin',['admin'])
    other=login('otheradmin')
    source,_,_=configure(admin)
    sync(source)
    home=match_event('BRC007')
    patch={'base_version':home.version,'changes':{'kickoff_at':'2026-11-02T21:00:00+01:00'}}
    assert admin.patch(f'/api/v1/events/{home.id}',json=patch).status_code==409
    patch['acknowledge_ffvb']=True
    assert admin.patch(f'/api/v1/events/{home.id}',json=patch).status_code==200
    sync(source)
    conflicts=other.get('/api/v1/ffvb/conflicts').json()
    assert len(conflicts)==1
    conflict=conflicts[0]
    assert match_event('BRC007').kickoff_at.isoformat()=='2026-11-02T20:00:00+00:00'
    with SessionFactory() as db:
        jobs=list(db.scalars(select(EmailJob).where(EmailJob.dedupe_key.like('ffvb-conflict:%'))))
        assert [j.user_id for j in jobs]==['admin']
    sync(source)
    with SessionFactory() as db:
        assert len(list(db.scalars(select(FFVBConflict))))==1
    assert other.post(f"/api/v1/ffvb/conflicts/{conflict['id']}/resolve",json={'action':'suspend_48h'}).status_code==200
    with SessionFactory.begin() as db:
        state=db.get(FFVBMatchState,home.ffvb_match_id)
        assert 47.9<(state.suspended_until-now()).total_seconds()/3600<=48
        verified=state.last_verified_at
    sync(source)
    with SessionFactory.begin() as db:
        state=db.get(FFVBMatchState,home.ffvb_match_id)
        assert state.last_verified_at==verified
        state.suspended_until=now()-timedelta(seconds=1)
    sync(source)
    opened=admin.get('/api/v1/ffvb/conflicts').json()
    assert len(opened)==1
    assert admin.post(f"/api/v1/ffvb/conflicts/{opened[0]['id']}/resolve",json={'action':'accept_ffvb'}).status_code==200
    assert match_event('BRC007').kickoff_at.isoformat()=='2026-11-02T19:30:00+00:00'


def test_bad_page_and_missing_match_preserve_values(admin: TestClient) -> None:
    source,_,_=configure(admin)
    sync(source)
    home=match_event('BRC007')
    with SessionFactory() as db:
        verified=db.get(FFVBMatchState,home.ffvb_match_id).last_verified_at
    sync(source,b'<html>maintenance</html>')
    with SessionFactory() as db:
        assert db.get(FFVBMatchState,home.ffvb_match_id).last_verified_at==verified
        assert db.get(FFVBSource,source).last_error is not None
    sync(source,HTML.replace(b'BRC007',b'ZZZ007'))
    assert match_event('BRC007').starts_at==home.starts_at
    with SessionFactory() as db:
        assert db.get(FFVBMatchState,home.ffvb_match_id).missing is True
        assert db.get(FFVBMatchState,home.ffvb_match_id).last_verified_at==verified


def test_ffvb_official_move_applies_even_when_over_capacity(admin: TestClient) -> None:
    source,section,gym=configure(admin)
    sync(source)
    assert admin.post('/api/v1/events',json=payload(section,gym,start='2026-11-03T19:00:00+01:00',end='2026-11-03T23:00:00+01:00',courts=3)).status_code==201
    sync(source,HTML.replace(b'02/11/26',b'03/11/26'))
    assert match_event('BRC007').kickoff_at.isoformat()=='2026-11-03T19:30:00+00:00'
    assert any(n['kind']=='capacity_conflict' for n in admin.get('/api/v1/notifications').json())


def test_import_grouped_in_one_notification_changes_stay_unitary(admin: TestClient) -> None:
    source,_,_=configure(admin)
    sync(source)
    imported=[n for n in admin.get('/api/v1/notifications').json() if n['title'].startswith('Calendrier FFVB LSO COLOMBES')]
    assert len(imported)==1
    assert imported[0]['event_id'] is None and 'matchs ajoutés' in imported[0]['title']
    assert '• Match ajouté : ' in imported[0]['body']
    assert not any(n['title'].startswith('Match ajouté') for n in admin.get('/api/v1/notifications').json())
    with SessionFactory() as db:
        assert len(list(db.scalars(select(EmailJob).where(EmailJob.dedupe_key.like('group:%')))))==1
    sync(source,HTML.replace(b'02/11/26',b'03/11/26'))
    changed=[n for n in admin.get('/api/v1/notifications').json() if n['kind']=='event_changed']
    assert len(changed)>=1 and all(n['event_id'] for n in changed)
