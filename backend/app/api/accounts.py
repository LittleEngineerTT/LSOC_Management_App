from datetime import timedelta

from fastapi import APIRouter, HTTPException, Query
from sqlalchemy import delete, select, text

from app.api.auth import issue_token, lock_auth
from app.api.common import DB, Actor, Admin, get
from app.api.schemas import (
    AssignmentInput,
    AssignmentView,
    InvitationView,
    MeView,
    PasswordResetView,
    Preferences,
    PublicProfileView,
    UserInput,
    UsernameInput,
    UserView,
)
from app.core.config import settings
from app.core.security import now
from app.persistence.models import (
    Assignment,
    AuthToken,
    ChangeRequest,
    CoachEventRequest,
    EmailJob,
    Event,
    EventRevision,
    FFVBMatchState,
    LoginSession,
    Team,
    User,
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
    db: DB, actor: Admin, limit: int = Query(100, ge=1, le=500), offset: int = Query(0, ge=0)
) -> list[User]:
    return list(
        db.scalars(select(User).order_by(User.first_name, User.id).offset(offset).limit(limit))
    )


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
    user = get(db, User, user_id)
    protect_last_admin(db, user, [])
    from app.api.auth import lock_auth
    from app.services.events import lock_planning

    lock_planning(db)
    lock_auth(db)
    db.refresh(user)
    # Scrub account identifiers embedded in historical JSON, not just foreign keys.
    for revision in db.scalars(select(EventRevision)):
        for field in ("before", "after"):
            values = dict(getattr(revision, field))
            if values.get("referent_id") == user_id:
                values["referent_id"] = None
                setattr(revision, field, values)
    for change in db.scalars(select(ChangeRequest)):
        if change.actor_id == user_id and change.status == "pending":
            change.status = "withdrawn"
        if change.changes.get("referent_id") == user_id:
            values = dict(change.changes)
            values.pop("referent_id")
            change.changes = values
            if change.status == "pending":
                change.status = "withdrawn"
    for request in db.scalars(select(CoachEventRequest)):
        if request.actor_id == user_id:
            request.actor_name = "Compte supprimé"
            request.note = ""
            request.decision = ""
            values = dict(request.proposal)
            values["referent_id"] = None
            request.proposal = values
            if request.status == "pending":
                request.status = "withdrawn"
        if request.decided_by == user_id:
            request.decider_name = "Compte supprimé"
            request.decision = ""
    for state in db.scalars(select(FFVBMatchState)):
        state.protected = {
            key: None if value == user_id else value for key, value in state.protected.items()
        }
    for event in db.scalars(select(Event).where(Event.referent_id == user_id)):
        event.referent_id = None
        event.direct_edit = False
        event.version += 1
        admins(
            db,
            f"orphan:{event.id}:{event.version}",
            "referent_missing",
            f"Référent à réattribuer : {event.title}",
            event.id,
        )
    for team in db.scalars(select(Team).where(Team.referent_id == user_id)):
        team.referent_id = None
        admins(
            db,
            f"team-orphan:{team.id}:{issue_marker()}",
            "referent_missing",
            f"Référent d’équipe à réattribuer : {team.name}",
            link="/app/administration?tab=teams",
        )
    db.execute(delete(LoginSession).where(LoginSession.user_id == user_id))
    db.delete(user)


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
    value = Assignment(user_id=user_id, **body.model_dump())
    db.add(value)
    db.flush()
    identifier = value.id
    # La section d’un compte sans licence entre dans son identifiant temporaire.
    user = rekey(db, user)
    alert_duplicates(db, user)
    return get(db, Assignment, identifier)


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
