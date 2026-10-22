import json
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import event as orm_event
from sqlalchemy import false, or_, select
from sqlalchemy.orm import Session, SessionTransaction

from app.core.config import settings
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


# Catégorie d’e-mail de chaque type de notification. Les e-mails d’une même catégorie attendent
# quelques minutes puis partent en un seul message par compte ; le détail reste dans l’application.
EMAIL_CATEGORIES = {
    "capacity_conflict": "capacity",
    "capacity_exceeded": "capacity",
    "event_cancelled": "cancelled",
    "event_changed": "changed",
    "event_deleted": "deleted",
    "change_request": "request",
    "event_request": "request",
    "registration_request": "request",
    "staff_request": "request",
    "decision": "decision",
    "request_decided": "decision",
    "registration_decision": "decision",
    "registration_removed": "registration",
    "question": "question",
    "ffvb_added": "ffvb",
    "ffvb_unmapped": "ffvb",
    "ffvb_missing": "ffvb",
    "ffvb_conflict": "ffvb",
    "grouped": "ffvb",
    "referent_missing": "referent",
    "account_changed": "account",
    "duplicate_user": "account",
    "dossier": "dossier",
    "license": "license",
    "license_renewal": "license",
}
# Objet d’un e-mail groupé, selon sa catégorie ; `{n}` est le nombre de notifications réunies.
EMAIL_SUBJECTS = {
    "capacity": "{n} événements ont une capacité dépassée",
    "cancelled": "{n} événements ont été annulés",
    "changed": "{n} événements ont été modifiés",
    "deleted": "{n} événements ont été supprimés",
    "request": "{n} nouvelles demandes à traiter",
    "decision": "{n} décisions sur vos demandes",
    "registration": "{n} inscriptions retirées",
    "question": "{n} nouvelles questions",
    "ffvb": "{n} alertes du calendrier FFVB",
    "referent": "{n} référents à réattribuer",
    "account": "{n} alertes sur les comptes",
    "dossier": "{n} mises à jour de dossiers",
    "license": "{n} mises à jour de licence",
}


def email(
    db: Session, user: User, key: str, subject: str, body: str, kind: str | None = None
) -> None:
    """Met un e-mail en file ; celui d’une notification attend d’être groupé avec ses pareils."""
    if not user.email or db.scalar(
        select(EmailJob.id).where(EmailJob.user_id == user.id, EmailJob.dedupe_key == key)
    ):
        return
    payload = cipher().encrypt(json.dumps({"subject": subject, "body": body}).encode()).decode()
    category = EMAIL_CATEGORIES.get(kind, kind) if kind else None
    db.add(
        EmailJob(
            user_id=user.id,
            dedupe_key=key,
            encrypted_payload=payload,
            category=category,
            due_at=now() + timedelta(minutes=settings.email_group_minutes) if category else now(),
        )
    )


# Alertes regroupées : (singulier, pluriel, écran du regroupement) par type, du plus urgent au
# moins urgent. Les autres types (modifications, suppressions, annulations, demandes à valider…)
# restent unitaires.
GROUPED = {
    "ffvb_unmapped": (
        "gymnase FFVB à associer",
        "gymnases FFVB à associer",
        "/app/administration?tab=ffvb&vue=mappings",
    ),
    "ffvb_missing": (
        "match FFVB absent",
        "matchs FFVB absents",
        "/app/administration?tab=ffvb&vue=matches",
    ),
    "capacity_conflict": ("dépassement de capacité", "dépassements de capacité", "/app/gymnases"),
    "referent_missing": ("référent à réattribuer", "référents à réattribuer", "/app/planning"),
    "ffvb_added": ("match ajouté", "matchs ajoutés", "/app/planning"),
}
PENDING = "pending_notifications"
GROUP = "notification_group"
# Lignes détaillées dans le corps d’une notification groupée.
LISTED = 10


@dataclass
class Pending:
    key: str
    kind: str
    title: str
    body: str
    link: str | None
    event_id: str | None
    send_email: bool
    label: str


@contextmanager
def grouping(db: Session, key: str, label: str) -> Iterator[None]:
    """Réunit les alertes d’une opération de masse en une notification par compte.

    Hors de ce bloc, les alertes de même type d’une transaction sont déjà réunies entre elles ;
    le bloc réunit aussi des types différents (matchs ajoutés, gymnases à associer…) sous
    `label`.
    """
    previous = db.info.get(GROUP)
    db.info[GROUP] = (key, label)
    try:
        yield
    finally:
        db.info[GROUP] = previous


def write(db: Session, user: User, item: Pending) -> None:
    db.add(
        Notification(
            user_id=user.id,
            dedupe_key=item.key,
            kind=item.kind,
            title=item.title[:200],
            body=item.body,
            link=item.link,
            event_id=item.event_id,
        )
    )
    if item.send_email:
        body = f"{item.title}\n\n{item.body}" if item.body else item.title
        email(db, user, item.key, item.title, body, item.kind)


def summary(items: list[Pending]) -> Pending:
    """Notification unique d’un regroupement : décompte par type et détail des premières."""
    kinds = sorted({item.kind for item in items}, key=list(GROUPED).index)
    counts = []
    for kind in kinds:
        count = sum(item.kind == kind for item in items)
        one, many, _ = GROUPED[kind]
        counts.append(f"{count} {one if count == 1 else many}")
    label = items[0].label
    title = f"{label} : {', '.join(counts)}" if label else ", ".join(counts)
    lines = [f"• {item.title}" for item in items[:LISTED]]
    if len(items) > LISTED:
        lines.append(f"… et {len(items) - LISTED} autres")
    links = {item.link for item in items}
    return Pending(
        key=f"group:{items[0].key}"[:200],
        kind=kinds[0] if len(kinds) == 1 else "grouped",
        title=title,
        body="\n".join(lines),
        # L’écran commun à toutes, sinon celui du type le plus urgent.
        link=links.pop() if len(links) == 1 and None not in links else GROUPED[kinds[0]][2],
        event_id=None,
        send_email=any(item.send_email for item in items),
        label=label,
    )


@orm_event.listens_for(Session, "before_commit")
def emit_pending(db: Session) -> None:
    """Écrit, juste avant la validation, les alertes mises de côté par `notify`."""
    pending: dict[tuple[str, str], list[Pending]] = db.info.pop(PENDING, {})
    for (user_id, _), items in pending.items():
        user = db.get(User, user_id)
        # Compte supprimé ou désactivé pendant la transaction.
        if user is None or not user.active:
            continue
        if len(items) > 1:
            write(db, user, summary(items))
            continue
        item = items[0]
        if item.event_id and db.get(Event, item.event_id) is None:
            # Événement supprimé depuis l’alerte : elle reste, sans lien vers lui.
            item.event_id = None
        write(db, user, item)


@orm_event.listens_for(Session, "after_soft_rollback")
def drop_pending(db: Session, previous: SessionTransaction) -> None:
    db.info.pop(PENDING, None)


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
    pending: dict[tuple[str, str], list[Pending]] = db.info.setdefault(PENDING, {})
    if db.scalar(
        select(Notification.id).where(
            Notification.user_id == user.id, Notification.dedupe_key == key
        )
    ) or any(
        item.key == key
        for (owner, _), items in pending.items()
        if owner == user.id
        for item in items
    ):
        return
    group, label = db.info.get(GROUP) or (kind, "")
    item = Pending(key, kind, title, body, link, event_id, bool(send_email), label)
    if kind not in GROUPED:
        write(db, user, item)
        return
    # Mise de côté jusqu’à la validation, pour être réunie aux alertes semblables.
    pending.setdefault((user.id, group), []).append(item)


def admins(
    db: Session,
    key: str,
    kind: str,
    title: str,
    event_id: str | None = None,
    link: str | None = None,
    body: str = "",
) -> None:
    for user in db.scalars(select(User).where(User.active.is_(True))):
        if "admin" in user.roles:
            notify(db, user, key, kind, title, event_id, user.admin_email, body=body, link=link)


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


def active_referents(db: Session, ids: list[str]) -> list[User]:
    """Comptes actifs parmi des référents, dans l’ordre de la liste."""
    users = {user.id: user for user in db.scalars(select(User).where(User.id.in_(ids)))}
    return [users[i] for i in ids if i in users and users[i].active]


def registered_users(db: Session, event: Event) -> set[str]:
    """Inscrits et demandes en attente : une demande refusée ne rend plus concerné."""
    return set(
        db.scalars(
            select(Registration.user_id).where(
                Registration.event_id == event.id, Registration.status != "rejected"
            )
        )
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
    return followed | registered_users(db, event)


def event_unavailable(db: Session, event: Event, block: AvailabilityBlock) -> None:
    """Annulation due à une indisponibilité : référent, équipes organisatrices et inscrits."""
    members = (
        set(db.scalars(select(Assignment.user_id).where(Assignment.team_id.in_(event.team_ids))))
        if event.team_ids
        else set()
    )
    registered = registered_users(db, event)
    recipients = members | registered | set(event.referent_ids)
    day = event.starts_at.astimezone(PARIS).strftime("%d/%m/%Y")
    for user in db.scalars(select(User).where(User.id.in_(recipients))):
        notify(
            db,
            user,
            f"unavailable:{event.id}:{event.version}",
            "event_cancelled",
            f"Événement annulé : {event.title} du {day}",
            event.id,
            user.followed_email or (user.id in event.referent_ids and user.referent_email),
            body=f"Le gymnase est indisponible sur ce créneau ({block.title}).",
        )


def ffvb_added(db: Session, event: Event) -> None:
    """Match importé d’une source FFVB : ses référents et les admins sont prévenus.

    Les matchs d’une même synchronisation sont réunis en une notification par compte.
    """
    day = event.starts_at.astimezone(PARIS).strftime("%d/%m/%Y")
    for user in db.scalars(select(User).where(User.active.is_(True))):
        is_ref = user.id in event.referent_ids
        is_admin = "admin" in user.roles
        if not is_ref and not is_admin:
            continue
        notify(
            db,
            user,
            f"ffvb-added:{event.id}",
            "ffvb_added",
            f"Match ajouté : {event.title} du {day}",
            event.id,
            (is_ref and user.referent_email) or (is_admin and user.admin_email),
        )


def event_deleted(db: Session, event: Event, actor_id: str | None) -> None:
    # Sans lien vers l’événement : la notification survit à sa suppression.
    recipients = concerned(db, event) | set(event.referent_ids)
    day = event.starts_at.astimezone(PARIS).strftime("%d/%m/%Y")
    for user in db.scalars(select(User).where(User.id.in_(recipients - {actor_id}))):
        email_wanted = user.followed_email or (
            user.id in event.referent_ids and user.referent_email
        )
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


def changed_recipients(db: Session, event: Event, actor_id: str | None) -> dict[str, bool]:
    """Destinataires d’une modification, avec l’envoi ou non d’un e-mail à chacun."""
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
    followed |= registered_users(db, event)
    recipients: dict[str, bool] = {}
    for user in db.scalars(select(User).where(User.active.is_(True))):
        is_ref = user.id in event.referent_ids
        is_admin = "admin" in user.roles and actor_id is not None and actor_id != user.id
        if user.id not in followed and not is_ref and not is_admin:
            continue
        recipients[user.id] = user.id != actor_id and bool(
            (user.id in followed and user.followed_email)
            or (is_ref and user.referent_email)
            or (is_admin and user.admin_email)
        )
    return recipients


def event_changed(db: Session, event: Event, actor_id: str | None) -> None:
    for user_id, send in changed_recipients(db, event, actor_id).items():
        notify(
            db,
            db.get_one(User, user_id),
            f"event:{event.id}:{event.version}",
            "event_changed",
            f"Événement modifié : {event.title}",
            event.id,
            send,
        )


def series_changed(db: Session, events: list[Event], actor_id: str | None) -> None:
    """Une seule notification par compte pour une modification de série.

    Chaque compte concerné par au moins une occurrence modifiée est prévenu une fois, par
    e-mail si l’une d’elles le justifie ; la notification ouvre la première occurrence.
    """
    if not events:
        return
    recipients: dict[str, bool] = {}
    for event in events:
        for user_id, send in changed_recipients(db, event, actor_id).items():
            recipients[user_id] = recipients.get(user_id, False) or send
    first = events[0]
    for user_id, send in recipients.items():
        notify(
            db,
            db.get_one(User, user_id),
            f"series:{first.series_id}:{first.id}:{first.version}",
            "event_changed",
            f"La série d’événements {first.title} a été modifiée",
            first.id,
            send,
        )
