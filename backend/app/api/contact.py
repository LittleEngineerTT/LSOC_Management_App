"""Application Contact : formulaire ouvert à tous, avec ou sans compte, et suivi des demandes
par les administrateurs, qui les prennent en charge puis les marquent comme résolues."""

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select

from app.api.auth import rate_limit
from app.api.common import DB, Admin
from app.api.schemas import ContactInput, ContactRequestView, Status
from app.core.security import now
from app.persistence.models import ContactRequest, Team, User
from app.services.notifications import admins

router = APIRouter(tags=["Contact"])

LINK = "/app/contact"
# Extrait de la question repris dans la notification ; le détail reste dans l’application.
EXCERPT = 300


@router.post("/contact", response_model=Status, status_code=201, dependencies=[Depends(rate_limit)])
def create(body: ContactInput, db: DB) -> Status:
    """Enregistre la demande et prévient les administrateurs. La réponse ne renvoie rien de la
    demande : le formulaire est public."""
    team_ids = list(dict.fromkeys(body.team_ids))
    teams = {team.id: team for team in db.scalars(select(Team).where(Team.id.in_(team_ids)))}
    if len(teams) != len(team_ids):
        raise HTTPException(422, "Équipe inconnue")
    value = ContactRequest(
        email=str(body.email) if body.email else None,
        phone=body.phone,
        message=body.message,
        team_ids=team_ids,
    )
    db.add(value)
    db.flush()
    excerpt = body.message if len(body.message) <= EXCERPT else body.message[:EXCERPT] + "…"
    names = ", ".join(teams[identifier].name for identifier in team_ids)
    admins(
        db,
        f"contact:{value.id}",
        "contact_request",
        "Une nouvelle demande de contact a été reçue",
        link=LINK,
        body=f"Équipes : {names}\n\n{excerpt}",
    )
    return Status(message="Demande envoyée")


@router.get("/contact-requests", response_model=list[ContactRequestView])
def listing(
    db: DB, actor: Admin, status: Literal["open", "resolved", ""] = ""
) -> list[ContactRequest]:
    """Demandes de contact, les plus récentes d’abord ; `status=open` pour les non résolues."""
    query = select(ContactRequest)
    if status:
        query = query.where(ContactRequest.status == status)
    return list(db.scalars(query.order_by(ContactRequest.created_at.desc(), ContactRequest.id)))


def locked(db: DB, request_id: str) -> ContactRequest:
    value = db.get(ContactRequest, request_id, with_for_update=True)
    if value is None:
        raise HTTPException(404, "Ressource introuvable")
    return value


def take(value: ContactRequest, actor: User) -> None:
    value.handler_id = actor.id
    value.handler_name = actor.first_name
    value.handled_at = now()


@router.post("/contact-requests/{request_id}/take", response_model=ContactRequestView)
def take_charge(request_id: str, db: DB, actor: Admin) -> ContactRequest:
    """L’administrateur prend la demande en charge, à la place d’un éventuel collègue."""
    value = locked(db, request_id)
    if value.status == "resolved":
        raise HTTPException(409, "Demande déjà résolue")
    take(value, actor)
    return value


@router.post("/contact-requests/{request_id}/resolve", response_model=ContactRequestView)
def resolve(request_id: str, db: DB, actor: Admin) -> ContactRequest:
    """Marque la demande comme résolue ; sans prise en charge, l’administrateur en devient le
    responsable."""
    value = locked(db, request_id)
    if value.status == "resolved":
        raise HTTPException(409, "Demande déjà résolue")
    if value.handler_name is None:
        take(value, actor)
    value.status = "resolved"
    value.resolved_at = now()
    return value


@router.post("/contact-requests/{request_id}/reopen", response_model=ContactRequestView)
def reopen(request_id: str, db: DB, actor: Admin) -> ContactRequest:
    """Rouvre une demande résolue par erreur ; sa prise en charge est conservée."""
    value = locked(db, request_id)
    if value.status != "resolved":
        raise HTTPException(409, "Demande non résolue")
    value.status = "open"
    value.resolved_at = None
    return value
