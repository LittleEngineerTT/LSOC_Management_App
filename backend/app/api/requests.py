"""Liste unique des demandes aux administrateurs, quel que soit leur type.

Les demandes de modification (ChangeRequest) et de créneau (CoachEventRequest) gardent leur
circuit de validation ; les demandes de pièces et les demandes libres (StaffRequest) se
décident ici. Chaque demande libre ou de pièces a sa conversation dans la messagerie.
"""

from typing import Literal

from fastapi import APIRouter, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.common import DB, Actor, Admin, get
from app.api.dossiers import check_scope, piece, request_documents
from app.api.schemas import (
    RequestDecisionInput,
    RequestedDocument,
    RequestView,
    StaffRequestInput,
)
from app.core.security import now
from app.persistence.models import (
    ChangeRequest,
    CoachEventRequest,
    Event,
    QuestionMessage,
    QuestionThread,
    StaffRequest,
    User,
)
from app.services.notifications import admins, notify, resolve_admin_alerts, thread_link

router = APIRouter(tags=["Demandes"])

Status = Literal["pending", "accepted", "rejected", "withdrawn", ""]


def alert_key(value: StaffRequest) -> str:
    return f"staff-request:{value.id}"


def staff_view(value: StaffRequest) -> RequestView:
    return RequestView.model_validate(
        {
            "id": value.id,
            "kind": value.kind,
            "title": value.title,
            "description": value.description,
            "event_id": value.event_id,
            "actor_id": value.actor_id,
            "actor_name": value.actor_name,
            "status": value.status,
            "decision": value.decision,
            "decider_name": value.decider_name,
            "decided_at": value.decided_at,
            "created_at": value.created_at,
            "thread_id": value.thread_id,
            "player_id": value.player_id,
            "documents": value.documents,
            "link": thread_link(value.thread_id) if value.thread_id else "/app/messagerie",
        }
    )


def change_view(value: ChangeRequest, title: str) -> RequestView:
    return RequestView.model_validate(
        {
            "id": value.id,
            "kind": "event_change",
            "title": f"Modification : {title}",
            "description": value.description,
            "event_id": value.event_id,
            "actor_id": value.actor_id,
            "actor_name": value.actor_name,
            "status": value.status,
            "decision": value.decision,
            "decider_name": value.decider_name,
            "decided_at": value.decided_at,
            "created_at": value.created_at,
            "link": f"/app/administration?tab=requests&demande={value.id}",
        }
    )


def slot_view(value: CoachEventRequest) -> RequestView:
    return RequestView.model_validate(
        {
            "id": value.id,
            "kind": "slot",
            "title": f"Créneau : {value.proposal.get('title', '')}",
            "description": value.note,
            "event_id": value.event_id,
            "actor_id": value.actor_id,
            "actor_name": value.actor_name,
            "status": value.status,
            "decision": value.decision,
            "decider_name": value.decider_name,
            "decided_at": value.decided_at,
            "created_at": value.created_at,
            "link": f"/app/administration?tab=requests&type=events&demande={value.id}",
        }
    )


def require_staff(actor: User) -> None:
    if not {"admin", "coach"} & set(actor.roles):
        raise HTTPException(403, "Demandes réservées aux coachs et aux administrateurs")


def conversation(db: Session, actor: User, event: Event | None, subject: str) -> QuestionThread:
    """Fil du demandeur : celui de l’événement s’il existe déjà, sinon un nouveau fil à sujet."""
    thread = (
        db.scalar(
            select(QuestionThread).where(
                QuestionThread.user_id == actor.id, QuestionThread.event_id == event.id
            )
        )
        if event
        else None
    )
    if thread is None:
        thread = QuestionThread(
            user_id=actor.id, event_id=event.id if event else None, subject=subject[:200]
        )
        db.add(thread)
        db.flush()
    return thread


@router.get("/requests", response_model=list[RequestView])
def requests(db: DB, actor: Actor, status: Status = "") -> list[RequestView]:
    """Toutes les demandes pour un administrateur ; les siennes pour les autres comptes."""
    admin = "admin" in actor.roles
    staff = select(StaffRequest)
    changes = select(ChangeRequest, Event.title).join(Event, Event.id == ChangeRequest.event_id)
    slots = select(CoachEventRequest)
    if not admin:
        staff = staff.where(StaffRequest.actor_id == actor.id)
        changes = changes.where(ChangeRequest.actor_id == actor.id)
        slots = slots.where(CoachEventRequest.actor_id == actor.id)
    if status:
        staff = staff.where(StaffRequest.status == status)
        changes = changes.where(ChangeRequest.status == status)
        slots = slots.where(CoachEventRequest.status == status)
    result = [staff_view(value) for value in db.scalars(staff)]
    result += [change_view(value, title) for value, title in db.execute(changes).tuples()]
    result += [slot_view(value) for value in db.scalars(slots)]
    return sorted(result, key=lambda item: item.created_at, reverse=True)


@router.post("/requests", response_model=RequestView, status_code=201)
def create(body: StaffRequestInput, db: DB, actor: Actor) -> RequestView:
    """Demande de pièces à obtenir d’un joueur, ou demande libre, depuis un événement ou non."""
    require_staff(actor)
    event = get(db, Event, body.event_id) if body.event_id else None
    title = body.title.strip()
    player: User | None = None
    if body.kind == "document":
        if not body.player_id or not body.documents:
            raise HTTPException(422, "Choisissez le joueur et au moins une pièce")
        player = get(db, User, body.player_id)
        check_scope(db, actor, player.id)
        for item in body.documents:
            if (item.kind == "other") != bool(item.label.strip()):
                raise HTTPException(422, "Nommez chaque pièce « Autre », et seulement celles-là")
        title = title or f"Pièces à demander à {player.first_name}"
    elif not title:
        raise HTTPException(422, "Donnez un titre à la demande")
    elif body.player_id or body.documents:
        raise HTTPException(422, "Joueur et pièces sont réservés aux demandes de pièces")
    thread = conversation(db, actor, event, title)
    lines = [title]
    if player is not None:
        lines.append(", ".join(piece(item) for item in body.documents))
    if body.description:
        lines.append(body.description)
    db.add(QuestionMessage(thread_id=thread.id, author_id=actor.id, body="\n\n".join(lines)))
    value = StaffRequest(
        kind=body.kind,
        title=title,
        description=body.description,
        event_id=event.id if event else None,
        actor_id=actor.id,
        actor_name=actor.first_name,
        player_id=player.id if player else None,
        documents=[item.model_dump() for item in body.documents],
        thread_id=thread.id,
    )
    db.add(value)
    db.flush()
    admins(
        db,
        alert_key(value),
        "staff_request",
        f"Demande de {actor.first_name} : {title}",
        event.id if event else None,
        link=thread_link(thread.id),
    )
    return staff_view(value)


@router.post("/requests/{request_id}/decision", response_model=RequestView)
def decide(request_id: str, body: RequestDecisionInput, db: DB, actor: Admin) -> RequestView:
    value = db.scalar(select(StaffRequest).where(StaffRequest.id == request_id).with_for_update())
    if value is None:
        raise HTTPException(404, "Demande introuvable")
    if value.status != "pending":
        raise HTTPException(409, "Demande déjà traitée")
    if body.accept and value.kind == "document":
        if value.player_id is None:
            raise HTTPException(409, "Le joueur n’existe plus")
        documents = [RequestedDocument.model_validate(item) for item in value.documents]
        request_documents(db, actor, get(db, User, value.player_id), documents, False)
    value.status = "accepted" if body.accept else "rejected"
    value.decision = body.reason
    value.decided_by = actor.id
    value.decider_name = actor.first_name
    value.decided_at = now()
    resolve_admin_alerts(db, alert_key(value))
    title = f"Demande {'acceptée' if body.accept else 'refusée'} : {value.title}"
    text = f"{title}\n\n{body.reason}" if body.reason else title
    if value.thread_id:
        db.add(QuestionMessage(thread_id=value.thread_id, author_id=actor.id, body=text))
    requester = db.get(User, value.actor_id) if value.actor_id else None
    if requester is not None and requester.id != actor.id:
        notify(
            db,
            requester,
            f"staff-request-decided:{value.id}",
            "request_decided",
            title,
            value.event_id,
            requester.referent_email,
            body=body.reason,
            link=thread_link(value.thread_id) if value.thread_id else None,
        )
    db.flush()
    return staff_view(value)


@router.post("/requests/{request_id}/withdraw", response_model=RequestView)
def withdraw(request_id: str, db: DB, actor: Actor) -> RequestView:
    value = get(db, StaffRequest, request_id)
    if value.actor_id != actor.id:
        raise HTTPException(403, "Seul le demandeur retire sa demande")
    if value.status != "pending":
        raise HTTPException(409, "Demande déjà traitée")
    value.status = "withdrawn"
    resolve_admin_alerts(db, alert_key(value))
    db.flush()
    return staff_view(value)
