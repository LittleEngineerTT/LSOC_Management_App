"""Lecture sans compte (mode invité) : uniquement les matchs FFVB, déjà publics à la fédération."""

from fastapi import APIRouter, HTTPException, Query
from pydantic import AwareDatetime
from sqlalchemy import select

from app.api.common import DB
from app.api.schemas import PublicEventView, PublicTeamView, SectionView
from app.persistence.models import Event, Gymnasium, Section, Team

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
