from datetime import timedelta

from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app.core.security import now
from app.persistence.database import SessionFactory
from app.persistence.models import Event, EventRevision, FFVBConflict, FFVBMatchState, FFVBSource
from conftest import add_user, login
from test_events import payload
from test_ffvb import configure, match_event, sync


def count(model: type) -> int:
    with SessionFactory() as db:
        return db.scalar(select(func.count()).select_from(model)) or 0


def test_deleting_a_source_deletes_all_its_matches(admin: TestClient) -> None:
    source, section, gym = configure(admin)
    sync(source)
    past = match_event('BRC005')
    with SessionFactory.begin() as db:
        value = db.get(Event, past.id)
        assert value is not None
        value.starts_at, value.ends_at = now() - timedelta(days=2), now() - timedelta(days=2, hours=-2)
    upcoming = match_event('BRC007')
    assert count(FFVBMatchState) > 0
    local = admin.post('/api/v1/events', json=payload(section, gym, start='2026-12-01T19:00:00+01:00', end='2026-12-01T21:00:00+01:00', courts=1))
    assert local.status_code == 201, local.text
    add_user()
    member = login()
    assert member.post(f'/api/v1/events/{upcoming.id}/follow').status_code == 201
    assert member.delete(f'/api/v1/ffvb/sources/{source}').status_code == 403
    assert admin.delete(f'/api/v1/ffvb/sources/{source}').status_code == 204
    assert (count(FFVBSource), count(FFVBMatchState), count(FFVBConflict)) == (0, 0, 0)
    for event in (past, upcoming):
        assert admin.get(f'/api/v1/events/{event.id}').status_code == 404
    with SessionFactory() as db:
        assert db.scalar(select(func.count()).select_from(EventRevision).where(EventRevision.event_id.in_([past.id, upcoming.id]))) == 0
        remaining = list(db.scalars(select(Event.id)))
    # Les événements locaux ne sont pas touchés.
    assert local.json()['id'] in remaining
    assert any(n['kind'] == 'event_deleted' for n in member.get('/api/v1/notifications').json())
    segments = admin.get(f'/api/v1/gymnasiums/{gym}/availability', params={'starts_at': upcoming.starts_at.isoformat(), 'ends_at': upcoming.ends_at.isoformat()}).json()['segments']
    assert all(segment['occupied'] == 0 for segment in segments)
    assert admin.delete(f'/api/v1/ffvb/sources/{source}').status_code == 404
