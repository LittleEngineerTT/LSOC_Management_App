from datetime import timedelta

import httpx
from fastapi import APIRouter, HTTPException, Query
from sqlalchemy import select, text

from app.api.common import DB, Actor, Admin, get
from app.api.schemas import (
    ConflictView,
    FFVBClubInput,
    FFVBClubView,
    FFVBResultView,
    FFVBSourceInput,
    FFVBSourceView,
    MappingInput,
    MappingView,
    MatchDefaults,
    MatchView,
    ResolutionInput,
    SourceCandidate,
    SourcePreview,
    SourceResultsView,
    SourceURLInput,
)
from app.core.security import now
from app.integrations.ffvb import fetch, normalize
from app.integrations.ffvb_source import club_candidates, url_parameters
from app.persistence.models import (
    ClubSettings,
    Event,
    FFVBConflict,
    FFVBMatchState,
    FFVBResult,
    FFVBSource,
    GymMapping,
    Gymnasium,
    Section,
    Team,
)
from app.services.events import lock_planning
from app.services.ffvb import (
    apply_source_settings,
    defaults,
    delete_source,
    match_settings,
    remap_venues,
    resolve,
    sync_source,
)
from app.services.notifications import active_referents

router = APIRouter(prefix="/ffvb", tags=["FFVB"])


def validate_source(
    body: FFVBSourceInput, db: DB, existing_source: FFVBSource | None = None
) -> None:
    db.execute(text("SELECT pg_advisory_xact_lock(781012)"))
    config = defaults(db)
    if existing_source is not None:
        if body.club_code != existing_source.club_code:
            raise HTTPException(409, "Le code du club d’une source existante est immuable")
    elif config.club_code is None:
        existing = set(db.scalars(select(FFVBSource.club_code)))
        if existing and existing != {body.club_code}:
            raise HTTPException(
                409, "Le code du club doit correspondre aux sources déjà configurées"
            )
        config.club_code = body.club_code
    elif body.club_code != config.club_code:
        raise HTTPException(409, "Le code du club est déjà configuré et ne peut pas être modifié")
    team = get(db, Team, body.team_id)
    if body.enabled and not active_referents(db, team.referent_ids):
        raise HTTPException(422, "Configurer un référent actif sur cette équipe")
    left, right = body.season.split("/")
    if int(right) != int(left) + 1:
        raise HTTPException(422, "La saison doit couvrir deux années consécutives")


@router.get("/club", response_model=FFVBClubView)
def club(db: DB, actor: Admin) -> FFVBClubView:
    db.execute(text("SELECT pg_advisory_xact_lock(781012)"))
    config = defaults(db)
    if config.club_code is None:
        codes = set(db.scalars(select(FFVBSource.club_code)))
        if len(codes) == 1:
            config.club_code = codes.pop()
    return FFVBClubView(club_code=config.club_code)


@router.put("/club", response_model=FFVBClubView)
def configure_club(body: FFVBClubInput, db: DB, actor: Admin) -> FFVBClubView:
    db.execute(text("SELECT pg_advisory_xact_lock(781012)"))
    config = defaults(db)
    existing = set(db.scalars(select(FFVBSource.club_code)))
    if len(existing) == 1 and existing != {body.club_code}:
        raise HTTPException(409, "Le code du club doit correspondre aux sources déjà configurées")
    if config.club_code is not None and config.club_code != body.club_code:
        raise HTTPException(409, "Le code du club est déjà configuré et ne peut pas être modifié")
    config.club_code = body.club_code
    return FFVBClubView(club_code=config.club_code)


@router.get("/results", response_model=list[SourceResultsView])
def results(
    db: DB,
    actor: Actor,
    days: int = Query(30, ge=1, le=365),
    limit: int = Query(10, ge=1, le=50),
) -> list[SourceResultsView]:
    """Résultats récents de chaque source FFVB, du plus récent au plus ancien."""
    since = now() - timedelta(days=days)
    result: list[SourceResultsView] = []
    for source, team, section in db.execute(
        select(FFVBSource, Team, Section)
        .join(Team, Team.id == FFVBSource.team_id)
        .join(Section, Section.id == Team.section_id)
        .order_by(Section.name, Team.name, FFVBSource.season.desc())
    ).tuples():
        played = db.scalars(
            select(FFVBResult)
            .where(FFVBResult.source_id == source.id, FFVBResult.kickoff_at >= since)
            .order_by(FFVBResult.kickoff_at.desc(), FFVBResult.match_code)
            .limit(limit)
        )
        result.append(
            SourceResultsView(
                source_id=source.id,
                season=source.season,
                pool=source.pool,
                club_team=source.team_name,
                team_id=team.id,
                team_name=team.name,
                section_id=section.id,
                section_name=section.name,
                results=[FFVBResultView.model_validate(item) for item in played],
            )
        )
    return result


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


@router.post("/sources/preview", response_model=SourcePreview)
def preview_source(body: SourceURLInput, db: DB, actor: Admin) -> SourcePreview:
    try:
        season, entity, pool, selected = url_parameters(body.url)
    except ValueError as error:
        raise HTTPException(422, str(error)) from error
    config = db.get(ClubSettings, 1)
    code = config.club_code if config else None
    if code is None:
        existing = set(db.scalars(select(FFVBSource.club_code)))
        if len(existing) == 1:
            code = existing.pop()
    result = SourcePreview(season=season, entity=entity, pool=pool, club_code=code, candidates=[])
    if code is None:
        result.warning = "Configurez d’abord le code du club pour identifier son équipe"
        return result
    try:
        with httpx.Client() as client:
            html = fetch(client, season, entity, pool)
        candidates = club_candidates(html, season, entity, pool, code, selected)
    except (httpx.HTTPError, ValueError):
        result.warning = (
            "La page FFVB ne peut pas être analysée ; complétez le formulaire manuellement"
        )
        return result
    teams = list(db.scalars(select(Team)))
    for number, name in candidates:
        matching = [
            team
            for team in teams
            if normalize(team.name) in {normalize(name), normalize(f"{name} {number}")}
        ]
        result.candidates.append(
            SourceCandidate(
                team_number=number,
                team_name=name,
                team_id=matching[0].id if len(matching) == 1 else None,
            )
        )
    if not candidates:
        result.warning = (
            "Aucune équipe de ce club identifiée ; complétez le formulaire manuellement"
        )
    elif len(candidates) > 1:
        result.warning = "Plusieurs équipes du club sont présentes dans cette poule ; choisissez celle à importer"
    return result


@router.put("/sources/{source_id}", response_model=FFVBSourceView)
def update_source(source_id: str, body: FFVBSourceInput, db: DB, actor: Admin) -> FFVBSource:
    lock_planning(db)
    value = get(db, FFVBSource, source_id)
    validate_source(body, db, value)
    identity = {"team_id", "season", "entity", "pool", "team_number", "team_name", "club_code"}
    if any(getattr(value, key) != getattr(body, key) for key in identity) and db.scalar(
        select(FFVBMatchState.id).where(FFVBMatchState.source_id == source_id)
    ):
        raise HTTPException(
            409, "L’identité d’une source importée est immuable ; créer une nouvelle source"
        )
    previous = match_settings(db, value)
    for key, item in body.model_dump().items():
        setattr(value, key, item)
    value.next_check_at = now()
    db.flush()
    apply_source_settings(db, value, previous, actor)
    return value


@router.delete("/sources/{source_id}", status_code=204)
def remove_source(source_id: str, db: DB, actor: Admin, cancel_upcoming: bool = False) -> None:
    lock_planning(db)
    delete_source(db, get(db, FFVBSource, source_id), actor, cancel_upcoming)


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
    key = normalize(body.official_name)
    if any(normalize(m.official_name) == key for m in db.scalars(select(GymMapping))):
        raise HTTPException(409, "Ce nom FFVB est déjà associé (accents et majuscules ignorés)")
    value = GymMapping(official_name=key, gymnasium_id=body.gymnasium_id)
    db.add(value)
    db.flush()
    # Les matchs déjà importés sont rattachés tout de suite, sans attendre la synchronisation.
    remap_venues(db)
    return value


@router.put("/gym-mappings/{mapping_id}", response_model=MappingView)
def edit_mapping(mapping_id: str, body: MappingInput, db: DB, actor: Admin) -> GymMapping:
    lock_planning(db)
    get(db, Gymnasium, body.gymnasium_id)
    value = get(db, GymMapping, mapping_id)
    key = normalize(body.official_name)
    if any(
        normalize(m.official_name) == key and m.id != mapping_id
        for m in db.scalars(select(GymMapping))
    ):
        raise HTTPException(409, "Ce nom FFVB est déjà associé (accents et majuscules ignorés)")
    value.official_name, value.gymnasium_id = key, body.gymnasium_id
    db.flush()
    remap_venues(db)
    return value


@router.delete("/gym-mappings/{mapping_id}", status_code=204)
def delete_mapping(mapping_id: str, db: DB, actor: Admin) -> None:
    lock_planning(db)
    db.delete(get(db, GymMapping, mapping_id))
    db.flush()
    remap_venues(db)


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
