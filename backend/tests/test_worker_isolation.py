import httpx
from fastapi.testclient import TestClient
from aiosmtpd.controller import Controller
from sqlalchemy import select

from app.core.config import settings
from app.core.security import now
from app.jobs import worker
from app.persistence.database import SessionFactory
from app.persistence.models import FFVBSource, User
from app.services.notifications import email
from test_ffvb import HTML, configure
from test_worker import Inbox


def test_worker_source_failure_does_not_roll_back_other_sources(admin: TestClient, monkeypatch) -> None:
    bad,section,_=configure(admin)
    team=admin.post('/api/v1/teams',json={'name':'Second Team','section_id':section,'referent_id':'admin'}).json()['id']
    good=admin.post('/api/v1/ffvb/sources',json={'team_id':team,'season':'2026/2027','entity':'PTIDF92','pool':'BRC','team_number':'6','team_name':'LSO COLOMBES','club_code':'0926620'}).json()['id']
    original=worker.sync_source
    def synchronize(db,source,client):
        if source.id==bad:
            raise RuntimeError('Failure at integration boundary')
        return original(db,source,client)
    original_client=httpx.Client
    monkeypatch.setattr(httpx,'Client',lambda:original_client(transport=httpx.MockTransport(lambda r:httpx.Response(200,content=HTML))))
    monkeypatch.setattr(worker,'sync_source',synchronize)
    assert worker.process_ffvb()==1
    with SessionFactory() as db:
        assert db.get(FFVBSource,bad).last_error is not None
        assert db.get(FFVBSource,bad).next_check_at>now()
        assert db.get(FFVBSource,good).last_success_at is not None


def test_worker_cycle_sends_email_when_ffvb_cycle_fails(monkeypatch) -> None:
    inbox=Inbox()
    server=Controller(inbox,hostname='127.0.0.1',port=8026)
    server.start()
    try:
        monkeypatch.setattr(settings,'smtp_host','127.0.0.1')
        monkeypatch.setattr(settings,'smtp_port',8026)
        with SessionFactory.begin() as db:
            email(db,db.get(User,'admin'),'cycle-isolation','Subject','Delivered despite FFVB error')
        def fail():
            raise RuntimeError('Integration unavailable')
        monkeypatch.setattr(worker,'process_ffvb',fail)
        worker.run_cycle()
        assert len(inbox.messages)==1
        assert b'Delivered despite FFVB error' in inbox.messages[0]
    finally:
        server.stop()
