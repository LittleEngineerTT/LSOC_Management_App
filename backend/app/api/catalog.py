from fastapi import APIRouter, HTTPException
from sqlalchemy import select

from app.api.common import DB, Actor, Admin, get
from app.api.schemas import (
    GymInput,
    GymView,
    NameInput,
    SectionView,
    TeamInput,
    TeamView,
    TeamWarningInput,
)
from app.persistence.models import Gymnasium, Position, Section, Team, User

router = APIRouter(tags=["Catalogue"])


def active_referent(db: DB, identifier: str | None) -> None:
    if identifier is not None and not get(db, User, identifier).active:
        raise HTTPException(422, "Le référent doit avoir un compte actif")


@router.get("/sections", response_model=list[SectionView])
def sections(db: DB, actor: Actor) -> list[Section]:
    return list(db.scalars(select(Section).order_by(Section.name)))


@router.post("/sections", response_model=SectionView, status_code=201)
def create_section(body: NameInput, db: DB, actor: Admin) -> Section:
    value = Section(**body.model_dump())
    db.add(value)
    db.flush()
    return value


@router.put("/sections/{identifier}", response_model=SectionView)
def update_section(identifier: str, body: NameInput, db: DB, actor: Admin) -> Section:
    value = get(db, Section, identifier)
    value.name = body.name
    return value


@router.delete("/sections/{identifier}", status_code=204)
def delete_section(identifier: str, db: DB, actor: Admin) -> None:
    from app.persistence.models import Event
    from app.services.events import lock_planning

    lock_planning(db)
    if any(
        identifier in e.section_ids or identifier in e.registration_section_ids
        for e in db.scalars(select(Event))
    ):
        raise HTTPException(409, "Section utilisée par des événements")
    db.delete(get(db, Section, identifier))


@router.get("/teams", response_model=list[TeamView])
def teams(db: DB, actor: Actor) -> list[Team]:
    return list(db.scalars(select(Team).order_by(Team.name)))


@router.post("/teams", response_model=TeamView, status_code=201)
def create_team(body: TeamInput, db: DB, actor: Admin) -> Team:
    get(db, Section, body.section_id)
    active_referent(db, body.referent_id)
    value = Team(**body.model_dump())
    db.add(value)
    db.flush()
    return value


@router.put("/teams/{identifier}", response_model=TeamView)
def update_team(identifier: str, body: TeamInput, db: DB, actor: Admin) -> Team:
    from app.services.events import lock_planning, reassign_team_events

    get(db, Section, body.section_id)
    active_referent(db, body.referent_id)
    lock_planning(db)
    value = get(db, Team, identifier)
    previous = value.referent_id
    for key, item in body.model_dump().items():
        setattr(value, key, item)
    if body.referent_id is not None and body.referent_id != previous:
        reassign_team_events(db, value, previous, actor)
    return value


@router.delete("/teams/{identifier}", status_code=204)
def delete_team(identifier: str, db: DB, actor: Admin) -> None:
    from app.persistence.models import Event
    from app.services.events import lock_planning

    lock_planning(db)
    events = list(db.scalars(select(Event)))
    if any(identifier in e.registration_team_ids for e in events):
        raise HTTPException(409, "Équipe utilisée par des inscriptions d’événements")
    # Les événements restent ; l’équipe disparaît seulement de leurs organisatrices.
    for event in events:
        if identifier in event.team_ids:
            event.team_ids = [value for value in event.team_ids if value != identifier]
    db.delete(get(db, Team, identifier))


@router.put("/teams/{identifier}/ffvb-warning", response_model=TeamView)
def team_warning(identifier: str, body: TeamWarningInput, db: DB, actor: Admin) -> Team:
    value = get(db, Team, identifier)
    value.ffvb_source_warning_ignored = body.ignored
    return value


@router.get("/gymnasiums", response_model=list[GymView])
def gyms(db: DB, actor: Actor) -> list[Gymnasium]:
    return list(db.scalars(select(Gymnasium).order_by(Gymnasium.name)))


@router.post("/gymnasiums", response_model=GymView, status_code=201)
def create_gym(body: GymInput, db: DB, actor: Admin) -> Gymnasium:
    from app.services.ffvb import remap_venues

    value = Gymnasium(**body.model_dump())
    db.add(value)
    db.flush()
    # Un nouveau gymnase peut porter le nom d’un lieu FFVB de matchs à domicile.
    remap_venues(db)
    return value


@router.put("/gymnasiums/{identifier}", response_model=GymView)
def update_gym(identifier: str, body: GymInput, db: DB, actor: Admin) -> Gymnasium:
    from app.services.events import alert_capacity, lock_gyms

    lock_gyms(db, [identifier])
    value = get(db, Gymnasium, identifier)
    renamed = value.name != body.name
    value.name, value.capacity = body.name, body.capacity
    db.flush()
    if renamed:
        from app.services.ffvb import remap_venues

        # Le rattachement automatique des matchs à domicile dépend du nom du gymnase.
        remap_venues(db)
    alert_capacity(db, identifier)
    return value


@router.delete("/gymnasiums/{identifier}", status_code=204)
def delete_gym(identifier: str, db: DB, actor: Admin) -> None:
    db.delete(get(db, Gymnasium, identifier))


@router.get("/positions", response_model=list[SectionView])
def positions(db: DB, actor: Actor) -> list[Position]:
    return list(db.scalars(select(Position).order_by(Position.name)))


@router.post("/positions", response_model=SectionView, status_code=201)
def create_position(body: NameInput, db: DB, actor: Admin) -> Position:
    value = Position(**body.model_dump())
    db.add(value)
    db.flush()
    return value


@router.put("/positions/{identifier}", response_model=SectionView)
def update_position(identifier: str, body: NameInput, db: DB, actor: Admin) -> Position:
    value = get(db, Position, identifier)
    value.name = body.name
    return value


@router.delete("/positions/{identifier}", status_code=204)
def delete_position(identifier: str, db: DB, actor: Admin) -> None:
    """Supprime un poste ; les joueurs qui l’occupaient n’ont plus de poste."""
    db.delete(get(db, Position, identifier))
