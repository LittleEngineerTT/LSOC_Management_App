import httpx
from fastapi import APIRouter, HTTPException, Query
from sqlalchemy import select

from app.api.common import DB, Actor, Admin, get
from app.api.schemas import (
    ConflictView,
    FFVBSourceInput,
    FFVBSourceView,
    MappingInput,
    MappingView,
    MatchDefaults,
    MatchView,
    ResolutionInput,
)
from app.core.security import now
from app.integrations.ffvb import normalize
from app.persistence.models import (
    Event,
    FFVBConflict,
    FFVBMatchState,
    FFVBSource,
    GymMapping,
    Gymnasium,
    Team,
    User,
)
from app.services.events import lock_planning
from app.services.ffvb import defaults, resolve, sync_source

router = APIRouter(prefix="/ffvb", tags=["FFVB"])


def validate_source(body: FFVBSourceInput, db: DB) -> None:
    team = get(db, Team, body.team_id)
    if body.enabled and (team.referent_id is None or not get(db, User, team.referent_id).active):
        raise HTTPException(422, "Configurer un référent actif sur cette équipe")
    left, right = body.season.split("/")
    if int(right) != int(left) + 1:
        raise HTTPException(422, "La saison doit couvrir deux années consécutives")


@router.get("/sources", response_model=list[FFVBSourceView])
def sources(db: DB, actor: Admin) -> list[FFVBSource]:
    return list(db.scalars(select(FFVBSource).order_by(FFVBSource.id)))


@router.post("/sources", response_model=FFVBSourceView, status_code=201)
def create_source(body: FFVBSourceInput, db: DB, actor: Admin) -> FFVBSource:
    validate_source(body, db)
    value = FFVBSource(**body.model_dump())
    db.add(value)
    db.flush()
    return value


@router.put("/sources/{source_id}", response_model=FFVBSourceView)
def update_source(source_id: str, body: FFVBSourceInput, db: DB, actor: Admin) -> FFVBSource:
    lock_planning(db)
    validate_source(body, db)
    value = get(db, FFVBSource, source_id)
    identity = {"team_id", "season", "entity", "pool", "team_number", "team_name", "club_code"}
    if any(getattr(value, key) != getattr(body, key) for key in identity) and db.scalar(
        select(FFVBMatchState.id).where(FFVBMatchState.source_id == source_id)
    ):
        raise HTTPException(
            409, "L’identité d’une source importée est immuable ; créer une nouvelle source"
        )
    for key, item in body.model_dump().items():
        setattr(value, key, item)
    value.next_check_at = now()
    return value


@router.post("/sources/{source_id}/sync", response_model=FFVBSourceView)
def synchronize(source_id: str, db: DB, actor: Admin) -> FFVBSource:
    value = get(db, FFVBSource, source_id)
    with httpx.Client() as client:
        sync_source(db, value, client)
    return value


@router.get("/gym-mappings", response_model=list[MappingView])
def mappings(db: DB, actor: Admin) -> list[GymMapping]:
    return list(db.scalars(select(GymMapping).order_by(GymMapping.official_name)))


@router.post("/gym-mappings", response_model=MappingView, status_code=201)
def add_mapping(body: MappingInput, db: DB, actor: Admin) -> GymMapping:
    lock_planning(db)
    get(db, Gymnasium, body.gymnasium_id)
    value = GymMapping(official_name=normalize(body.official_name), gymnasium_id=body.gymnasium_id)
    db.add(value)
    db.flush()
    return value


@router.put("/gym-mappings/{mapping_id}", response_model=MappingView)
def edit_mapping(mapping_id: str, body: MappingInput, db: DB, actor: Admin) -> GymMapping:
    lock_planning(db)
    get(db, Gymnasium, body.gymnasium_id)
    value = get(db, GymMapping, mapping_id)
    value.official_name, value.gymnasium_id = normalize(body.official_name), body.gymnasium_id
    return value


@router.delete("/gym-mappings/{mapping_id}", status_code=204)
def delete_mapping(mapping_id: str, db: DB, actor: Admin) -> None:
    lock_planning(db)
    db.delete(get(db, GymMapping, mapping_id))


@router.get("/matches", response_model=list[MatchView])
def matches(
    db: DB,
    actor: Actor,
    event_id: str | None = None,
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
) -> list[FFVBMatchState]:
    query = select(FFVBMatchState)
    if event_id:
        event = get(db, Event, event_id)
        query = query.where(FFVBMatchState.id == event.ffvb_match_id)
    return list(db.scalars(query.order_by(FFVBMatchState.match_code).offset(offset).limit(limit)))


@router.get("/conflicts", response_model=list[ConflictView])
def conflicts(db: DB, actor: Admin, status: str = "open") -> list[FFVBConflict]:
    return list(
        db.scalars(
            select(FFVBConflict)
            .where(FFVBConflict.status == status)
            .order_by(FFVBConflict.created_at)
        )
    )


@router.post("/conflicts/{conflict_id}/resolve", response_model=MatchView)
def resolve_conflict(
    conflict_id: str, body: ResolutionInput, db: DB, actor: Admin
) -> FFVBMatchState:
    return resolve(db, get(db, FFVBConflict, conflict_id), body.action, actor)


@router.post("/matches/{match_id}/reactivate", response_model=MatchView)
def reactivate(match_id: str, db: DB, actor: Admin) -> FFVBMatchState:
    lock_planning(db)
    state = get(db, FFVBMatchState, match_id)
    from app.persistence.models import EventRevision
    from app.services.events import snapshot

    event = db.scalar(select(Event).where(Event.ffvb_match_id == state.id))
    if event is None:
        raise HTTPException(404, "Événement FFVB introuvable")
    before = snapshot(event) | {
        "ffvb_disabled": state.disabled,
        "ffvb_suspended_until": state.suspended_until.isoformat()
        if state.suspended_until
        else None,
    }
    state.disabled, state.suspended_until = False, None
    event.version += 1
    after = snapshot(event) | {"ffvb_disabled": False, "ffvb_suspended_until": None}
    db.add(
        EventRevision(
            event_id=event.id,
            actor_id=actor.id,
            actor_name=actor.first_name,
            origin="human",
            action="ffvb_reactivate",
            before=before,
            after=after,
        )
    )
    source = get(db, FFVBSource, state.source_id)
    source.next_check_at = now()
    return state


@router.get("/defaults", response_model=MatchDefaults)
def get_defaults(db: DB, actor: Admin) -> MatchDefaults:
    value = defaults(db)
    return MatchDefaults(
        before_minutes=value.before_minutes, after_minutes=value.after_minutes, courts=value.courts
    )


@router.put("/defaults", response_model=MatchDefaults)
def set_defaults(body: MatchDefaults, db: DB, actor: Admin) -> MatchDefaults:
    lock_planning(db)
    value = defaults(db)
    for key, item in body.model_dump().items():
        setattr(value, key, item)
    return body
