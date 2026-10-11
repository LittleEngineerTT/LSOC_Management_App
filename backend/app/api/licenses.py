from typing import Literal

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
from app.services.identity import rekey
from app.services.notifications import notify

router = APIRouter(tags=["Licences"])

LABELS = {
    "none": "Pas de licence",
    "in_progress": "En cours",
    "payment_pending": "Paiement en attente",
    "active": "Active",
}
# Étape obligatoire avant « active » : le paiement pour un joueur, « en cours » pour un coach.
BEFORE_ACTIVE = {"status": "payment_pending", "coach_status": "in_progress"}


def lock_licenses(db: DB) -> None:
    db.execute(text("SELECT pg_advisory_xact_lock(781014)"))


def concerned_coach(user: User, assignments: list[Assignment]) -> bool:
    return "coach" in user.roles or any(item.kind == "coach" for item in assignments)


def view(
    user: User,
    record: License | None,
    mine: list[Assignment],
    coach: bool,
    kind: Literal["player", "coach"] = "player",
) -> LicenseView:
    status = record.status if record else "none"
    coach_status = record.coach_status if record else "none"
    missing_player = status != "active" and any(item.kind == "player" for item in mine)
    missing_coach = coach_status != "active" and any(item.kind == "coach" for item in mine)
    return LicenseView.model_validate(
        {
            "user_id": user.id,
            "first_name": user.first_name,
            "username": user.username,
            "number": record.number if record else None,
            "status": status,
            "coach_status": coach_status,
            "updated_at": record.updated_at if record else None,
            "teams": [LicenseTeamView(team_id=item.team_id, kind=item.kind) for item in mine],
            "coach": coach,
            "missing_player": missing_player,
            "missing_coach": missing_coach,
            "missing": missing_coach if kind == "coach" else missing_player,
        }
    )


@router.get("/licenses/me", response_model=MyLicenseView)
def mine(db: DB, actor: Actor) -> MyLicenseView:
    # Un adhérent ne voit que les statuts ; le numéro reste réservé aux administrateurs.
    value = db.get(License, actor.id)
    assignments = list(db.scalars(select(Assignment).where(Assignment.user_id == actor.id)))
    return MyLicenseView.model_validate(
        {
            "status": value.status if value else "none",
            "coach_status": value.coach_status if value else "none",
            "coach": concerned_coach(actor, assignments),
        }
    )


@router.get("/licenses", response_model=list[LicenseView])
def licenses(
    db: DB,
    actor: Admin,
    kind: Literal["player", "coach"] = "player",
    section_id: str | None = None,
    team_id: str | None = None,
    missing: bool = False,
) -> list[LicenseView]:
    """Licences joueur ou coach des comptes actifs, par section, équipe ou manquantes.

    Une licence manque pour un joueur (resp. coach) rattaché à une équipe du périmètre dont
    la licence du même type n’est pas active. La liste coach ne montre que les comptes
    concernés : rôle coach ou rattachement coach.
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
        every = assignments.get(user.id, [])
        coach = concerned_coach(user, every)
        if kind == "coach" and not coach:
            continue
        mine = [item for item in every if item.team_id in scope]
        if kind == "coach" and filtered:
            mine = [item for item in mine if item.kind == "coach"]
        if filtered and not mine:
            continue
        item = view(user, records.get(user.id), mine, coach, kind)
        if missing and not item.missing:
            continue
        result.append(item)
    return result


@router.put("/licenses/{user_id}", response_model=LicenseView)
def update_license(user_id: str, body: LicenseInput, db: DB, actor: Admin) -> LicenseView:
    lock_licenses(db)
    user = get(db, User, user_id)
    value = db.get(License, user_id)
    current: dict[str, str] = {
        "status": value.status if value else "none",
        "coach_status": value.coach_status if value else "none",
    }
    wanted: dict[str, str] = {
        "status": body.status or current["status"],
        "coach_status": body.coach_status or current["coach_status"],
    }
    for field, required in BEFORE_ACTIVE.items():
        if wanted[field] == "active" and current[field] not in {required, "active"}:
            kind = "coach" if field == "coach_status" else "joueur"
            raise HTTPException(
                422,
                f"Une licence {kind} devient active uniquement après « {LABELS[required]} »",
            )
    if "active" in wanted.values() and not body.number:
        raise HTTPException(422, "Un numéro de licence est requis pour une licence active")
    if body.number and db.scalar(
        select(License.user_id).where(License.number == body.number, License.user_id != user_id)
    ):
        raise HTTPException(409, "Ce numéro de licence est déjà attribué")
    if value is None:
        value = License(user_id=user_id)
        db.add(value)
    value.number = body.number
    value.status, value.coach_status = wanted["status"], wanted["coach_status"]
    value.updated_at, value.updated_by = now(), actor.id
    db.flush()
    if user.id != actor.id:
        for field, label in (("status", "Licence joueur"), ("coach_status", "Licence coach")):
            if wanted[field] != current[field]:
                notify(
                    db,
                    user,
                    f"license:{user.id}:{field}:{token()}",
                    "license",
                    f"{label} : {LABELS[wanted[field]]}",
                    send_email=False,
                    link="/app/profil",
                )
    # Le numéro de licence devient l’identifiant du compte (temporaire sans numéro).
    user = rekey(db, user)
    value = db.get(License, user.id)
    mine = list(db.scalars(select(Assignment).where(Assignment.user_id == user.id)))
    return view(user, value, mine, concerned_coach(user, mine))
