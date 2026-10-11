from datetime import timedelta

from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app.core.security import now
from app.persistence.database import SessionFactory
from app.persistence.models import Event, FFVBConflict, FFVBMatchState, FFVBSource
from conftest import add_user, login
from test_ffvb import configure, match_event, sync


def count(model: type) -> int:
    with SessionFactory() as db:
        return db.scalar(select(func.count()).select_from(model)) or 0


def test_deleting_a_source_keeps_its_matches_as_ordinary_events(admin: TestClient) -> None:
    source, _, gym = configure(admin)
    sync(source)
    event = match_event('BRC007')
    imported = count(FFVBMatchState)
    assert imported > 0
    add_user()
    member = login()
    assert member.post(f'/api/v1/events/{event.id}/follow').status_code == 201
    assert member.delete(f'/api/v1/ffvb/sources/{source}').status_code == 403
    assert admin.delete(f'/api/v1/ffvb/sources/{source}').status_code == 204
    assert (count(FFVBSource), count(FFVBMatchState), count(FFVBConflict)) == (0, 0, 0)
    kept = admin.get(f'/api/v1/events/{event.id}').json()
    assert kept['ffvb_match_id'] is None and kept['cancelled'] is False
    assert (kept['gymnasium_id'], kept['title']) == (gym, event.title)
    assert admin.get(f'/api/v1/events/{event.id}/history').json()[-1]['action'] == 'ffvb_source_deleted'
    assert any(n['event_id'] == event.id for n in member.get('/api/v1/notifications').json())
    # L’événement détaché se modifie comme un événement local, sans confirmation FFVB.
    moved = admin.patch(f'/api/v1/events/{event.id}', json={'base_version': kept['version'], 'changes': {'location': 'Ailleurs'}})
    assert moved.status_code == 200, moved.text
    assert admin.delete(f'/api/v1/ffvb/sources/{source}').status_code == 404


def test_deleting_a_source_can_cancel_upcoming_matches_only(admin: TestClient) -> None:
    source, _, gym = configure(admin)
    sync(source)
    past = match_event('BRC005')
    with SessionFactory.begin() as db:
        value = db.get(Event, past.id)
        assert value is not None
        value.starts_at, value.ends_at = now() - timedelta(days=2), now() - timedelta(days=2, hours=-2)
    upcoming = match_event('BRC007')
    assert admin.delete(f'/api/v1/ffvb/sources/{source}?cancel_upcoming=true').status_code == 204
    assert admin.get(f'/api/v1/events/{upcoming.id}').json()['cancelled'] is True
    assert admin.get(f'/api/v1/events/{past.id}').json()['cancelled'] is False
    segments = admin.get(f'/api/v1/gymnasiums/{gym}/availability', params={'starts_at': upcoming.starts_at.isoformat(), 'ends_at': upcoming.ends_at.isoformat()}).json()['segments']
    assert all(segment['occupied'] == 0 for segment in segments)
