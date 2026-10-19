import asyncio
from datetime import timedelta

from aiosmtpd.controller import Controller
from sqlalchemy import select

from app.core.config import settings
from app.core.security import now
from app.persistence.database import SessionFactory
from app.persistence.models import EmailJob, User
from app.services.notifications import email


class Inbox:
    def __init__(self) -> None:
        self.messages: list[bytes] = []

    async def handle_DATA(self, server, session, envelope) -> str:
        self.messages.append(envelope.content)
        return '250 OK'


def test_smtp_delivery_and_no_duplicate(monkeypatch) -> None:
    from app.jobs.worker import process_emails
    inbox=Inbox()
    controller=Controller(inbox,hostname='127.0.0.1',port=8026)
    controller.start()
    try:
        monkeypatch.setattr(settings,'smtp_host','127.0.0.1')
        monkeypatch.setattr(settings,'smtp_port',8026)
        with SessionFactory.begin() as db:
            user=db.get(User,'admin')
            email(db,user,'delivery-test','A test subject','A test body')
        assert process_emails()==1
        assert len(inbox.messages)==1
        assert b'A test body' in inbox.messages[0]
        assert process_emails()==0
        with SessionFactory() as db:
            job=db.scalar(select(EmailJob))
            assert job.sent_at is not None
            assert job.encrypted_payload==''
    finally:
        controller.stop()


def test_smtp_failure_retries_and_deleted_user_not_delivered(monkeypatch) -> None:
    from app.jobs.worker import process_emails
    monkeypatch.setattr(settings,'smtp_host','127.0.0.1')
    monkeypatch.setattr(settings,'smtp_port',59999)
    with SessionFactory.begin() as db:
        user=db.get(User,'admin')
        email(db,user,'retry-test','Subject','Body')
    assert process_emails()==0
    with SessionFactory.begin() as db:
        job=db.scalar(select(EmailJob))
        assert job.attempts==1 and job.due_at>now()
        db.delete(db.get(User,'admin'))
    assert process_emails()==0
    with SessionFactory() as db:
        assert list(db.scalars(select(EmailJob)))==[]


def test_abandoned_emails_are_purged_after_retention() -> None:
    from app.jobs.worker import cleanup_expired
    with SessionFactory.begin() as db:
        user=db.get(User,'admin')
        email(db,user,'abandoned','Subject','Body')
        email(db,user,'recent-failure','Subject','Body')
        email(db,user,'still-retrying','Subject','Body')
        db.flush()
        jobs={job.dedupe_key:job for job in db.scalars(select(EmailJob))}
        jobs['abandoned'].attempts,jobs['abandoned'].due_at=8,now()-timedelta(days=31)
        jobs['recent-failure'].attempts,jobs['recent-failure'].due_at=8,now()-timedelta(days=5)
        jobs['still-retrying'].attempts,jobs['still-retrying'].due_at=3,now()-timedelta(days=31)
    cleanup_expired()
    with SessionFactory() as db:
        assert sorted(job.dedupe_key for job in db.scalars(select(EmailJob)))==['recent-failure','still-retrying']
