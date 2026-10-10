from concurrent.futures import ThreadPoolExecutor, TimeoutError
from threading import Event as Signal

from fastapi.testclient import TestClient
from sqlalchemy import text

from app.api import accounts, auth
from app.persistence.database import SessionFactory
from conftest import PASSWORD, add_user


def test_invitation_regeneration_cannot_break_activated_account(admin: TestClient, monkeypatch) -> None:
    created=admin.post('/api/v1/users',json={'first_name':'Invited','category':'M18','roles':['member']}).json()
    visitor=TestClient(admin.app)
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
        activation=pool.submit(lambda:visitor.post('/api/v1/auth/activate',json={'token':created['invitation_token'],'username':'invited','password':PASSWORD}))
        assert consumed.wait(5)
        regenerate=pool.submit(lambda:admin.post(f"/api/v1/users/{created['user']['id']}/invitation"))
        assert activation.result(timeout=8).status_code==200
        assert regenerate.result(timeout=8).status_code==409
    assert visitor.post('/api/v1/auth/login',json={'username':'invited','password':PASSWORD}).status_code==200


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
