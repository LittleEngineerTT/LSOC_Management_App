import json

from sqlalchemy import false, or_, select
from sqlalchemy.orm import Session

from app.core.security import cipher
from app.persistence.models import EmailJob, Event, Follow, Notification, User


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
            user_id=user.id, dedupe_key=key, kind=kind, title=title[:200], event_id=event_id
        )
    )
    if send_email:
        email(db, user, key, title, title)


def admins(db: Session, key: str, kind: str, title: str, event_id: str | None = None) -> None:
    for user in db.scalars(select(User).where(User.active.is_(True))):
        if "admin" in user.roles:
            notify(db, user, key, kind, title, event_id, user.admin_email)


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
