from typing import Any

from fastapi import APIRouter, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.common import DB, Actor, Admin, get
from app.api.schemas import (
    ParticipantView,
    QuotaSummary,
    RegistrationDecisionInput,
    RegistrationInput,
    RegistrationSummary,
    RegistrationView,
)
from app.core.security import now, token
from app.persistence.models import Assignment, Event, Position, Registration, Team, User
from app.services.events import accepted_registrations, lock_planning
from app.services.notifications import (
    PARIS,
    active_referents,
    admins,
    notify,
    resolve_admin_alerts,
)

router = APIRouter(tags=["Inscriptions"])


def classic_open(event: Event) -> bool:
    return bool(event.registration_section_ids or event.registration_team_ids)


def is_open(event: Event) -> bool:
    return classic_open(event) or bool(event.registration_quotas)


def memberships(db: Session, user: User) -> list[tuple[str, str]]:
    """Équipes du compte et leur section."""
    return [
        (team, section)
        for team, section in db.execute(
            select(Team.id, Team.section_id)
            .join(Assignment, Assignment.team_id == Team.id)
            .where(Assignment.user_id == user.id)
        ).tuples()
    ]


def classic_eligible(event: Event, links: list[tuple[str, str]]) -> bool:
    return any(
        team in event.registration_team_ids or section in event.registration_section_ids
        for team, section in links
    )


def own_quotas(event: Event, links: list[tuple[str, str]]) -> list[dict[str, Any]]:
    """Places réservées aux sections du compte."""
    sections = {section for _, section in links}
    return [quota for quota in event.registration_quotas if quota["section_id"] in sections]


def eligible(db: Session, event: Event, user: User) -> bool:
    if "member" not in user.roles or not is_open(event):
        return False
    links = memberships(db, user)
    return classic_eligible(event, links) or bool(own_quotas(event, links))


def team_positions(db: Session, user_ids: list[str]) -> dict[str, list[str]]:
    """Postes de chaque joueur dans ses équipes, sans doublon."""
    result: dict[str, list[str]] = {}
    for user_id, position_id in db.execute(
        select(Assignment.user_id, Assignment.position_id).where(
            Assignment.user_id.in_(user_ids),
            Assignment.kind == "player",
            Assignment.position_id.is_not(None),
        )
    ).tuples():
        positions = result.setdefault(user_id, [])
        if position_id and position_id not in positions:
            positions.append(position_id)
    return result


def unusual(position_id: str | None, usual: list[str]) -> bool:
    """Poste demandé différent de celui du joueur en équipe : à signaler au coach."""
    return bool(usual) and position_id not in usual


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


def accepted_count(db: Session, event_id: str) -> int:
    return (
        db.scalar(
            select(func.count(Registration.id)).where(
                Registration.event_id == event_id, Registration.status == "accepted"
            )
        )
        or 0
    )


def quota(event: Event, quota_id: str) -> dict[str, Any] | None:
    return next((item for item in event.registration_quotas if item["id"] == quota_id), None)


def full(db: Session, event: Event, quota_id: str | None = None) -> bool:
    """Ouverture classique (None) ou places réservées complètes."""
    if quota_id is None:
        limit = event.registration_limit
    else:
        found = quota(event, quota_id)
        limit = found["limit"] if found else 0
    return limit is not None and accepted_registrations(db, event.id, quota_id) >= limit


def slot(db: Session, event: Event, user: User, position_id: str) -> str | None:
    """Places occupées par une demande à ce poste : réservées à la section du joueur et à ce
    poste si elles ne sont pas complètes, sinon l’ouverture classique (None)."""
    links = memberships(db, user)
    matching = [item for item in own_quotas(event, links) if position_id in item["position_ids"]]
    for item in matching:
        if not full(db, event, item["id"]):
            return str(item["id"])
    if classic_eligible(event, links):
        return None
    if matching:
        raise HTTPException(409, {"code": "registration_full", "message": "Séance complète"})
    raise HTTPException(403, "Poste non ouvert aux inscriptions de votre section")


def reviewer(event: Event, user: User) -> bool:
    """Les demandes se traitent par un administrateur ou le référent de l’événement."""
    return "admin" in user.roles or user.id in event.referent_ids


def request_key(value: Registration) -> str:
    return f"registration-request:{value.id}"


def day(event: Event) -> str:
    return event.starts_at.astimezone(PARIS).strftime("%d/%m/%Y")


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
    pending = db.scalar(
        select(func.count(Registration.id)).where(
            Registration.event_id == event_id, Registration.status == "pending"
        )
    )
    participants = None
    # La liste nominative reste réservée aux administrateurs et au référent.
    if reviewer(event, actor):
        rows = list(
            db.execute(
                select(User, Registration)
                .join(Registration, Registration.user_id == User.id)
                .where(Registration.event_id == event_id, Registration.status != "rejected")
                .order_by(Registration.created_at, Registration.id)
            ).tuples()
        )
        usual = team_positions(db, [user.id for user, _ in rows])
        participants = [
            ParticipantView.model_validate(
                {
                    "user_id": user.id,
                    "first_name": user.first_name,
                    "created_at": request.created_at,
                    "status": request.status,
                    "position_id": request.position_id,
                    "message": request.message,
                    "quota_id": request.quota_id,
                    "team_position_ids": usual.get(user.id, []),
                    "position_warning": unusual(request.position_id, usual.get(user.id, [])),
                }
            )
            for user, request in rows
        ]
    value = own(db, event_id, actor.id)
    links = memberships(db, actor)
    allowed: list[str] | None = None
    if not classic_eligible(event, links):
        allowed = []
        for item in own_quotas(event, links):
            allowed += [p for p in item["position_ids"] if p not in allowed]
    quotas = [
        QuotaSummary.model_validate(
            {**item, "count": accepted_registrations(db, event_id, item["id"])}
        )
        for item in event.registration_quotas
    ]
    return RegistrationSummary.model_validate(
        {
            "event_id": event_id,
            "open": is_open(event),
            "limit": event.registration_limit,
            "quotas": quotas,
            "allowed_position_ids": allowed,
            "count": accepted_count(db, event_id),
            "pending": pending or 0,
            "registered": value is not None and value.status == "accepted",
            "status": value.status if value else None,
            "decision": value.decision if value else "",
            "eligible": eligible(db, event, actor),
            "participants": participants,
        }
    )


@router.post("/events/{event_id}/registration", response_model=RegistrationView, status_code=201)
def register(event_id: str, body: RegistrationInput, db: DB, actor: Actor) -> Registration:
    """Demande d’inscription, à valider par un administrateur ou le référent."""
    event = locked_event(db, event_id)
    existing = own(db, event_id, actor.id)
    if existing and existing.status == "accepted":
        return existing
    if event.cancelled:
        raise HTTPException(409, {"code": "registration_closed", "message": "Séance annulée"})
    if event.starts_at <= now():
        raise HTTPException(409, {"code": "registration_closed", "message": "Séance commencée"})
    if not is_open(event):
        raise HTTPException(409, {"code": "registration_closed", "message": "Séance fermée"})
    if not eligible(db, event, actor):
        raise HTTPException(403, "Séance réservée à d’autres équipes ou sections")
    position = db.get(Position, body.position_id)
    if position is None:
        raise HTTPException(422, "Poste inconnu")
    quota_id = slot(db, event, actor, position.id)
    if existing and existing.status == "pending":
        # Une demande en attente se corrige sans repartir de zéro.
        existing.position_id = body.position_id
        existing.message = body.message
        existing.quota_id = quota_id
        return existing
    if full(db, event, quota_id):
        raise HTTPException(409, {"code": "registration_full", "message": "Séance complète"})
    if existing:
        # Après un refus, une nouvelle demande repart d’une ligne neuve et d’une alerte neuve.
        db.delete(existing)
        db.flush()
    value = Registration(
        user_id=actor.id,
        event_id=event_id,
        position_id=body.position_id,
        message=body.message,
        quota_id=quota_id,
    )
    db.add(value)
    db.flush()
    title = f"Demande d’inscription de {actor.first_name} : {event.title} du {day(event)}"
    text = f"Poste : {position.name}"
    usual = team_positions(db, [actor.id]).get(actor.id, [])
    if unusual(position.id, usual):
        names = db.scalars(select(Position.name).where(Position.id.in_(usual))).all()
        text += f"\nAttention : poste habituel en équipe : {', '.join(sorted(names))}"
    if body.message:
        text += f"\n\n{body.message}"
    admins(db, request_key(value), "registration_request", title, event.id, body=text)
    for referent in active_referents(db, event.referent_ids):
        if "admin" in referent.roles or referent.id == actor.id:
            continue
        notify(
            db,
            referent,
            request_key(value),
            "registration_request",
            title,
            event.id,
            referent.referent_email,
            body=text,
        )
    return value


@router.post("/events/{event_id}/registrations/{user_id}/decision", response_model=RegistrationView)
def decide(
    event_id: str, user_id: str, body: RegistrationDecisionInput, db: DB, actor: Actor
) -> Registration:
    event = locked_event(db, event_id)
    if not reviewer(event, actor):
        raise HTTPException(403, "Réservé à l’administration et au référent de la séance")
    value = own(db, event_id, user_id)
    if value is None:
        raise HTTPException(404, "Demande introuvable")
    if value.status != "pending":
        raise HTTPException(409, "Demande déjà traitée")
    if body.accept and full(db, event, value.quota_id):
        # Places de la demande complètes : d’autres places ouvertes au joueur peuvent rester.
        try:
            if value.position_id is None:
                raise HTTPException(409)
            alternative = slot(db, event, get(db, User, user_id), value.position_id)
        except HTTPException as error:
            raise HTTPException(
                409, {"code": "registration_full", "message": "Séance complète"}
            ) from error
        if full(db, event, alternative):
            raise HTTPException(409, {"code": "registration_full", "message": "Séance complète"})
        value.quota_id = alternative
    value.status = "accepted" if body.accept else "rejected"
    value.decision = body.reason
    value.decided_at = now()
    resolve_admin_alerts(db, request_key(value))
    user = get(db, User, user_id)
    title = (
        f"Inscription acceptée : {event.title} du {day(event)}"
        if body.accept
        else f"Demande d’inscription refusée : {event.title} du {day(event)}"
    )
    notify(
        db,
        user,
        f"registration-decision:{value.id}",
        "registration_decision",
        title,
        event.id,
        user.followed_email,
        body=body.reason,
    )
    db.flush()
    return value


@router.delete("/events/{event_id}/registration", status_code=204)
def unregister(event_id: str, db: DB, actor: Actor) -> None:
    """Retire sa demande ou son inscription."""
    event = locked_event(db, event_id)
    value = own(db, event_id, actor.id)
    if value is None:
        return
    if value.status == "accepted" and event.starts_at <= now():
        raise HTTPException(409, "Séance commencée : désinscription impossible")
    resolve_admin_alerts(db, request_key(value))
    db.delete(value)


@router.delete("/events/{event_id}/registrations/{user_id}", status_code=204)
def remove(event_id: str, user_id: str, db: DB, actor: Admin) -> None:
    event = locked_event(db, event_id)
    value = own(db, event_id, user_id)
    if value is None:
        raise HTTPException(404, "Inscription introuvable")
    resolve_admin_alerts(db, request_key(value))
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
