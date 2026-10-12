"""RGPD : durées de conservation et remise à zéro annuelle des licences."""

from datetime import date, datetime, timedelta

from sqlalchemy import delete, func, select, update
from sqlalchemy.orm import Session

from app.core.security import now
from app.integrations import s3
from app.persistence.models import (
    ChangeRequest,
    CoachEventRequest,
    Event,
    EventRevision,
    License,
    Notification,
    QuestionMessage,
    QuestionThread,
    Registration,
    User,
)
from app.services.events import PARIS
from app.services.ffvb import defaults
from app.services.notifications import notify

# Durées affichées dans la politique de confidentialité : les deux doivent rester alignées.
NOTIFICATION_DAYS = 183  # notifications lues : 6 mois
HISTORY_DAYS = 730  # messages, historique, demandes traitées, inscriptions : 2 ans
INACTIVE_ACCOUNT_DAYS = 730  # compte sans activité : 2 ans


def season_start(today: date) -> date:
    """1er août de la saison en cours."""
    return date(today.year if today >= date(today.year, 8, 1) else today.year - 1, 8, 1)


def reset_licenses(db: Session, at: datetime | None = None) -> bool:
    """Au 1er août, toutes les licences sont à refaire : les statuts repartent de zéro.

    Le numéro de licence est conservé : il identifie le compte et ouvre l’accès. Les PDF de
    la saison passée sont supprimés du stockage.
    """
    start = season_start((at or now()).astimezone(PARIS).date())
    club = defaults(db)
    if club.licenses_reset_on is None:
        # Première exécution : la saison en cours ne déclenche pas de remise à zéro.
        club.licenses_reset_on = start
        return False
    if club.licenses_reset_on >= start:
        return False
    licensed = list(
        db.scalars(
            select(User)
            .join(License, License.user_id == User.id)
            .where(License.number.is_not(None))
        )
    )
    files = list(db.scalars(select(License.file_key).where(License.file_key.is_not(None))))
    db.execute(
        update(License).values(
            status="none",
            coach_status="none",
            file_key=None,
            file_uploaded_at=None,
            updated_at=now(),
            updated_by=None,
        )
    )
    for key in files:
        s3.discard(key)
    club.licenses_reset_on = start
    season = f"{start.year}/{start.year + 1}"
    for user in licensed:
        notify(
            db,
            user,
            f"license-season:{start.year}",
            "license_renewal",
            f"Nouvelle saison {season} : renouvelez votre licence",
            body="Les licences sont à refaire chaque saison. Votre numéro et votre compte sont "
            "conservés.",
        )
    return True


def apply_retention(db: Session, at: datetime | None = None) -> int:
    """Purge ce qui a dépassé sa durée de conservation ; renvoie le nombre de comptes effacés."""
    current = at or now()
    history = current - timedelta(days=HISTORY_DAYS)
    db.execute(
        delete(Notification).where(
            Notification.read_at.is_not(None),
            Notification.created_at < current - timedelta(days=NOTIFICATION_DAYS),
        )
    )
    # Une notification jamais lue ne reste pas plus longtemps que l’historique.
    db.execute(delete(Notification).where(Notification.created_at < history))
    stale_threads = (
        select(QuestionMessage.thread_id)
        .group_by(QuestionMessage.thread_id)
        .having(func.max(QuestionMessage.created_at) < history)
    )
    db.execute(delete(QuestionThread).where(QuestionThread.id.in_(stale_threads)))
    db.execute(delete(EventRevision).where(EventRevision.created_at < history))
    for model in (ChangeRequest, CoachEventRequest):
        db.execute(
            delete(model).where(
                model.status != "pending",
                func.coalesce(model.decided_at, model.created_at) < history,
            )
        )
    finished = select(Event.id).where(Event.ends_at < history)
    db.execute(delete(Registration).where(Registration.event_id.in_(finished)))
    return erase_inactive(db, current - timedelta(days=INACTIVE_ACCOUNT_DAYS))


def erase_inactive(db: Session, cutoff: datetime) -> int:
    from app.api.accounts import erase_account

    erased = 0
    for user in db.scalars(select(User).where(User.last_seen_at < cutoff)).all():
        # Un administrateur n’est jamais purgé : son retrait reste une décision du club.
        if "admin" in user.roles:
            continue
        erase_account(db, user)
        erased += 1
    return erased
