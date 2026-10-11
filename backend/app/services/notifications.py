import json
from zoneinfo import ZoneInfo

from sqlalchemy import false, or_, select
from sqlalchemy.orm import Session

from app.core.security import cipher, now
from app.persistence.models import (
    Assignment,
    AvailabilityBlock,
    EmailJob,
    Event,
    Follow,
    Notification,
    QuestionMessage,
    QuestionThread,
    Registration,
    User,
)

PARIS = ZoneInfo("Europe/Paris")


def email(db: Session, user: User, key: str, subject: str, body: str) -> None:
    if not user.email or db.scalar(
        select(EmailJob.id).where(EmailJob.user_id == user.id, EmailJob.dedupe_key == key)
    ):
        return
    payload = cipher().encrypt(json.dumps({"subject": subject, "body": body}).encode()).decode()
    db.add(EmailJob(user_id=user.id, dedupe_key=key, encrypted_payload=payload))


def notify(
    db: Session,
    user: User,
    key: str,
    kind: str,
    title: str,
    event_id: str | None = None,
    send_email: bool = True,
    body: str = "",
    link: str | None = None,
) -> None:
    if not user.active:
        return
    if db.scalar(
        select(Notification.id).where(
            Notification.user_id == user.id, Notification.dedupe_key == key
        )
    ):
        return
    db.add(
        Notification(
            user_id=user.id,
            dedupe_key=key,
            kind=kind,
            title=title[:200],
            body=body,
            link=link,
            event_id=event_id,
        )
    )
    if send_email:
        email(db, user, key, title, f"{title}\n\n{body}" if body else title)


def admins(
    db: Session,
    key: str,
    kind: str,
    title: str,
    event_id: str | None = None,
    link: str | None = None,
) -> None:
    for user in db.scalars(select(User).where(User.active.is_(True))):
        if "admin" in user.roles:
            notify(db, user, key, kind, title, event_id, user.admin_email, link=link)


def resolve_admin_alerts(db: Session, key: str) -> None:
    """Une demande traitée par un admin disparaît des notifications de tous les admins."""
    for notification in db.scalars(
        select(Notification).where(Notification.dedupe_key == key, Notification.read_at.is_(None))
    ):
        notification.read_at = now()


def thread_link(thread_id: str) -> str:
    return f"/app/messagerie?thread={thread_id}"


def decision_message(
    db: Session,
    recipients: set[str | None],
    key: str,
    title: str,
    reason: str,
    event_id: str | None,
    actor: User,
    subject: str = "",
    kind: str = "decision",
) -> None:
    """Écrit la décision et le message de l’admin dans la messagerie du référent.

    Le fil est celui de l’événement, ou un nouveau fil à sujet s’il n’y a pas d’événement ;
    la notification y renvoie.
    """
    text = f"{title}\n\n{reason}" if reason else title
    for identifier in recipients - {None, actor.id}:
        user = db.get(User, identifier)
        if user is None or not user.active:
            continue
        thread = (
            db.scalar(
                select(QuestionThread).where(
                    QuestionThread.user_id == user.id, QuestionThread.event_id == event_id
                )
            )
            if event_id
            else None
        )
        if thread is None:
            thread = QuestionThread(user_id=user.id, event_id=event_id, subject=subject[:200])
            db.add(thread)
            db.flush()
        db.add(QuestionMessage(thread_id=thread.id, author_id=actor.id, body=text))
        notify(
            db,
            user,
            key,
            kind,
            title,
            event_id,
            user.referent_email,
            body=reason,
            link=thread_link(thread.id),
        )


def concerned(db: Session, event: Event) -> set[str]:
    """Comptes qui suivent l’événement ou sa série, ou y sont inscrits."""
    followed = set(
        db.scalars(
            select(Follow.user_id).where(
                or_(
                    Follow.event_id == event.id,
                    Follow.series_id == event.series_id if event.series_id else false(),
                )
            )
        )
    )
    return followed | set(
        db.scalars(select(Registration.user_id).where(Registration.event_id == event.id))
    )


def event_unavailable(db: Session, event: Event, block: AvailabilityBlock) -> None:
    """Annulation due à une indisponibilité : référent, équipes organisatrices et inscrits."""
    members = (
        set(db.scalars(select(Assignment.user_id).where(Assignment.team_id.in_(event.team_ids))))
        if event.team_ids
        else set()
    )
    registered = set(
        db.scalars(select(Registration.user_id).where(Registration.event_id == event.id))
    )
    recipients = members | registered | ({event.referent_id} if event.referent_id else set())
    day = event.starts_at.astimezone(PARIS).strftime("%d/%m/%Y")
    for user in db.scalars(select(User).where(User.id.in_(recipients))):
        notify(
            db,
            user,
            f"unavailable:{event.id}:{event.version}",
            "event_cancelled",
            f"Événement annulé : {event.title} du {day}",
            event.id,
            user.followed_email or (user.id == event.referent_id and user.referent_email),
            body=f"Le gymnase est indisponible sur ce créneau ({block.title}).",
        )


def event_deleted(db: Session, event: Event, actor_id: str | None) -> None:
    # Sans lien vers l’événement : la notification survit à sa suppression.
    recipients = concerned(db, event) | ({event.referent_id} if event.referent_id else set())
    day = event.starts_at.astimezone(PARIS).strftime("%d/%m/%Y")
    for user in db.scalars(select(User).where(User.id.in_(recipients - {actor_id}))):
        email_wanted = user.followed_email or (user.id == event.referent_id and user.referent_email)
        notify(
            db,
            user,
            f"deleted:{event.id}",
            "event_deleted",
            f"Événement supprimé : {event.title} du {day}",
            None,
            email_wanted,
            link="/app/mon-planning",
        )


def event_changed(db: Session, event: Event, actor_id: str | None) -> None:
    followed = set(
        db.scalars(
            select(Follow.user_id).where(
                or_(
                    Follow.event_id == event.id,
                    Follow.series_id == event.series_id if event.series_id else false(),
                )
            )
        )
    )
    # Un inscrit est prévenu comme s’il suivait l’événement.
    followed |= set(
        db.scalars(select(Registration.user_id).where(Registration.event_id == event.id))
    )
    for user in db.scalars(select(User).where(User.active.is_(True))):
        is_ref = user.id == event.referent_id
        is_admin = "admin" in user.roles and actor_id is not None and actor_id != user.id
        if user.id not in followed and not is_ref and not is_admin:
            continue
        send = user.id != actor_id and (
            (user.id in followed and user.followed_email)
            or (is_ref and user.referent_email)
            or (is_admin and user.admin_email)
        )
        notify(
            db,
            user,
            f"event:{event.id}:{event.version}",
            "event_changed",
            f"Événement modifié : {event.title}",
            event.id,
            send,
        )
