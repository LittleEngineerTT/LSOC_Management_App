"""Lecture sans compte (mode invité) : matchs FFVB et leurs résultats, déjà publics, et le
prénom et les fonctions du bureau et des entraîneurs, présentés dans Notre club."""

from fastapi import APIRouter, HTTPException, Query
from pydantic import AwareDatetime
from sqlalchemy import select

from app.api.common import DB
from app.api.schemas import (
    PublicEventView,
    PublicTeamView,
    SectionView,
    SourceResultsView,
    StaffFunction,
    StaffView,
)
from app.persistence.models import Event, Gymnasium, Section, Team, User
from app.services.ffvb import recent_results

router = APIRouter(prefix="/public", tags=["Invités"])


@router.get("/events", response_model=list[PublicEventView])
def events(
    db: DB,
    starts_at: AwareDatetime | None = None,
    ends_at: AwareDatetime | None = None,
    include_cancelled: bool = False,
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
) -> list[Event]:
    if starts_at and ends_at and ends_at <= starts_at:
        raise HTTPException(422, "Intervalle invalide")
    query = select(Event).where(Event.ffvb_match_id.is_not(None))
    if starts_at:
        query = query.where(Event.ends_at > starts_at)
    if ends_at:
        query = query.where(Event.starts_at < ends_at)
    if not include_cancelled:
        query = query.where(Event.cancelled.is_(False))
    return list(db.scalars(query.order_by(Event.starts_at, Event.id).offset(offset).limit(limit)))


@router.get("/events/{event_id}", response_model=PublicEventView)
def detail(event_id: str, db: DB) -> Event:
    event = db.get(Event, event_id)
    # Un événement local répond comme inexistant : son existence même reste réservée aux adhérents.
    if event is None or event.ffvb_match_id is None:
        raise HTTPException(404, "Ressource introuvable")
    return event


@router.get("/sections", response_model=list[SectionView])
def sections(db: DB) -> list[Section]:
    return list(db.scalars(select(Section).order_by(Section.name)))


@router.get("/teams", response_model=list[PublicTeamView])
def teams(db: DB) -> list[Team]:
    return list(db.scalars(select(Team).order_by(Team.name)))


@router.get("/gymnasiums", response_model=list[SectionView])
def gyms(db: DB) -> list[Gymnasium]:
    """Noms des gymnasiums seulement, pour situer les matchs ; la capacité reste interne."""
    return list(db.scalars(select(Gymnasium).order_by(Gymnasium.name)))


# Fonctions présentées dans « Infos du club », dans l’ordre d’affichage.
FUNCTIONS: tuple[StaffFunction, ...] = ("president", "vice_president", "coach")


@router.get("/staff", response_model=list[StaffView])
def staff(db: DB) -> list[StaffView]:
    """Bureau puis entraîneurs, par prénom : ni identifiant (numéro de licence) ni nom."""
    people = [
        StaffView(first_name=user.first_name, functions=functions)
        for user in db.scalars(select(User).order_by(User.first_name, User.id))
        if (functions := [function for function in FUNCTIONS if function in user.roles])
    ]
    # Tri stable : président, vice-président, puis entraîneurs, chacun par prénom.
    return sorted(people, key=lambda person: FUNCTIONS.index(person.functions[0]))


@router.get("/ffvb/results", response_model=list[SourceResultsView])
def results(
    db: DB,
    days: int = Query(30, ge=1, le=365),
    limit: int = Query(10, ge=1, le=50),
) -> list[SourceResultsView]:
    """Résultats récents des sources FFVB, publiés par la fédération."""
    return recent_results(db, days, limit)
