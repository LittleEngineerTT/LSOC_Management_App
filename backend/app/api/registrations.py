from fastapi import APIRouter, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.common import DB, Actor, Admin, get
from app.api.schemas import ParticipantView, RegistrationSummary, RegistrationView
from app.core.security import now, token
from app.persistence.models import Assignment, Event, Registration, Team, User
from app.services.events import lock_planning
from app.services.notifications import notify

router = APIRouter(tags=["Inscriptions"])


def eligible(db: Session, event: Event, user: User) -> bool:
    if "member" not in user.roles or not (
        event.registration_section_ids or event.registration_team_ids
    ):
        return False
    assignments = list(
        db.execute(
            select(Team.id, Team.section_id)
            .join(Assignment, Assignment.team_id == Team.id)
            .where(Assignment.user_id == user.id)
        )
    )
    return any(
        team in event.registration_team_ids or section in event.registration_section_ids
        for team, section in assignments
    )


def locked_event(db: Session, event_id: str) -> Event:
    # Le verrou du planning ordonne les inscriptions avec les changements de limite.
    lock_planning(db)
    event = db.scalar(select(Event).where(Event.id == event_id).with_for_update(of=Event))
    if event is None:
        raise HTTPException(404, "Ressource introuvable")
    return event


def own(db: Session, event_id: str, user_id: str) -> Registration | None:
    return db.scalar(
        select(Registration).where(
            Registration.event_id == event_id, Registration.user_id == user_id
        )
    )


@router.get("/registrations", response_model=list[RegistrationView])
def mine(
    db: DB,
    actor: Actor,
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
) -> list[Registration]:
    return list(
        db.scalars(
            select(Registration)
            .where(Registration.user_id == actor.id)
            .order_by(Registration.created_at, Registration.id)
            .offset(offset)
            .limit(limit)
        )
    )


@router.get("/events/{event_id}/registrations", response_model=RegistrationSummary)
def summary(event_id: str, db: DB, actor: Actor) -> RegistrationSummary:
    event = get(db, Event, event_id)
    count = db.scalar(select(func.count(Registration.id)).where(Registration.event_id == event_id))
    participants = None
    # La liste nominative reste réservée aux administrateurs et au référent.
    if "admin" in actor.roles or event.referent_id == actor.id:
        participants = [
            ParticipantView(user_id=user.id, first_name=user.first_name, created_at=created_at)
            for user, created_at in db.execute(
                select(User, Registration.created_at)
                .join(Registration, Registration.user_id == User.id)
                .where(Registration.event_id == event_id)
                .order_by(Registration.created_at, Registration.id)
            )
        ]
    return RegistrationSummary(
        event_id=event_id,
        open=bool(event.registration_section_ids or event.registration_team_ids),
        limit=event.registration_limit,
        count=count or 0,
        registered=own(db, event_id, actor.id) is not None,
        eligible=eligible(db, event, actor),
        participants=participants,
    )


@router.post("/events/{event_id}/registration", response_model=RegistrationView, status_code=201)
def register(event_id: str, db: DB, actor: Actor) -> Registration:
    event = locked_event(db, event_id)
    existing = own(db, event_id, actor.id)
    if existing:
        return existing
    if event.cancelled:
        raise HTTPException(409, {"code": "registration_closed", "message": "Séance annulée"})
    if event.starts_at <= now():
        raise HTTPException(409, {"code": "registration_closed", "message": "Séance commencée"})
    if not (event.registration_section_ids or event.registration_team_ids):
        raise HTTPException(409, {"code": "registration_closed", "message": "Séance fermée"})
    if not eligible(db, event, actor):
        raise HTTPException(403, "Séance réservée à d’autres équipes ou sections")
    count = db.scalar(select(func.count(Registration.id)).where(Registration.event_id == event_id))
    if event.registration_limit is not None and (count or 0) >= event.registration_limit:
        raise HTTPException(409, {"code": "registration_full", "message": "Séance complète"})
    value = Registration(user_id=actor.id, event_id=event_id)
    db.add(value)
    db.flush()
    return value


@router.delete("/events/{event_id}/registration", status_code=204)
def unregister(event_id: str, db: DB, actor: Actor) -> None:
    event = locked_event(db, event_id)
    value = own(db, event_id, actor.id)
    if value is None:
        return
    if event.starts_at <= now():
        raise HTTPException(409, "Séance commencée : désinscription impossible")
    db.delete(value)


@router.delete("/events/{event_id}/registrations/{user_id}", status_code=204)
def remove(event_id: str, user_id: str, db: DB, actor: Admin) -> None:
    event = locked_event(db, event_id)
    value = own(db, event_id, user_id)
    if value is None:
        raise HTTPException(404, "Inscription introuvable")
    db.delete(value)
    if user_id != actor.id:
        user = get(db, User, user_id)
        notify(
            db,
            user,
            f"unregistered:{event.id}:{token()}",
            "registration_removed",
            f"Inscription retirée : {event.title}",
            event.id,
            user.followed_email,
        )
