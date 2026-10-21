from datetime import timedelta

from fastapi import APIRouter, HTTPException, Query
from sqlalchemy import delete, select, text
from sqlalchemy.orm import Session

from app.api.auth import issue_token, lock_auth
from app.api.common import DB, Actor, Admin, coached_teams, get
from app.api.schemas import (
    AssignmentInput,
    AssignmentView,
    InvitationView,
    MeView,
    PasswordResetView,
    PlayerDetailsInput,
    Preferences,
    PublicProfileView,
    UserInput,
    UsernameInput,
    UserView,
)
from app.core.config import settings
from app.core.security import now
from app.integrations import s3
from app.persistence.models import (
    Assignment,
    AuthToken,
    ChangeRequest,
    CoachEventRequest,
    Dossier,
    DossierDocument,
    EmailJob,
    Event,
    EventRevision,
    FFVBMatchState,
    License,
    LoginSession,
    Position,
    StaffRequest,
    Team,
    User,
    listed,
)
from app.services.identity import alert_duplicates, rekey
from app.services.notifications import admins, notify

router = APIRouter(tags=["Comptes"])


def initial(last_name: str) -> str:
    return last_name.strip()[:1].upper()


def protect_last_admin(db: DB, user: User, next_roles: list[str]) -> None:
    db.execute(text("SELECT pg_advisory_xact_lock(781010)"))
    if user.active and "admin" in user.roles and "admin" not in next_roles:
        active = list(db.scalars(select(User).where(User.active.is_(True))))
        if sum("admin" in value.roles for value in active) <= 1:
            raise HTTPException(409, "Le dernier administrateur actif doit avoir un remplaçant")


def invitation(db: DB, user: User) -> InvitationView:
    from app.api.auth import lock_auth

    lock_auth(db)
    db.refresh(user)
    if user.active:
        raise HTTPException(409, "Compte déjà actif")
    db.execute(delete(AuthToken).where(AuthToken.user_id == user.id))
    db.execute(delete(EmailJob).where(EmailJob.user_id == user.id))
    user.username, user.password_hash = None, None
    value = issue_token(db, user, "invitation", 168)
    return InvitationView(
        user=UserView.model_validate(user),
        invitation_token=value,
        invitation_url=f"{settings.frontend_url}/activate?token={value}",
    )


@router.get("/users", response_model=list[UserView])
def users(
    db: DB, actor: Actor, limit: int = Query(100, ge=1, le=500), offset: int = Query(0, ge=0)
) -> list[User]:
    """Tous les comptes ; pour un coach, les membres de ses équipes seulement."""
    query = select(User)
    allowed = coached_teams(db, actor)
    if allowed is not None:
        query = query.where(
            User.id.in_(select(Assignment.user_id).where(Assignment.team_id.in_(allowed)))
        )
    return list(db.scalars(query.order_by(User.first_name, User.id).offset(offset).limit(limit)))


@router.post("/users", response_model=InvitationView, status_code=201)
def create_user(body: UserInput, db: DB, actor: Admin) -> InvitationView:
    if not body.last_name:
        raise HTTPException(422, "Le nom de famille est requis")
    user = User(**body.model_dump(exclude={"last_name"}), last_initial=initial(body.last_name))
    db.add(user)
    db.flush()
    # Sans licence ni équipe : identifiant temporaire « initiale-prénom-sans-section ».
    user = rekey(db, user)
    return invitation(db, user)


@router.get("/users/{user_id}", response_model=UserView)
def user_detail(user_id: str, db: DB, actor: Admin) -> User:
    return get(db, User, user_id)


@router.put("/users/{user_id}", response_model=UserView)
def update_user(user_id: str, body: UserInput, db: DB, actor: Admin) -> User:
    user = get(db, User, user_id)
    protect_last_admin(db, user, list(body.roles))
    from app.services.events import lock_planning

    lock_planning(db)
    db.refresh(user)
    for key, value in body.model_dump(exclude={"last_name"}).items():
        setattr(user, key, value)
    if body.last_name:
        user.last_initial = initial(body.last_name)
    for assignment in db.scalars(select(Assignment).where(Assignment.user_id == user_id)):
        role = "coach" if assignment.kind == "coach" else "member"
        if role not in user.roles:
            db.delete(assignment)
    user = rekey(db, user)
    alert_duplicates(db, user)
    notify(
        db,
        user,
        f"account:{issue_marker()}",
        "account_changed",
        "Votre compte a été mis à jour",
        link="/app/profil",
    )
    return user


def issue_marker() -> str:
    from app.core.security import token

    return token()


@router.post("/users/{user_id}/invitation", response_model=InvitationView)
def regenerate_invitation(user_id: str, db: DB, actor: Admin) -> InvitationView:
    return invitation(db, get(db, User, user_id))


@router.delete("/users/{user_id}", status_code=204)
def delete_user(user_id: str, db: DB, actor: Admin) -> None:
    erase_account(db, get(db, User, user_id))


def without(ids: list[str], user_id: str) -> list[str]:
    return [item for item in ids if item != user_id]


def erase_account(db: Session, user: User) -> None:
    """Efface un compte et ses traces : par un administrateur, par la personne ou à expiration."""
    user_id = user.id
    protect_last_admin(db, user, [])
    from app.api.auth import lock_auth
    from app.services.events import lock_planning

    lock_planning(db)
    lock_auth(db)
    db.refresh(user)
    record = db.get(License, user_id)
    if record is not None:
        s3.discard(record.file_key)
    # Les pièces des dossiers d’inscription quittent le stockage avec le compte.
    for key in db.scalars(
        select(DossierDocument.file_key)
        .join(Dossier, Dossier.id == DossierDocument.dossier_id)
        .where(Dossier.user_id == user_id, DossierDocument.file_key.is_not(None))
    ):
        s3.discard(key)
    # Scrub account identifiers embedded in historical JSON, not just foreign keys.
    for revision in db.scalars(select(EventRevision)):
        for field in ("before", "after"):
            values = dict(getattr(revision, field))
            if user_id in values.get("referent_ids", []):
                values["referent_ids"] = without(values["referent_ids"], user_id)
                setattr(revision, field, values)
    for change in db.scalars(select(ChangeRequest)):
        if change.actor_id == user_id and change.status == "pending":
            change.status = "withdrawn"
        if user_id in change.changes.get("referent_ids", []):
            values = dict(change.changes)
            remaining = without(values.pop("referent_ids"), user_id)
            if remaining:
                values["referent_ids"] = remaining
            change.changes = values
            if change.status == "pending":
                change.status = "withdrawn"
    for request in db.scalars(select(CoachEventRequest)):
        if request.actor_id == user_id:
            request.actor_name = "Compte supprimé"
            request.note = ""
            request.decision = ""
            values = dict(request.proposal)
            values["referent_ids"] = without(values.get("referent_ids", []), user_id)
            request.proposal = values
            if request.status == "pending":
                request.status = "withdrawn"
        if request.decided_by == user_id:
            request.decider_name = "Compte supprimé"
            request.decision = ""
    for staff in db.scalars(select(StaffRequest).where(StaffRequest.actor_id == user_id)):
        staff.actor_name = "Compte supprimé"
        staff.description = ""
        if staff.status == "pending":
            staff.status = "withdrawn"
    for state in db.scalars(select(FFVBMatchState)):
        state.protected = {
            key: None if value == user_id else value for key, value in state.protected.items()
        }
    for event in db.scalars(select(Event).where(listed(Event.referent_ids, user_id))):
        event.referent_ids = without(event.referent_ids, user_id)
        event.version += 1
        if event.referent_ids:
            continue
        event.direct_edit = False
        admins(
            db,
            f"orphan:{event.id}:{event.version}",
            "referent_missing",
            f"Référent à réattribuer : {event.title}",
            event.id,
        )
    for team in db.scalars(select(Team).where(listed(Team.referent_ids, user_id))):
        team.referent_ids = without(team.referent_ids, user_id)
        if team.referent_ids:
            continue
        admins(
            db,
            f"team-orphan:{team.id}:{issue_marker()}",
            "referent_missing",
            f"Référent d’équipe à réattribuer : {team.name}",
            link="/app/administration?tab=sections",
        )
    db.execute(delete(LoginSession).where(LoginSession.user_id == user_id))
    db.delete(user)


@router.get("/assignments", response_model=list[AssignmentView])
def every_assignment(
    db: DB, actor: Actor, limit: int = Query(500, ge=1, le=500), offset: int = Query(0, ge=0)
) -> list[Assignment]:
    """Rattachements, pour filtrer les utilisateurs ; ceux de ses équipes pour un coach."""
    query = select(Assignment)
    allowed = coached_teams(db, actor)
    if allowed is not None:
        query = query.where(Assignment.team_id.in_(allowed))
    return list(db.scalars(query.order_by(Assignment.id).offset(offset).limit(limit)))


@router.get("/users/{user_id}/assignments", response_model=list[AssignmentView])
def assignments(user_id: str, db: DB, actor: Actor) -> list[Assignment]:
    if actor.id != user_id and "admin" not in actor.roles:
        raise HTTPException(403, "Rattachements privés")
    get(db, User, user_id)
    return list(db.scalars(select(Assignment).where(Assignment.user_id == user_id)))


@router.post("/users/{user_id}/assignments", response_model=AssignmentView, status_code=201)
def assign(user_id: str, body: AssignmentInput, db: DB, actor: Admin) -> Assignment:
    user = get(db, User, user_id)
    get(db, Team, body.team_id)
    role = "coach" if body.kind == "coach" else "member"
    if role not in user.roles:
        raise HTTPException(422, "Le rôle correspondant est requis")
    player_details(db, body.kind, body)
    value = Assignment(user_id=user_id, **body.model_dump())
    db.add(value)
    db.flush()
    identifier = value.id
    if body.kind == "coach":
        # Le coach rattaché devient référent de l’équipe, avec ses événements.
        from app.services.events import lock_planning, reassign_team_events

        lock_planning(db)
        team = get(db, Team, body.team_id)
        if user.id not in team.referent_ids:
            previous = list(team.referent_ids)
            team.referent_ids = [*previous, user.id]
            reassign_team_events(db, team, previous, actor)
            db.flush()
    # La section d’un compte sans licence entre dans son identifiant temporaire.
    user = rekey(db, user)
    alert_duplicates(db, user)
    return get(db, Assignment, identifier)


def player_details(db: DB, kind: str, body: PlayerDetailsInput) -> None:
    if kind != "player" and (body.number is not None or body.position_id is not None):
        raise HTTPException(422, "Numéro et poste sont réservés aux joueurs")
    if body.position_id is not None:
        get(db, Position, body.position_id)


@router.put("/users/{user_id}/assignments/{assignment_id}", response_model=AssignmentView)
def update_assignment(
    user_id: str, assignment_id: str, body: PlayerDetailsInput, db: DB, actor: Admin
) -> Assignment:
    """Numéro de maillot et poste d’un joueur dans son équipe ; un numéro déjà pris : 409."""
    value = get(db, Assignment, assignment_id)
    if value.user_id != user_id:
        raise HTTPException(404, "Rattachement introuvable")
    player_details(db, value.kind, body)
    value.number, value.position_id = body.number, body.position_id
    db.flush()
    return value


@router.delete("/users/{user_id}/assignments/{assignment_id}", response_model=UserView)
def unassign(user_id: str, assignment_id: str, db: DB, actor: Admin) -> User:
    """Retire un rattachement ; renvoie le compte, dont l’identifiant temporaire peut changer."""
    from app.services.events import lock_planning

    lock_planning(db)
    value = get(db, Assignment, assignment_id)
    if value.user_id != user_id:
        raise HTTPException(404, "Rattachement introuvable")
    db.delete(value)
    db.flush()
    return rekey(db, get(db, User, user_id))


@router.put("/preferences", response_model=MeView)
def preferences(body: Preferences, db: DB, actor: Actor) -> User:
    for key, value in body.model_dump(exclude_unset=True).items():
        if key == "email" and value is not None:
            value = str(value).lower()
        setattr(actor, key, value)
    return actor


@router.put("/users/{user_id}/username", response_model=UserView)
def change_username(user_id: str, body: UsernameInput, db: DB, actor: Admin) -> User:
    lock_auth(db)
    user = get(db, User, user_id)
    if not user.active:
        raise HTTPException(409, "L’utilisateur choisira son identifiant à l’activation")
    if db.scalar(select(User.id).where(User.username == body.username, User.id != user.id)):
        raise HTTPException(409, "Cet identifiant est déjà utilisé")
    if user.username != body.username:
        user.username = body.username
        db.execute(delete(LoginSession).where(LoginSession.user_id == user.id))
    return user


@router.post("/users/{user_id}/password-reset", response_model=PasswordResetView)
def password_reset(user_id: str, db: DB, actor: Admin) -> PasswordResetView:
    lock_auth(db)
    user = get(db, User, user_id)
    if not user.active:
        raise HTTPException(409, "Utilisez l’invitation pour un compte qui n’est pas encore actif")
    value = issue_token(db, user, "recovery", 1)
    return PasswordResetView(
        reset_token=value,
        reset_url=f"{settings.frontend_url}/reset-password?token={value}",
        expires_at=now() + timedelta(hours=1),
    )


@router.get("/profiles/{user_id}", response_model=PublicProfileView)
def public_profile(user_id: str, db: DB, actor: Actor) -> User:
    value = get(db, User, user_id)
    if not value.active:
        raise HTTPException(404, "Profil introuvable")
    return value


@router.delete("/users/{user_id}/invitation", status_code=204)
def revoke_invitation(user_id: str, db: DB, actor: Admin) -> None:
    from app.api.auth import lock_auth

    lock_auth(db)
    user = get(db, User, user_id)
    if user.active:
        raise HTTPException(409, "Compte déjà actif")
    db.execute(delete(AuthToken).where(AuthToken.user_id == user_id))
    db.execute(delete(EmailJob).where(EmailJob.user_id == user_id))
