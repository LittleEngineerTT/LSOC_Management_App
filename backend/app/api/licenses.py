from fastapi import APIRouter, HTTPException
from sqlalchemy import select, text

from app.api.common import DB, Actor, Admin, get
from app.api.schemas import (
    LicenseInput,
    LicenseTeamView,
    LicenseView,
    MyLicenseView,
)
from app.core.security import now, token
from app.persistence.models import Assignment, License, Team, User
from app.services.notifications import notify

router = APIRouter(tags=["Licences"])

LABELS = {
    "none": "Pas de licence",
    "in_progress": "En cours",
    "payment_pending": "Paiement en attente",
    "active": "Active",
}


def lock_licenses(db: DB) -> None:
    db.execute(text("SELECT pg_advisory_xact_lock(781014)"))


def view(user: User, record: License | None, mine: list[Assignment]) -> LicenseView:
    status = record.status if record else "none"
    return LicenseView.model_validate(
        {
            "user_id": user.id,
            "first_name": user.first_name,
            "username": user.username,
            "number": record.number if record else None,
            "status": status,
            "updated_at": record.updated_at if record else None,
            "teams": [LicenseTeamView(team_id=item.team_id, kind=item.kind) for item in mine],
            "missing": status != "active" and any(item.kind == "player" for item in mine),
        }
    )


@router.get("/licenses/me", response_model=MyLicenseView)
def mine(db: DB, actor: Actor) -> MyLicenseView:
    # Un adhérent ne voit que le statut ; le numéro reste réservé aux administrateurs.
    value = db.get(License, actor.id)
    return MyLicenseView.model_validate({"status": value.status if value else "none"})


@router.get("/licenses", response_model=list[LicenseView])
def licenses(
    db: DB,
    actor: Admin,
    section_id: str | None = None,
    team_id: str | None = None,
    missing: bool = False,
) -> list[LicenseView]:
    """Licences des comptes actifs, filtrables par section, équipe ou licences manquantes.

    Une licence manque pour un joueur rattaché à une équipe du périmètre sans licence active.
    """
    teams = {team.id: team for team in db.scalars(select(Team))}
    scope = {
        identifier
        for identifier, team in teams.items()
        if (team_id is None or identifier == team_id)
        and (section_id is None or team.section_id == section_id)
    }
    assignments: dict[str, list[Assignment]] = {}
    for assignment in db.scalars(select(Assignment).order_by(Assignment.team_id)):
        assignments.setdefault(assignment.user_id, []).append(assignment)
    records = {value.user_id: value for value in db.scalars(select(License))}
    filtered = team_id is not None or section_id is not None
    result: list[LicenseView] = []
    for user in db.scalars(
        select(User).where(User.active.is_(True)).order_by(User.first_name, User.id)
    ):
        mine = [item for item in assignments.get(user.id, []) if item.team_id in scope]
        if filtered and not mine:
            continue
        item = view(user, records.get(user.id), mine)
        if missing and not item.missing:
            continue
        result.append(item)
    return result


@router.put("/licenses/{user_id}", response_model=LicenseView)
def update_license(user_id: str, body: LicenseInput, db: DB, actor: Admin) -> LicenseView:
    lock_licenses(db)
    user = get(db, User, user_id)
    value = db.get(License, user_id)
    current = value.status if value else "none"
    # « Paiement en attente » est l’étape obligatoire avant une licence active.
    if body.status == "active" and current not in {"payment_pending", "active"}:
        raise HTTPException(
            422, "Une licence devient active uniquement après « Paiement en attente »"
        )
    if body.status == "active" and not body.number:
        raise HTTPException(422, "Un numéro de licence est requis pour une licence active")
    if body.number and db.scalar(
        select(License.user_id).where(License.number == body.number, License.user_id != user_id)
    ):
        raise HTTPException(409, "Ce numéro de licence est déjà attribué")
    if value is None:
        value = License(user_id=user_id)
        db.add(value)
    value.number, value.status = body.number, body.status
    value.updated_at, value.updated_by = now(), actor.id
    db.flush()
    if body.status != current and user.id != actor.id:
        notify(
            db,
            user,
            f"license:{user.id}:{token()}",
            "license",
            f"Licence : {LABELS[body.status]}",
            send_email=False,
            link="/app/profil",
        )
    mine = list(db.scalars(select(Assignment).where(Assignment.user_id == user_id)))
    return view(user, value, mine)
