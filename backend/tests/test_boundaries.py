from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
import json

from fastapi.testclient import TestClient
from sqlalchemy import select

from app.core.security import cipher
from app.persistence.database import SessionFactory
from app.persistence.models import EmailJob, EventRevision, User
from conftest import PASSWORD, add_user, login
from test_events import payload, setup_planning


def test_series_time_change_applies_to_every_occurrence(admin: TestClient) -> None:
    section,gym=setup_planning(admin)
    events=admin.post('/api/v1/series',json={'event':payload(section,gym),'until':'2026-10-29'}).json()
    result=admin.patch(f"/api/v1/series/{events[0]['series_id']}",json={'from_event_id':events[0]['id'],'base_version':1,'changes':{'starts_at':'2026-10-15T19:00:00+02:00','ends_at':'2026-10-15T21:00:00+02:00'}})
    assert result.status_code==200,result.text
    assert [e['starts_at'] for e in result.json()]==['2026-10-15T17:00:00Z','2026-10-22T17:00:00Z','2026-10-29T18:00:00Z']


def test_series_change_is_atomic_when_later_occurrence_conflicts(admin: TestClient) -> None:
    section,gym=setup_planning(admin)
    events=admin.post('/api/v1/series',json={'event':payload(section,gym,courts=1),'until':'2026-10-29'}).json()
    assert admin.post('/api/v1/events',json=payload(section,gym,start='2026-10-22T18:00:00+02:00',end='2026-10-22T20:00:00+02:00',courts=2)).status_code==201
    result=admin.patch(f"/api/v1/series/{events[0]['series_id']}",json={'from_event_id':events[0]['id'],'base_version':1,'changes':{'courts':2}})
    assert result.status_code==409
    assert [admin.get(f"/api/v1/events/{e['id']}").json()['courts'] for e in events]==[1,1,1]


def test_user_delete_scrubs_history_and_private_questions(admin: TestClient) -> None:
    add_user()
    member=login()
    section,gym=setup_planning(admin)
    event=admin.post('/api/v1/events',json=payload(section,gym,referent='member')).json()['id']
    thread=member.post(f'/api/v1/events/{event}/questions',json={'body':'Private body'}).json()['id']
    assert admin.patch(f'/api/v1/events/{event}',json={'base_version':1,'changes':{'direct_edit':True}}).status_code==200
    assert member.patch(f'/api/v1/events/{event}',json={'base_version':2,'changes':{'title':'Member action'}}).status_code==200
    assert admin.delete('/api/v1/users/member').status_code==204
    assert admin.get(f'/api/v1/questions/{thread}/messages').status_code==404
    event_data=admin.get(f'/api/v1/events/{event}').json()
    assert event_data['referent_id'] is None and event_data['direct_edit'] is False
    with SessionFactory() as db:
        revisions=list(db.scalars(select(EventRevision)))
        own=[r for r in revisions if r.actor_name=='member']
        assert len(own)==1 and own[0].actor_id is None
        assert all(r.before.get('referent_id') is None and r.after.get('referent_id') is None for r in revisions)


def test_invitation_concurrent_single_use(admin: TestClient) -> None:
    created=admin.post('/api/v1/users',json={'first_name':'Invited','category':'M18','roles':['member']}).json()
    def activate(_: int) -> int:
        with TestClient(admin.app) as c:
            return c.post('/api/v1/auth/activate',json={'token':created['invitation_token'],'email':'invited@example.org','password':PASSWORD}).status_code
    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(pool.map(activate,range(2)))==[202,400]


def test_cumulative_roles_multi_team_and_input_limits(admin: TestClient) -> None:
    add_user('coach',['member','coach'])
    section,gym=setup_planning(admin)
    for name in ['Team A','Team B']:
        team=admin.post('/api/v1/teams',json={'name':name,'section_id':section}).json()['id']
        for kind in ['player','coach']:
            assert admin.post('/api/v1/users/coach/assignments',json={'team_id':team,'kind':kind}).status_code==201
    coach=login('coach')
    assert len(coach.get('/api/v1/users/coach/assignments').json())==4
    malformed=payload(section,gym)
    malformed['starts_at']='2026-10-15T18:00:00'
    assert admin.post('/api/v1/events',json=malformed).status_code==422
    malformed=payload(section,gym)
    malformed['courts']=0
    assert admin.post('/api/v1/events',json=malformed).status_code==422
    assert admin.get('/api/v1/events?limit=501').status_code==422
