from concurrent.futures import ThreadPoolExecutor
from threading import Event as Signal

import httpx
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.persistence.database import SessionFactory
from app.persistence.models import FFVBSource
from conftest import add_user, login
from test_events import payload, setup_planning
from test_ffvb import HTML, configure, match_event, sync


def test_member_profiles_hide_internal_permissions(admin: TestClient) -> None:
    add_user()
    member=login()
    assert member.get('/api/v1/users/admin').status_code==403
    public=member.get('/api/v1/profiles/admin')
    assert public.status_code==200
    assert 'roles' not in public.json() and 'email' not in public.json()
    assert 'messaging_allowed' not in public.json()


def test_ffvb_custom_courts_survive_unmapped_venue_and_new_defaults(admin: TestClient) -> None:
    source,_,gym=configure(admin)
    sync(source)
    event=match_event('BRC007')
    assert admin.patch(f'/api/v1/events/{event.id}',json={'base_version':event.version,'changes':{'courts':2}}).status_code==200
    assert admin.put('/api/v1/ffvb/defaults',json={'before_minutes':90,'after_minutes':180,'courts':1}).status_code==200
    unknown=HTML.replace(b'GYMNASE AMBROISE PARE',b'UNKNOWN VENUE')
    sync(source,unknown)
    assert match_event('BRC007').courts==0
    assert admin.post('/api/v1/ffvb/gym-mappings',json={'official_name':'UNKNOWN VENUE','gymnasium_id':gym}).status_code==201
    sync(source,unknown)
    result=match_event('BRC007')
    assert result.courts==2 and result.before_minutes==75 and result.after_minutes==150


def test_change_decision_has_actor_and_history(admin: TestClient) -> None:
    add_user()
    member=login()
    section,gym=setup_planning(admin)
    event=admin.post('/api/v1/events',json=payload(section,gym,referent='member')).json()['id']
    change=member.post(f'/api/v1/events/{event}/change-requests',json={'base_version':1,'changes':{'title':'Requested'}}).json()['id']
    decision=admin.post(f'/api/v1/change-requests/{change}/decision',json={'accept':False,'reason':'Autre créneau nécessaire'})
    assert decision.status_code==200
    assert decision.json()['decided_by']=='admin' and decision.json()['decided_at'] is not None
    history=admin.get(f'/api/v1/events/{event}/history').json()
    assert history[-1]['action']=='request_reject' and history[-1]['actor_id']=='admin'


def test_week_shift_of_full_series_checks_final_schedule(admin: TestClient) -> None:
    section,gym=setup_planning(admin)
    events=admin.post('/api/v1/series',json={'event':payload(section,gym,courts=3),'until':'2026-10-29'}).json()
    shifted=admin.patch(f"/api/v1/series/{events[0]['series_id']}",json={'from_event_id':events[0]['id'],'base_version':1,'changes':{'starts_at':'2026-10-22T18:00:00+02:00','ends_at':'2026-10-22T20:00:00+02:00'}})
    assert shifted.status_code==200,shifted.text
    assert [e['starts_at'] for e in shifted.json()]==['2026-10-22T16:00:00Z','2026-10-29T17:00:00Z','2026-11-05T17:00:00Z']


def test_maximum_event_title_does_not_break_notifications(admin: TestClient) -> None:
    section,gym=setup_planning(admin)
    event=admin.post('/api/v1/events',json=payload(section,gym)).json()['id']
    response=admin.patch(f'/api/v1/events/{event}',json={'base_version':1,'changes':{'title':'A'*200}})
    assert response.status_code==200,response.text


def test_source_configuration_can_update_during_fetch(admin: TestClient) -> None:
    source,_,_=configure(admin)
    entered,released=Signal(),Signal()
    def handler(request: httpx.Request) -> httpx.Response:
        entered.set()
        assert released.wait(8)
        return httpx.Response(200,content=HTML)
    def synchronize() -> None:
        from app.services.ffvb import sync_source
        with httpx.Client(transport=httpx.MockTransport(handler)) as client:
            with SessionFactory.begin() as db:
                sync_source(db,db.get(FFVBSource,source),client)
    with ThreadPoolExecutor(max_workers=2) as pool:
        future=pool.submit(synchronize)
        assert entered.wait(5)
        config=admin.get('/api/v1/ffvb/sources').json()[0]
        body={k:config[k] for k in ['team_id','season','entity','pool','team_number','team_name','club_code','enabled','interval_minutes']}
        body['interval_minutes']=20
        update=pool.submit(lambda:admin.put(f'/api/v1/ffvb/sources/{source}',json=body))
        try:
            assert update.result(timeout=2).status_code==200
        finally:
            released.set()
        future.result(timeout=5)
