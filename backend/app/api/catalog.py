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
from app.persistence.models import Gymnasium, Section, Team, User

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
    get(db, Section, body.section_id)
    active_referent(db, body.referent_id)
    value = get(db, Team, identifier)
    for key, item in body.model_dump().items():
        setattr(value, key, item)
    return value


@router.delete("/teams/{identifier}", status_code=204)
def delete_team(identifier: str, db: DB, actor: Admin) -> None:
    from app.persistence.models import Event
    from app.services.events import lock_planning

    lock_planning(db)
    if any(identifier in e.registration_team_ids for e in db.scalars(select(Event))):
        raise HTTPException(409, "Équipe utilisée par des inscriptions d’événements")
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
    value = Gymnasium(**body.model_dump())
    db.add(value)
    db.flush()
    return value


@router.put("/gymnasiums/{identifier}", response_model=GymView)
def update_gym(identifier: str, body: GymInput, db: DB, actor: Admin) -> Gymnasium:
    from app.services.events import alert_capacity, lock_gyms

    lock_gyms(db, [identifier])
    value = get(db, Gymnasium, identifier)
    value.name, value.capacity = body.name, body.capacity
    db.flush()
    alert_capacity(db, identifier)
    return value


@router.delete("/gymnasiums/{identifier}", status_code=204)
def delete_gym(identifier: str, db: DB, actor: Admin) -> None:
    db.delete(get(db, Gymnasium, identifier))
