from fastapi import APIRouter, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.common import DB, Actor, Admin, get, require_admin
from app.api.schemas import CoachEventRequestInput, CoachEventRequestView, DecisionInput, EventInput
from app.core.security import now
from app.persistence.models import Assignment, CoachEventRequest, Event, Team, User
from app.services.events import create_event, lock_planning, validate_event
from app.services.notifications import admins, notify

router = APIRouter(tags=["Planning"])


def refresh_user(db: Session, actor: User) -> User:
    current = db.scalar(
        select(User).where(User.id == actor.id).execution_options(populate_existing=True)
    )
    if current is None:
        raise HTTPException(401, "Connexion requise")
    return current


def coach_team(db: Session, actor: User, team_id: str) -> Team:
    actor = refresh_user(db, actor)
    if not actor.active or "coach" not in actor.roles:
        raise HTTPException(403, "Un coach actif est requis")
    team = db.scalar(select(Team).where(Team.id == team_id).with_for_update())
    if team is None:
        raise HTTPException(404, "Équipe introuvable")
    if not db.scalar(
        select(Assignment.id).where(
            Assignment.user_id == actor.id,
            Assignment.team_id == team.id,
            Assignment.kind == "coach",
        )
    ):
        raise HTTPException(403, "Demande réservée aux équipes que vous entraînez")
    return team


@router.post("/event-requests", response_model=CoachEventRequestView, status_code=201)
def propose(body: CoachEventRequestInput, db: DB, actor: Actor) -> CoachEventRequest:
    lock_planning(db)
    team = coach_team(db, actor, body.team_id)
    proposal = EventInput(
        **body.model_dump(exclude={"team_id", "note"}),
        section_ids=[team.section_id],
        referent_id=actor.id,
        direct_edit=False,
    )
    # Valider les références et l’ouverture sans insérer d’événement ni réserver de terrain.
    validate_event(db, Event(**proposal.model_dump()))
    value = CoachEventRequest(
        team_id=team.id,
        actor_id=actor.id,
        actor_name=actor.first_name,
        proposal=proposal.model_dump(mode="json"),
        note=body.note,
    )
    db.add(value)
    db.flush()
    admins(db, f"event-request:{value.id}", "event_request", f"Événement à valider : {body.title}")
    notify(
        db,
        actor,
        f"event-request:{value.id}",
        "event_request",
        f"Demande enregistrée : {body.title}",
        send_email=actor.referent_email,
    )
    return value


@router.get("/event-requests", response_model=list[CoachEventRequestView])
def requests(
    db: DB,
    actor: Actor,
    status: str | None = "pending",
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
) -> list[CoachEventRequest]:
    query = select(CoachEventRequest)
    if "admin" not in actor.roles:
        query = query.where(CoachEventRequest.actor_id == actor.id)
    if status:
        query = query.where(CoachEventRequest.status == status)
    return list(
        db.scalars(
            query.order_by(CoachEventRequest.created_at, CoachEventRequest.id)
            .offset(offset)
            .limit(limit)
        )
    )


@router.get("/event-requests/{request_id}", response_model=CoachEventRequestView)
def detail(request_id: str, db: DB, actor: Actor) -> CoachEventRequest:
    value = get(db, CoachEventRequest, request_id)
    if "admin" not in actor.roles and value.actor_id != actor.id:
        raise HTTPException(403, "Demande privée")
    return value


@router.post("/event-requests/{request_id}/decision", response_model=CoachEventRequestView)
def decide(request_id: str, body: DecisionInput, db: DB, actor: Admin) -> CoachEventRequest:
    lock_planning(db)
    actor = refresh_user(db, actor)
    if not actor.active:
        raise HTTPException(401, "Connexion requise")
    require_admin(actor)
    value = db.scalar(
        select(CoachEventRequest).where(CoachEventRequest.id == request_id).with_for_update()
    )
    if value is None:
        raise HTTPException(404, "Demande introuvable")
    if value.status != "pending":
        raise HTTPException(409, "Demande déjà traitée")
    if body.accept:
        if value.actor_id is None or value.team_id is None:
            raise HTTPException(409, "Demande non exécutable")
        requester = get(db, User, value.actor_id)
        team = coach_team(db, requester, value.team_id)
        proposal = EventInput.model_validate(
            value.proposal
            | {
                "section_ids": [team.section_id],
                "referent_id": requester.id,
                "direct_edit": False,
            }
        )
        event = create_event(db, proposal, actor, body.force)
        value.event_id = event.id
    value.status = "accepted" if body.accept else "rejected"
    value.decision = body.reason
    value.decided_by = actor.id
    value.decider_name = actor.first_name
    value.decided_at = now()
    title = f"Demande {'acceptée' if body.accept else 'refusée'} : {value.proposal['title']}"
    key = f"event-request-decided:{value.id}"
    admins(db, key, "event_request_decided", title, value.event_id)
    if value.actor_id is not None:
        requester = get(db, User, value.actor_id)
        notify(
            db,
            requester,
            key,
            "event_request_decided",
            title,
            value.event_id,
            requester.referent_email,
        )
    db.flush()
    return value
