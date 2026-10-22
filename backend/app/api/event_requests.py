from datetime import date, datetime

from fastapi import APIRouter, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.common import DB, Actor, Admin, get, require_admin
from app.api.schemas import CoachEventRequestInput, CoachEventRequestView, DecisionInput, EventInput
from app.core.security import now
from app.persistence.models import Assignment, CoachEventRequest, Event, Team, User
from app.services.events import (
    PARIS,
    REFERENT_ROLES,
    blocking,
    create_event,
    create_series_events,
    lock_planning,
    no_court_left,
    occurrences,
    series_days,
    validate_event,
)
from app.services.notifications import admins, decision_message, notify, resolve_admin_alerts

router = APIRouter(tags=["Planning"])


def refresh_user(db: Session, actor: User) -> User:
    current = db.scalar(
        select(User).where(User.id == actor.id).execution_options(populate_existing=True)
    )
    if current is None:
        raise HTTPException(401, "Connexion requise")
    return current


def coach_team(db: Session, actor: User, team_id: str) -> Team:
    """Équipe pour laquelle le compte peut demander un événement.

    Le référent de l’équipe le peut toujours ; un coach, s’il y est rattaché comme coach.
    """
    actor = refresh_user(db, actor)
    if not actor.active:
        raise HTTPException(403, "Un compte actif est requis")
    team = db.scalar(select(Team).where(Team.id == team_id).with_for_update())
    if team is None:
        raise HTTPException(404, "Équipe introuvable")
    coaching = "coach" in actor.roles and db.scalar(
        select(Assignment.id).where(
            Assignment.user_id == actor.id,
            Assignment.team_id == team.id,
            Assignment.kind == "coach",
        )
    )
    if actor.id not in team.referent_ids and not coaching:
        raise HTTPException(
            403, "Demande réservée aux équipes dont vous êtes référent ou que vous entraînez"
        )
    return team


def unavailability(db: Session, proposal: dict[str, object]) -> list[str]:
    """Créneaux d’une proposition qu’une indisponibilité du gymnase priverait de terrains."""
    gym = proposal.get("gymnasium_id")
    courts = int(str(proposal.get("courts") or 0))
    if not isinstance(gym, str) or courts <= 0:
        return []
    until = proposal.get("until")
    weekdays = proposal.get("weekdays")
    try:
        slots = occurrences(
            datetime.fromisoformat(str(proposal["starts_at"])),
            datetime.fromisoformat(str(proposal["ends_at"])),
            date.fromisoformat(str(until)) if until else None,
            [int(day) for day in weekdays] if isinstance(weekdays, list) else None,
        )
    except (HTTPException, KeyError, ValueError):
        return []
    result = []
    for start, end in slots:
        # Événement transitoire, jamais ajouté à la session : il sert seulement au calcul.
        probe = Event(gymnasium_id=gym, starts_at=start, ends_at=end, courts=courts)
        probe.cancelled = False
        block = blocking(db, probe)
        if block is not None:
            result.append(f"{start.astimezone(PARIS):%d/%m/%Y} : {block.title}")
    return result


def view(db: Session, value: CoachEventRequest) -> CoachEventRequestView:
    result = CoachEventRequestView.model_validate(value)
    if value.status == "pending":
        result.unavailability = unavailability(db, value.proposal)
    return result


@router.post("/event-requests", response_model=CoachEventRequestView, status_code=201)
def propose(body: CoachEventRequestInput, db: DB, actor: Actor) -> CoachEventRequest:
    lock_planning(db)
    team = coach_team(db, actor, body.team_id)
    # L’équipe principale vient en tête ; chaque équipe ajoutée doit aussi être coachée.
    team_ids = [team.id, *(i for i in dict.fromkeys(body.team_ids) if i != team.id)]
    for identifier in team_ids[1:]:
        coach_team(db, actor, identifier)
    proposal = EventInput(
        **body.model_dump(exclude={"team_id", "team_ids", "note", "until", "weekdays"}),
        team_ids=team_ids,
        section_ids=[team.section_id],
        referent_ids=[actor.id],
        direct_edit=False,
    )
    # Valider les références et l’ouverture sans insérer d’événement ni réserver de terrain.
    validate_event(db, Event(**proposal.model_dump()))
    stored = proposal.model_dump(mode="json")
    if body.until is not None:
        series_days(proposal.starts_at, body.until, body.weekdays)
        stored |= {"until": body.until.isoformat(), "weekdays": sorted(body.weekdays or [])}
    elif body.weekdays:
        raise HTTPException(422, "Indiquez la fin de la récurrence")
    # Gymnase déjà entièrement occupé par d’autres événements : refus immédiat au demandeur.
    if proposal.gymnasium_id and proposal.courts > 0:
        for start, end in occurrences(
            proposal.starts_at, proposal.ends_at, body.until, body.weekdays
        ):
            if no_court_left(db, proposal.gymnasium_id, start, end):
                local = start.astimezone(PARIS)
                raise HTTPException(
                    409,
                    {
                        "code": "no_courts",
                        "message": f"Aucun terrain disponible le {local:%d/%m/%Y à %H:%M}. "
                        "Choisissez un autre créneau ou un autre gymnase.",
                    },
                )
    value = CoachEventRequest(
        team_id=team.id,
        actor_id=actor.id,
        actor_name=actor.first_name,
        proposal=stored,
        note=body.note,
    )
    db.add(value)
    db.flush()
    admins(
        db,
        f"event-request:{value.id}",
        "event_request",
        f"Événement à valider : {body.title}",
        link=f"/app/administration?tab=requests&type=events&demande={value.id}",
    )
    notify(
        db,
        actor,
        f"event-request:{value.id}",
        "event_request",
        f"Demande enregistrée : {body.title}",
        send_email=actor.referent_email,
        link="/app/planning",
    )
    return value


@router.get("/event-requests", response_model=list[CoachEventRequestView])
def requests(
    db: DB,
    actor: Actor,
    status: str | None = "pending",
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
) -> list[CoachEventRequestView]:
    query = select(CoachEventRequest)
    if "admin" not in actor.roles:
        query = query.where(CoachEventRequest.actor_id == actor.id)
    if status:
        query = query.where(CoachEventRequest.status == status)
    return [
        view(db, value)
        for value in db.scalars(
            query.order_by(CoachEventRequest.created_at, CoachEventRequest.id)
            .offset(offset)
            .limit(limit)
        )
    ]


@router.get("/event-requests/{request_id}", response_model=CoachEventRequestView)
def detail(request_id: str, db: DB, actor: Actor) -> CoachEventRequestView:
    value = get(db, CoachEventRequest, request_id)
    if "admin" not in actor.roles and value.actor_id != actor.id:
        raise HTTPException(403, "Demande privée")
    return view(db, value)


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
        # Le demandeur devient référent de l’événement : il doit encore pouvoir l’être.
        if not REFERENT_ROLES & set(requester.roles):
            raise HTTPException(409, "Le demandeur n’est plus coach ni administrateur")
        team = coach_team(db, requester, value.team_id)
        recurrence = {
            key: value.proposal[key] for key in ("until", "weekdays") if key in value.proposal
        }
        proposal = EventInput.model_validate(
            {key: item for key, item in value.proposal.items() if key not in recurrence}
            | {
                "section_ids": [team.section_id],
                # Une demande antérieure aux équipes multiples n’a que son équipe principale.
                "team_ids": value.proposal.get("team_ids") or [team.id],
                "referent_ids": [requester.id],
                "direct_edit": False,
            }
        )
        if "until" in recurrence:
            events = create_series_events(
                db,
                proposal,
                date.fromisoformat(str(recurrence["until"])),
                [int(day) for day in recurrence.get("weekdays") or []] or None,
                actor,
                body.force,
            )
            # La demande renvoie à la première occurrence de la série créée.
            value.event_id = events[0].id
        else:
            value.event_id = create_event(db, proposal, actor, body.force).id
    value.status = "accepted" if body.accept else "rejected"
    value.decision = body.reason
    value.decided_by = actor.id
    value.decider_name = actor.first_name
    value.decided_at = now()
    title = f"Demande {'acceptée' if body.accept else 'refusée'} : {value.proposal['title']}"
    resolve_admin_alerts(db, f"event-request:{value.id}")
    # Le demandeur est le référent proposé de l’événement ; la décision va dans sa messagerie.
    referents = [str(item) for item in value.proposal.get("referent_ids") or []]
    decision_message(
        db,
        {value.actor_id, *referents},
        f"event-request-decided:{value.id}",
        title,
        body.reason,
        value.event_id,
        actor,
        subject=f"Demande d’événement : {value.proposal['title']}",
        kind="event_request_decided",
    )
    db.flush()
    return value
