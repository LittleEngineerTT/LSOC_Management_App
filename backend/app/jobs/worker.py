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
from app.services.ffvb import results_due, sync_source
from app.services.notifications import EMAIL_SUBJECTS

logger = logging.getLogger(__name__)
# Tentatives d’envoi avant abandon (voir aussi GET /admin/email-jobs?status=failed).
MAX_EMAIL_ATTEMPTS = 8
# Un e-mail abandonné reste ce délai visible des administrateurs, qui peuvent le relancer,
# puis son contenu chiffré (liens d’invitation, de réinitialisation…) est effacé.
FAILED_EMAIL_RETENTION = timedelta(days=30)
# Notifications détaillées dans un e-mail groupé ; les suivantes sont seulement comptées.
EMAIL_LISTED = 20
_stopping = False


def message_domain() -> str:
    """Domaine des Message-ID : celui du frontend, pour ne pas être pris pour du spam."""
    return urlsplit(settings.frontend_url).hostname or "lsoc.local"


def compose(batch: list[EmailJob]) -> tuple[str, str]:
    """Objet et corps d’un envoi : le message tel quel, ou un récapitulatif de la catégorie."""
    payloads = [json.loads(cipher().decrypt(item.encrypted_payload.encode())) for item in batch]
    if len(payloads) == 1:
        return payloads[0]["subject"], payloads[0]["body"]
    template = EMAIL_SUBJECTS.get(batch[0].category or "", "{n} nouvelles notifications")
    subject = template.format(n=len(payloads))
    lines = [f"• {payload['subject']}" for payload in payloads[:EMAIL_LISTED]]
    if len(payloads) > EMAIL_LISTED:
        lines.append(f"… et {len(payloads) - EMAIL_LISTED} autres")
    body = "\n".join(
        [
            f"{subject}.",
            "",
            *lines,
            "",
            f"Le détail est dans vos notifications : {settings.frontend_url}/app",
        ]
    )
    return subject, body


def process_emails(limit: int = 100) -> int:
    sent = 0
    with SessionFactory() as db:
        identifiers = list(
            db.scalars(
                select(EmailJob.id)
                .where(
                    EmailJob.sent_at.is_(None),
                    EmailJob.due_at <= now(),
                    EmailJob.attempts < MAX_EMAIL_ATTEMPTS,
                )
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
            # Les e-mails de même catégorie en attente pour ce compte partent avec lui.
            batch = [job]
            if job.category:
                batch += db.scalars(
                    select(EmailJob)
                    .where(
                        EmailJob.user_id == user.id,
                        EmailJob.category == job.category,
                        EmailJob.sent_at.is_(None),
                        EmailJob.attempts < MAX_EMAIL_ATTEMPTS,
                        EmailJob.id != job.id,
                    )
                    .order_by(EmailJob.due_at, EmailJob.id)
                    .with_for_update(skip_locked=True)
                ).all()
            if not user.email:
                for item in batch:
                    db.delete(item)
                continue
            try:
                subject, body = compose(batch)
                message = EmailMessage()
                message["From"] = settings.smtp_from
                message["To"] = user.email
                message["Subject"] = subject
                message["Message-ID"] = f"<{job.id}@{message_domain()}>"
                message.set_content(body)
                smtp_class = smtplib.SMTP_SSL if settings.smtp_ssl else smtplib.SMTP
                with smtp_class(settings.smtp_host, settings.smtp_port, timeout=15) as smtp:
                    if settings.smtp_starttls:
                        smtp.starttls()
                    if settings.smtp_username:
                        smtp.login(settings.smtp_username, settings.smtp_password)
                    smtp.send_message(message)
            except (smtplib.SMTPException, OSError, InvalidToken, ValueError, KeyError):
                for item in batch:
                    item.attempts += 1
                    item.due_at = now() + timedelta(seconds=min(3600, 30 * 2**item.attempts))
                logger.warning("Échec d’envoi, tâche %s, tentative %s", job.id, job.attempts)
            else:
                for item in batch:
                    item.sent_at = now()
                    item.encrypted_payload = ""
                sent += 1
    return sent


def process_ffvb() -> int:
    checked = 0
    with SessionFactory() as db:
        # Échéance de la source, ou relevé des résultats d’un jour de match à 23 h 59.
        identifiers = [
            source.id
            for source in db.scalars(
                select(FFVBSource)
                .where(FFVBSource.enabled.is_(True))
                .order_by(FFVBSource.next_check_at)
            )
            if source.next_check_at <= now() or results_due(db, source, now())
        ][:20]
    with httpx.Client() as client:
        for identifier in identifiers:
            try:
                with SessionFactory.begin() as db:
                    if not db.scalar(text("SELECT pg_try_advisory_xact_lock(781012)")):
                        continue
                    source = db.get(FFVBSource, identifier)
                    if source is None or not source.enabled:
                        continue
                    results = results_due(db, source, now())
                    if source.next_check_at <= now() or results:
                        if results:
                            # Noté avant la synchronisation : un échec ne la relance pas en boucle.
                            source.results_checked_at = now()
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
                        # Le relevé du jour de match est passé : pas de nouvel essai à chaque tour.
                        source.results_checked_at = now()
    return checked


def cleanup_expired() -> None:
    with SessionFactory.begin() as db:
        db.execute(delete(LoginSession).where(LoginSession.expires_at <= now()))
        db.execute(delete(AuthToken).where(AuthToken.expires_at <= now()))
        db.execute(delete(RateBucket).where(RateBucket.expires_at <= now()))
        db.execute(delete(EmailJob).where(EmailJob.sent_at < now() - timedelta(days=7)))
        db.execute(
            delete(EmailJob).where(
                EmailJob.sent_at.is_(None),
                EmailJob.attempts >= MAX_EMAIL_ATTEMPTS,
                EmailJob.due_at < now() - FAILED_EMAIL_RETENTION,
            )
        )


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
