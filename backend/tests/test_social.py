from fastapi.testclient import TestClient
from sqlalchemy import select

from app.persistence.database import SessionFactory
from app.persistence.models import EmailJob
from conftest import add_user, login
from test_events import payload, setup_planning


def test_question_privacy_and_messaging_revocation(admin: TestClient) -> None:
    add_user()
    add_user('other')
    member, other = login(), login('other')
    section, gym = setup_planning(admin)
    event = admin.post('/api/v1/events', json=payload(section, gym, referent='other')).json()['id']
    response = member.post(f'/api/v1/events/{event}/questions', json={'body':'Quel équipement apporter ?'})
    assert response.status_code == 201, response.text
    thread = response.json()['id']
    assert other.get(f'/api/v1/questions/{thread}/messages').status_code == 403
    assert len(admin.get(f'/api/v1/questions/{thread}/messages').json()) == 1
    assert admin.post(f'/api/v1/questions/{thread}/messages', json={'body':'Des chaussures propres.'}).status_code == 201
    assert len(member.get(f'/api/v1/questions/{thread}/messages').json()) == 2
    result = admin.put('/api/v1/users/member', json={'first_name':'Member', 'category':'M18', 'roles':['member'], 'messaging_allowed':False})
    assert result.status_code == 200
    assert member.post(f'/api/v1/questions/{thread}/messages',json={'body':'Merci'}).status_code == 403
    assert len(member.get(f'/api/v1/questions/{thread}/messages').json()) == 2


def test_follow_preferences_referent_and_author_email(admin: TestClient) -> None:
    add_user()
    add_user('other')
    member, other = login(), login('other')
    section, gym = setup_planning(admin)
    event = admin.post('/api/v1/events',json=payload(section,gym,referent='member')).json()['id']
    assert member.post(f'/api/v1/events/{event}/follow').status_code == 201
    assert other.post(f'/api/v1/events/{event}/follow').status_code == 201
    assert other.put('/api/v1/preferences',json={'followed_email':False,'referent_email':False,'admin_email':False}).status_code == 200
    assert admin.patch(f'/api/v1/events/{event}',json={'base_version':1,'changes':{'direct_edit':True}}).status_code == 200
    assert member.patch(f'/api/v1/events/{event}',json={'base_version':2,'changes':{'title':'Séance ajustée'}}).status_code == 200
    with SessionFactory() as db:
        keys = [(j.user_id,j.dedupe_key) for j in db.scalars(select(EmailJob))]
    assert ('member',f'event:{event}:2') in keys
    assert ('member',f'event:{event}:3') not in keys
    assert ('other',f'event:{event}:3') not in keys
    notifications = other.get('/api/v1/notifications').json()
    assert len(notifications) == 2
    notification_id = notifications[0]['id']
    assert member.post(f'/api/v1/notifications/{notification_id}/read').status_code == 403
    assert other.post(f'/api/v1/notifications/{notification_id}/read').json()['read_at'] is not None


def test_series_follow_covers_future_occurrences(admin: TestClient) -> None:
    add_user()
    member = login()
    section,gym=setup_planning(admin)
    events=admin.post('/api/v1/series',json={'event':payload(section,gym),'until':'2026-10-29'}).json()
    series=events[0]['series_id']
    assert member.post(f'/api/v1/series/{series}/follow').status_code==201
    event=events[2]['id']
    assert admin.patch(f'/api/v1/events/{event}',json={'base_version':1,'changes':{'title':'Dernière séance'}}).status_code==200
    assert member.get('/api/v1/notifications').json()[0]['event_id']==event
    assert member.post(f'/api/v1/events/{event}/follow').status_code==201
    assert member.delete(f'/api/v1/series/{series}/follow').status_code==204
    assert admin.patch(f'/api/v1/events/{event}',json={'base_version':2,'changes':{'title':'Suivi individuel'}}).status_code==200
    assert len(member.get('/api/v1/notifications').json())==2
