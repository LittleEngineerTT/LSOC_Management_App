import os
from collections.abc import Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

os.environ.setdefault('LSOC_DATABASE_URL', 'postgresql+psycopg://lewis@127.0.0.1:55433/postgres')

from app.core.security import hash_password  # noqa: E402
from app.main import app  # noqa: E402
from app.persistence.database import SessionFactory, engine  # noqa: E402
from app.persistence.models import Base, User  # noqa: E402

PASSWORD = 'valid-password-12345'


@pytest.fixture(autouse=True)
def database() -> Iterator[None]:
    if ':55433/' not in str(engine.url) and os.environ.get('LSOC_TEST_DATABASE_CONFIRMED') != 'yes':
        raise RuntimeError('Les tests effacent la base : utilisez une base dédiée et LSOC_TEST_DATABASE_CONFIRMED=yes')
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    with SessionFactory.begin() as db:
        db.add(User(id='admin', username='admin', first_name='Admin', roles=['admin'], category='adult', email='admin@example.org', password_hash=hash_password(PASSWORD), active=True))
    yield


@pytest.fixture
def client() -> Iterator[TestClient]:
    with TestClient(app) as value:
        yield value


@pytest.fixture
def admin(client: TestClient) -> TestClient:
    response = client.post('/api/v1/auth/login', json={'username': 'admin', 'password': PASSWORD})
    assert response.status_code == 200, response.text
    client.headers['X-CSRF-Token'] = response.json()['csrf_token']
    return client


def add_user(identifier: str = 'member', roles: list[str] | None = None) -> None:
    with SessionFactory.begin() as db:
        db.add(User(id=identifier, username=identifier, first_name=identifier, roles=roles or ['member'], category='M18', email=f'{identifier}@example.org', password_hash=hash_password(PASSWORD), active=True))


def login(identifier: str = 'member') -> TestClient:
    c = TestClient(app)
    response = c.post('/api/v1/auth/login', json={'username': identifier, 'password': PASSWORD})
    assert response.status_code == 200, response.text
    c.headers['X-CSRF-Token'] = response.json()['csrf_token']
    return c


def record(model: type[Any], **where: Any) -> Any:
    with SessionFactory() as db:
        return db.scalar(select(model).filter_by(**where))
