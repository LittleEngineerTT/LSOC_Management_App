from fastapi import APIRouter, HTTPException, Query
from sqlalchemy import ColumnElement, delete, exists, false, func, or_, select, true
from sqlalchemy.orm import Session, aliased

from app.api.common import DB, Actor, Admin, get
from app.api.schemas import (
    EmailJobView,
    FollowView,
    MessageInput,
    MessageView,
    NotificationView,
    ThreadView,
    UnreadView,
)
from app.core.security import now
from app.persistence.models import (
    ContactRequest,
    EmailJob,
    Event,
    EventSeries,
    FFVBSource,
    Follow,
    HiddenThread,
    Notification,
    QuestionMessage,
    QuestionThread,
    StaffRequest,
    Team,
    User,
)
from app.services.notifications import admins, thread_link

router = APIRouter(tags=["Messagerie et suivis"])


def access(thread: QuestionThread, actor: User) -> None:
    if thread.user_id != actor.id and "admin" not in actor.roles:
        raise HTTPException(403, "Conversation privée")


def can_write(thread: QuestionThread, actor: User) -> None:
    access(thread, actor)
    if "admin" not in actor.roles and (not actor.messaging_allowed or "member" not in actor.roles):
        raise HTTPException(403, "Droit de messagerie indisponible")


def visible_to(actor: User) -> ColumnElement[bool]:
    """Fil que le compte n’a pas supprimé, ou qui a reçu un message depuis."""
    later = aliased(QuestionMessage)
    return ~exists(
        select(HiddenThread.id).where(
            HiddenThread.user_id == actor.id,
            HiddenThread.thread_id == QuestionThread.id,
            ~exists(
                select(later.id).where(
                    later.thread_id == QuestionThread.id, later.created_at > HiddenThread.hidden_at
                )
            ),
        )
    )


def unread_for(actor: User) -> ColumnElement[bool]:
    # Pour l’auteur du fil : les réponses reçues ; pour un admin : les messages de l’adhérent.
    received: ColumnElement[bool] = (QuestionThread.user_id == actor.id) & (
        QuestionMessage.author_id != actor.id
    )
    if "admin" in actor.roles:
        received = or_(
            received,
            (QuestionThread.user_id != actor.id)
            & (QuestionMessage.author_id == QuestionThread.user_id),
        )
    return QuestionMessage.read_at.is_(None) & received & visible_to(actor)


def administration_alert(db: Session, actor: User) -> bool:
    """Au moins un point à traiter dans l’administration (administrateurs) : conflit ni résolu
    ni ignoré, source FFVB activée en erreur ou équipe sans source FFVB à configurer."""
    if "admin" not in actor.roles:
        return False
    failing = select(FFVBSource.id).where(
        FFVBSource.enabled.is_(True),
        FFVBSource.last_error.is_not(None),
        FFVBSource.last_error != "",
    )
    missing = select(Team.id).where(
        Team.ffvb_source_warning_ignored.is_(False),
        ~exists(select(FFVBSource.id).where(FFVBSource.team_id == Team.id)),
    )
    if db.scalar(select(exists(failing))) or db.scalar(select(exists(missing))):
        return True
    from app.services.events import event_conflicts

    return any(not item.ignored for item in event_conflicts(db, now()))


def messaging_pending(db: Session, actor: User) -> bool:
    """Au moins une demande en attente de décision, ou, pour un administrateur, une question
    sans réponse : le dernier message vient de l’adhérent. Lue ou non, elle compte jusqu’à sa
    réponse, sa décision ou la suppression de la conversation. Coachs et administrateurs seuls,
    comme l’onglet Demandes."""
    if not {"admin", "coach"} & set(actor.roles):
        return False
    from app.api.requests import requests as listed_requests

    if listed_requests(db, actor, "pending"):
        return True
    if "admin" not in actor.roles:
        return False
    # Auteur du dernier message de chaque fil.
    last_author = (
        select(QuestionMessage.author_id)
        .where(QuestionMessage.thread_id == QuestionThread.id)
        .order_by(QuestionMessage.created_at.desc(), QuestionMessage.id.desc())
        .limit(1)
        .correlate(QuestionThread)
        .scalar_subquery()
    )
    waiting = select(QuestionThread.id).where(
        QuestionThread.user_id != actor.id,
        last_author == QuestionThread.user_id,
        # Conversation d’une demande : sa décision la traite, pas une réponse écrite.
        ~exists(select(StaffRequest.id).where(StaffRequest.thread_id == QuestionThread.id)),
        visible_to(actor),
    )
    return bool(db.scalar(select(exists(waiting))))


@router.get("/unread", response_model=UnreadView)
def unread(db: DB, actor: Actor) -> UnreadView:
    rows = db.execute(
        select(QuestionMessage.thread_id, func.count(QuestionMessage.id))
        .join(QuestionThread, QuestionThread.id == QuestionMessage.thread_id)
        .where(unread_for(actor))
        .group_by(QuestionMessage.thread_id)
        .order_by(QuestionMessage.thread_id)
    )
    counts = {thread_id: count for thread_id, count in rows}
    requests = db.scalar(select(func.count(Notification.id)).where(request_alerts(actor)))
    contacts = (
        db.scalar(select(func.count(ContactRequest.id)).where(ContactRequest.status == "open"))
        if "admin" in actor.roles
        else 0
    )
    notifications = db.scalar(
        select(func.count(Notification.id)).where(
            Notification.user_id == actor.id, Notification.read_at.is_(None)
        )
    )
    return UnreadView(
        messages=sum(counts.values()),
        notifications=notifications or 0,
        threads=list(counts),
        thread_counts=counts,
        requests=requests or 0,
        contacts=contacts or 0,
        administration=administration_alert(db, actor),
        messaging_pending=messaging_pending(db, actor),
    )


# Notifications des demandes suivies dans Messagerie › Demandes : nouvelles demandes à décider
# ou à suivre, et décisions rendues.
REQUEST_KINDS = (
    "change_request",
    "event_request",
    "registration_request",
    "staff_request",
    "request_decided",
    "registration_decision",
    "decision",
)


def request_alerts(actor: User) -> ColumnElement[bool]:
    """Notifications de demandes non lues du compte, pour les coachs et administrateurs seuls :
    eux seuls ont l’onglet Demandes. Celles qui mènent à un fil de discussion sont exclues, le
    message écrit dans le fil comptant déjà parmi les non lus."""
    if not {"admin", "coach"} & set(actor.roles):
        return false()
    return (
        (Notification.user_id == actor.id)
        & Notification.read_at.is_(None)
        & Notification.kind.in_(REQUEST_KINDS)
        & or_(Notification.link.is_(None), Notification.link.not_like("/app/messagerie?thread=%"))
    )


@router.get("/follows", response_model=list[FollowView])
def follows(db: DB, actor: Actor) -> list[Follow]:
    return list(db.scalars(select(Follow).where(Follow.user_id == actor.id)))


@router.post("/events/{event_id}/follow", response_model=FollowView, status_code=201)
def follow_event(event_id: str, db: DB, actor: Actor) -> Follow:
    get(db, Event, event_id)
    existing = db.scalar(
        select(Follow).where(Follow.user_id == actor.id, Follow.event_id == event_id)
    )
    if existing:
        return existing
    value = Follow(user_id=actor.id, event_id=event_id)
    db.add(value)
    db.flush()
    return value


@router.delete("/events/{event_id}/follow", status_code=204)
def unfollow_event(event_id: str, db: DB, actor: Actor) -> None:
    db.execute(delete(Follow).where(Follow.user_id == actor.id, Follow.event_id == event_id))


@router.post("/series/{series_id}/follow", response_model=FollowView, status_code=201)
def follow_series(series_id: str, db: DB, actor: Actor) -> Follow:
    get(db, EventSeries, series_id)
    existing = db.scalar(
        select(Follow).where(Follow.user_id == actor.id, Follow.series_id == series_id)
    )
    if existing:
        return existing
    value = Follow(user_id=actor.id, series_id=series_id)
    db.add(value)
    db.flush()
    return value


@router.delete("/series/{series_id}/follow", status_code=204)
def unfollow_series(series_id: str, db: DB, actor: Actor) -> None:
    db.execute(delete(Follow).where(Follow.user_id == actor.id, Follow.series_id == series_id))


@router.post("/events/{event_id}/questions", response_model=ThreadView, status_code=201)
def new_question(event_id: str, body: MessageInput, db: DB, actor: Actor) -> QuestionThread:
    get(db, Event, event_id)
    if "member" not in actor.roles or not actor.messaging_allowed:
        raise HTTPException(403, "Droit de messagerie indisponible")
    thread = db.scalar(
        select(QuestionThread).where(
            QuestionThread.event_id == event_id, QuestionThread.user_id == actor.id
        )
    )
    if thread is None:
        thread = QuestionThread(event_id=event_id, user_id=actor.id)
        db.add(thread)
        db.flush()
    post_message(thread.id, body, db, actor)
    return thread


@router.get("/questions", response_model=list[ThreadView])
def questions(
    db: DB,
    actor: Actor,
    event_id: str | None = None,
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
) -> list[QuestionThread]:
    query = select(QuestionThread).where(visible_to(actor))
    if "admin" not in actor.roles:
        query = query.where(QuestionThread.user_id == actor.id)
    if event_id:
        query = query.where(QuestionThread.event_id == event_id)
    return list(db.scalars(query.order_by(QuestionThread.id).offset(offset).limit(limit)))


@router.get("/questions/{thread_id}/messages", response_model=list[MessageView])
def messages(
    thread_id: str,
    db: DB,
    actor: Actor,
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
) -> list[QuestionMessage]:
    thread = get(db, QuestionThread, thread_id)
    access(thread, actor)
    return list(
        db.scalars(
            select(QuestionMessage)
            .where(QuestionMessage.thread_id == thread_id)
            .order_by(QuestionMessage.created_at, QuestionMessage.id)
            .offset(offset)
            .limit(limit)
        )
    )


@router.post("/questions/{thread_id}/messages", response_model=MessageView, status_code=201)
def post_message(thread_id: str, body: MessageInput, db: DB, actor: Actor) -> QuestionMessage:
    thread = get(db, QuestionThread, thread_id)
    can_write(thread, actor)
    value = QuestionMessage(thread_id=thread_id, author_id=actor.id, body=body.body)
    # Répondre dans un fil vaut lecture des messages reçus.
    read_messages(db, actor, thread_id)
    db.add(value)
    db.flush()
    if actor.id == thread.user_id:
        subject = get(db, Event, thread.event_id).title if thread.event_id else thread.subject
        admins(
            db,
            f"question:{value.id}",
            "question",
            f"Question sur : {subject}",
            thread.event_id,
            link=thread_link(thread.id),
        )
    return value


@router.post("/questions/{thread_id}/read", status_code=204)
def mark_thread_read(thread_id: str, db: DB, actor: Actor) -> None:
    thread = get(db, QuestionThread, thread_id)
    access(thread, actor)
    read_messages(db, actor, thread_id)


@router.delete("/questions/{thread_id}", status_code=204)
def hide_thread(thread_id: str, db: DB, actor: Actor) -> None:
    """Supprime la conversation de la messagerie du compte, sans l’effacer pour les autres.

    Elle réapparaît si un nouveau message y est écrit.
    """
    thread = get(db, QuestionThread, thread_id)
    access(thread, actor)
    hidden = db.scalar(
        select(HiddenThread).where(
            HiddenThread.user_id == actor.id, HiddenThread.thread_id == thread_id
        )
    )
    if hidden is None:
        db.add(HiddenThread(user_id=actor.id, thread_id=thread_id, hidden_at=now()))
    else:
        hidden.hidden_at = now()
    read_alerts(db, actor, thread_id)


@router.post("/questions/read", status_code=204)
def mark_all_questions_read(db: DB, actor: Actor) -> None:
    # unread_for limite déjà la lecture aux fils accessibles au compte.
    read_messages(db, actor, None)


def read_messages(db: Session, actor: User, thread_id: str | None) -> None:
    """Marque comme lus les messages reçus d’un fil, ou de tous les fils si `thread_id` est nul."""
    scope = true() if thread_id is None else QuestionMessage.thread_id == thread_id
    # Un admin ne marque lus que les messages de l’adhérent : la réponse d’un autre admin
    # doit rester non lue pour l’adhérent.
    for message in db.scalars(
        select(QuestionMessage)
        .join(QuestionThread, QuestionThread.id == QuestionMessage.thread_id)
        .where(scope, unread_for(actor))
    ):
        message.read_at = now()
    # Les alertes « nouvelle question » du fil deviennent lues elles aussi, même si un autre
    # admin avait déjà lu les messages.
    read_alerts(db, actor, thread_id)


def read_alerts(db: Session, actor: User, thread_id: str | None) -> None:
    """Alertes du compte sur les nouvelles questions et décisions écrites dans ces fils."""
    alerts = select(Notification).where(
        Notification.user_id == actor.id,
        Notification.read_at.is_(None),
        or_(Notification.kind == "question", Notification.link.like("/app/messagerie?thread=%")),
    )
    if thread_id is not None:
        keys = [
            f"question:{identifier}"
            for identifier in db.scalars(
                select(QuestionMessage.id).where(QuestionMessage.thread_id == thread_id)
            )
        ]
        alerts = alerts.where(
            or_(Notification.dedupe_key.in_(keys), Notification.link == thread_link(thread_id))
        )
    for notification in db.scalars(alerts):
        notification.read_at = now()


@router.get("/notifications", response_model=list[NotificationView])
def notifications(
    db: DB,
    actor: Actor,
    unread_only: bool = False,
    unread_first: bool = False,
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
) -> list[Notification]:
    """Notifications du compte, des plus récentes aux plus anciennes ; `unread_first` place
    d’abord les non lues, pour le panneau du bandeau qui n’en montre que les dernières."""
    query = select(Notification).where(Notification.user_id == actor.id)
    if unread_only:
        query = query.where(Notification.read_at.is_(None))
    # Faux avant vrai : les non lues remontent en tête.
    first: tuple[ColumnElement[bool], ...] = (
        (Notification.read_at.is_not(None),) if unread_first else ()
    )
    return list(
        db.scalars(
            query.order_by(*first, Notification.created_at.desc(), Notification.id)
            .offset(offset)
            .limit(limit)
        )
    )


@router.post("/notifications/{notification_id}/read", response_model=NotificationView)
def mark_read(notification_id: str, db: DB, actor: Actor) -> Notification:
    notification = get(db, Notification, notification_id)
    if notification.user_id != actor.id:
        raise HTTPException(403, "Notification privée")
    notification.read_at = now()
    return notification


@router.delete("/notifications/{notification_id}/read", response_model=NotificationView)
def mark_unread(notification_id: str, db: DB, actor: Actor) -> Notification:
    """Repasse une notification lue en non lue : elle revient en tête du panneau."""
    notification = get(db, Notification, notification_id)
    if notification.user_id != actor.id:
        raise HTTPException(403, "Notification privée")
    notification.read_at = None
    return notification


@router.get("/admin/email-jobs", response_model=list[EmailJobView])
def email_jobs(
    db: DB,
    actor: Admin,
    status: str = "pending",
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
) -> list[EmailJob]:
    query = select(EmailJob)
    if status == "sent":
        query = query.where(EmailJob.sent_at.is_not(None))
    elif status == "failed":
        query = query.where(EmailJob.sent_at.is_(None), EmailJob.attempts >= 8)
    elif status == "pending":
        query = query.where(EmailJob.sent_at.is_(None))
    else:
        raise HTTPException(422, "Statut inconnu")
    return list(db.scalars(query.order_by(EmailJob.due_at).offset(offset).limit(limit)))


@router.post("/admin/email-jobs/{job_id}/retry", response_model=EmailJobView)
def retry_email(job_id: str, db: DB, actor: Admin) -> EmailJob:
    job = get(db, EmailJob, job_id)
    if job.sent_at is not None:
        raise HTTPException(409, "Message déjà envoyé")
    job.attempts, job.due_at = 0, now()
    return job
