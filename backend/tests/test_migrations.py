import os
import subprocess
from pathlib import Path

from sqlalchemy import inspect

from app.persistence.database import engine
from app.persistence.models import Base

BACKEND = Path(__file__).resolve().parents[1]


def run(*arguments: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run([str(BACKEND/'.venv/bin/alembic'),'-c',str(BACKEND/'alembic.ini'),*arguments],cwd=BACKEND,env=os.environ.copy(),text=True,capture_output=True,check=True)


def test_migrations_empty_database_roundtrip() -> None:
    Base.metadata.drop_all(engine)
    run('upgrade','head')
    tables=set(inspect(engine).get_table_names())
    assert {'users','events','ffvb_matches','email_jobs','sessions','event_revisions'} <= tables
    run('check')
    run('downgrade','base')
    assert set(inspect(engine).get_table_names())=={'alembic_version'}
    run('upgrade','head')
    assert 'events' in inspect(engine).get_table_names()
