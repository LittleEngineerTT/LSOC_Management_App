import json
import logging
import signal
import smtplib
import time
from datetime import timedelta
from email.message import EmailMessage
from types import FrameType
from urllib.parse import urlsplit

import httpx
from cryptography.fernet import InvalidToken
from sqlalchemy import delete, select, text

from app.core.config import settings
from app.core.security import cipher, now
from app.persistence.database import SessionFactory
from app.persistence.models import AuthToken, EmailJob, FFVBSource, LoginSession, RateBucket, User
from app.services.ffvb import sync_source

logger = logging.getLogger(__name__)
_stopping = False


def message_domain() -> str:
    """Domaine des Message-ID : celui du frontend, pour ne pas être pris pour du spam."""
    return urlsplit(settings.frontend_url).hostname or "lsoc.local"


def process_emails(limit: int = 100) -> int:
    sent = 0
    with SessionFactory() as db:
        identifiers = list(
            db.scalars(
                select(EmailJob.id)
                .where(EmailJob.sent_at.is_(None), EmailJob.due_at <= now(), EmailJob.attempts < 8)
                .order_by(EmailJob.due_at)
                .limit(limit)
            )
        )
    for identifier in identifiers:
        with SessionFactory.begin() as db:
            candidate = db.get(EmailJob, identifier)
            if candidate is None:
                continue
            # Lock user before queue row, matching account deletion order.
            user = db.scalar(select(User).where(User.id == candidate.user_id).with_for_update())
            if user is None:
                continue
            job = db.scalar(
                select(EmailJob)
                .where(
                    EmailJob.id == identifier, EmailJob.sent_at.is_(None), EmailJob.due_at <= now()
                )
                .with_for_update(skip_locked=True)
            )
            if job is None:
                continue
            if not user.email:
                db.delete(job)
                continue
            try:
                payload = json.loads(cipher().decrypt(job.encrypted_payload.encode()))
                message = EmailMessage()
                message["From"] = settings.smtp_from
                message["To"] = user.email
                message["Subject"] = payload["subject"]
                message["Message-ID"] = f"<{job.id}@{message_domain()}>"
                message.set_content(payload["body"])
                smtp_class = smtplib.SMTP_SSL if settings.smtp_ssl else smtplib.SMTP
                with smtp_class(settings.smtp_host, settings.smtp_port, timeout=15) as smtp:
                    if settings.smtp_starttls:
                        smtp.starttls()
                    if settings.smtp_username:
                        smtp.login(settings.smtp_username, settings.smtp_password)
                    smtp.send_message(message)
            except (smtplib.SMTPException, OSError, InvalidToken, ValueError, KeyError):
                job.attempts += 1
                job.due_at = now() + timedelta(seconds=min(3600, 30 * 2**job.attempts))
                logger.warning("Échec d’envoi, tâche %s, tentative %s", job.id, job.attempts)
            else:
                job.sent_at = now()
                job.encrypted_payload = ""
                sent += 1
    return sent


def process_ffvb() -> int:
    checked = 0
    with SessionFactory() as db:
        identifiers = list(
            db.scalars(
                select(FFVBSource.id)
                .where(FFVBSource.enabled.is_(True), FFVBSource.next_check_at <= now())
                .order_by(FFVBSource.next_check_at)
                .limit(20)
            )
        )
    with httpx.Client() as client:
        for identifier in identifiers:
            try:
                with SessionFactory.begin() as db:
                    if not db.scalar(text("SELECT pg_try_advisory_xact_lock(781012)")):
                        continue
                    source = db.get(FFVBSource, identifier)
                    if source is not None and source.enabled and source.next_check_at <= now():
                        if sync_source(db, source, client):
                            checked += 1
            except Exception:
                logger.warning("Échec de synchronisation, source %s ; reprise différée", identifier)
                with SessionFactory.begin() as db:
                    source = db.get(FFVBSource, identifier)
                    if source is not None:
                        source.last_error = (
                            "Synchronisation interrompue ; prochaine tentative différée"
                        )
                        source.next_check_at = now() + timedelta(minutes=source.interval_minutes)
    return checked


def cleanup_expired() -> None:
    with SessionFactory.begin() as db:
        db.execute(delete(LoginSession).where(LoginSession.expires_at <= now()))
        db.execute(delete(AuthToken).where(AuthToken.expires_at <= now()))
        db.execute(delete(RateBucket).where(RateBucket.expires_at <= now()))
        db.execute(delete(EmailJob).where(EmailJob.sent_at < now() - timedelta(days=7)))


def privacy() -> None:
    """Remise à zéro des licences au 1er août et durées de conservation RGPD."""
    from app.services.privacy import apply_retention, reset_licenses

    with SessionFactory.begin() as db:
        if reset_licenses(db):
            logger.info("Licences remises à zéro pour la nouvelle saison")
    with SessionFactory.begin() as db:
        erased = apply_retention(db)
        if erased:
            logger.info("%s compte(s) inactif(s) effacé(s)", erased)


def stop(signum: int, frame: FrameType | None) -> None:
    global _stopping
    _stopping = True


def run_cycle() -> None:
    for operation in (process_ffvb, process_emails, cleanup_expired, privacy):
        try:
            operation()
        except Exception:
            logger.error("Tâche %s échouée ; reprise au prochain passage", operation.__name__)


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    while not _stopping:
        run_cycle()
        for _ in range(settings.worker_poll_seconds):
            if _stopping:
                break
            time.sleep(1)


if __name__ == "__main__":
    main()
