import json
from collections.abc import Iterator

import psycopg
import pytest
from conftest import add_user, login
from fastapi.testclient import TestClient
from test_events import payload, setup_planning

from app.api import live
from app.main import app
from app.persistence.database import SessionFactory
from app.persistence.models import Notification
from app.persistence.signals import CHANNEL


@pytest.fixture
def channel() -> Iterator[psycopg.Connection]:
    with psycopg.connect(live.conninfo(), autocommit=True) as connection:
        connection.execute(f'LISTEN {CHANNEL}')
        yield connection


def signals(connection: psycopg.Connection) -> list[dict[str, object]]:
    return [json.loads(item.payload) for item in connection.notifies(timeout=1)]


def test_a_question_signals_its_author_and_the_admins_once_committed(admin: TestClient, channel: psycopg.Connection) -> None:
    section, gym = setup_planning(admin)
    event = admin.post('/api/v1/events', json=payload(section, gym, start='2099-10-15T18:00:00+02:00', end='2099-10-15T20:00:00+02:00')).json()['id']
    signals(channel)
    add_user()
    assert login().post(f'/api/v1/events/{event}/questions', json={'body': 'Faut-il un ballon ?'}).status_code == 201
    received = signals(channel)
    assert any('member' in item['u'] and item['a'] for item in received)


def test_a_rolled_back_notification_signals_nobody(admin: TestClient, channel: psycopg.Connection) -> None:
    signals(channel)
    with SessionFactory() as db:
        db.add(Notification(user_id='admin', kind='x', title='Brouillon', dedupe_key='brouillon'))
        db.flush()
        db.rollback()
    assert signals(channel) == []
    with SessionFactory.begin() as db:
        db.add(Notification(user_id='admin', kind='x', title='Validée', dedupe_key='validee'))
    assert {'u': ['admin'], 'a': False} in signals(channel)


def test_the_stream_is_private_and_starts_with_a_refresh(admin: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    assert TestClient(app).get('/api/v1/live').status_code == 401

    async def idle(self: live.Hub) -> None:
        return None

    # Flux borné : la réponse se termine aussitôt après ses premières trames.
    monkeypatch.setattr(live, 'LIFETIME', 0.0)
    monkeypatch.setattr(live.Hub, 'listen', idle)
    response = admin.get('/api/v1/live')
    assert response.status_code == 200
    assert response.headers['content-type'].startswith('text/event-stream')
    assert response.headers['x-accel-buffering'] == 'no'
    assert response.text == 'retry: 5000\n\nevent: unread\ndata: {}\n\n'
    assert live.hub.subscribers == set()


def test_signals_wake_only_the_accounts_concerned() -> None:
    hub = live.Hub()
    alice, bob, chief = live.Subscriber('alice', False), live.Subscriber('bob', False), live.Subscriber('chief', True)
    hub.subscribers |= {alice, bob, chief}
    hub.dispatch('{"u":["alice"],"a":false}')
    assert (alice.wake.is_set(), bob.wake.is_set(), chief.wake.is_set()) == (True, False, False)
    hub.dispatch('{"u":[],"a":true}')
    assert (bob.wake.is_set(), chief.wake.is_set()) == (False, True)
    hub.dispatch('illisible')
    assert bob.wake.is_set()
