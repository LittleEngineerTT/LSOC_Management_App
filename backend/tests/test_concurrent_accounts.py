from concurrent.futures import ThreadPoolExecutor, TimeoutError
from threading import Event as Signal
import json

from fastapi.testclient import TestClient
from sqlalchemy import select, text

from app.api import accounts, auth
from app.core.security import cipher
from app.persistence.database import SessionFactory
from app.persistence.models import EmailJob
from conftest import PASSWORD, add_user


def test_invitation_regeneration_cannot_break_verified_account(admin: TestClient, monkeypatch) -> None:
    created=admin.post('/api/v1/users',json={'first_name':'Invited','category':'M18','roles':['member']}).json()
    visitor=TestClient(admin.app)
    assert visitor.post('/api/v1/auth/activate',json={'token':created['invitation_token'],'email':'invited@example.org','password':PASSWORD}).status_code==202
    with SessionFactory() as db:
        job=db.scalar(select(EmailJob).where(EmailJob.user_id==created['user']['id']))
        verification=json.loads(cipher().decrypt(job.encrypted_payload.encode()))['body'].split('token=')[1]
    consumed,regenerating=Signal(),Signal()
    original_consume,original_invitation=auth.consume,accounts.invitation
    def consume(db,raw,purpose):
        user=original_consume(db,raw,purpose)
        consumed.set()
        assert regenerating.wait(5)
        return user
    def invitation(db,user):
        regenerating.set()
        return original_invitation(db,user)
    monkeypatch.setattr(auth,'consume',consume)
    monkeypatch.setattr(accounts,'invitation',invitation)
    with ThreadPoolExecutor(max_workers=2) as pool:
        verify=pool.submit(lambda:visitor.post('/api/v1/auth/verify-email',json={'token':verification}))
        assert consumed.wait(5)
        regenerate=pool.submit(lambda:admin.post(f"/api/v1/users/{created['user']['id']}/invitation"))
        assert verify.result(timeout=8).status_code==200
        assert regenerate.result(timeout=8).status_code==409
    assert visitor.post('/api/v1/auth/login',json={'email':'invited@example.org','password':PASSWORD}).status_code==200


def test_deletion_waits_for_inflight_planning_writes(admin: TestClient) -> None:
    add_user()
    with SessionFactory.begin() as db:
        db.execute(text('SELECT pg_advisory_xact_lock(781011)'))
        with ThreadPoolExecutor(max_workers=1) as pool:
            delete=pool.submit(lambda:admin.delete('/api/v1/users/member'))
            try:
                delete.result(timeout=0.5)
            except TimeoutError:
                db.commit()
                assert delete.result(timeout=5).status_code==204
            else:
                raise AssertionError('La suppression n’attend pas les écritures de planning en cours')
