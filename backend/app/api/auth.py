from datetime import timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy import case, delete, select, text
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.api.common import DB, Actor, session_cookie
from app.api.schemas import (
    ActivateInput,
    EmailInput,
    LoginInput,
    LoginView,
    MeView,
    ResetInput,
    Status,
    TokenInput,
)
from app.core.config import settings
from app.core.security import digest, hash_password, now, token, verify_password
from app.persistence.database import SessionFactory
from app.persistence.models import AuthToken, LoginSession, RateBucket, User
from app.services.notifications import email

router = APIRouter(prefix="/auth", tags=["Authentification"])


def rate_limit(request: Request) -> None:
    key = digest(
        settings.secret_key
        + request.url.path
        + (request.client.host if request.client else "unknown")
    )
    current = now()
    with SessionFactory.begin() as db:
        statement = insert(RateBucket).values(
            key=key, count=1, expires_at=current + timedelta(minutes=15)
        )
        count_statement = statement.on_conflict_do_update(
            index_elements=[RateBucket.key],
            set_={
                "count": case((RateBucket.expires_at <= current, 1), else_=RateBucket.count + 1),
                "expires_at": case(
                    (RateBucket.expires_at <= current, current + timedelta(minutes=15)),
                    else_=RateBucket.expires_at,
                ),
            },
        ).returning(RateBucket.count)
        count = db.scalar(count_statement)
    if count is not None and count > 30:
        raise HTTPException(
            429, "Trop de tentatives, réessayez plus tard", headers={"Retry-After": "900"}
        )


def lock_auth(db: Session) -> None:
    db.execute(text("SELECT pg_advisory_xact_lock(781013)"))


def issue_token(db: Session, user: User, purpose: str, hours: int) -> str:
    lock_auth(db)
    db.execute(delete(AuthToken).where(AuthToken.user_id == user.id, AuthToken.purpose == purpose))
    value = token()
    db.add(
        AuthToken(
            hash=digest(value),
            user_id=user.id,
            purpose=purpose,
            expires_at=now() + timedelta(hours=hours),
        )
    )
    return value


def consume(db: Session, raw: str, purpose: str) -> User:
    lock_auth(db)
    item = db.scalar(
        select(AuthToken)
        .where(AuthToken.hash == digest(raw), AuthToken.purpose == purpose)
        .with_for_update()
    )
    if item is None or item.expires_at <= now():
        raise HTTPException(400, "Lien invalide ou expiré")
    user = db.get(User, item.user_id)
    if user is None:
        raise HTTPException(400, "Lien invalide ou expiré")
    db.delete(item)
    db.flush()
    return user


@router.post(
    "/activate", response_model=Status, status_code=202, dependencies=[Depends(rate_limit)]
)
def activate(body: ActivateInput, db: DB) -> Status:
    user = consume(db, body.token, "invitation")
    if user.active:
        raise HTTPException(400, "Compte déjà actif")
    user.email = str(body.email).lower()
    user.password_hash = hash_password(body.password)
    value = issue_token(db, user, "verify", 24)
    email(
        db,
        user,
        f"verify:{digest(value)}",
        "Vérification de votre adresse",
        f"{settings.frontend_url}/verify-email?token={value}",
    )
    return Status(message="Vérifiez votre adresse e-mail pour activer votre compte")


@router.post("/verify-email", response_model=Status, dependencies=[Depends(rate_limit)])
def verify_email(body: TokenInput, db: DB) -> Status:
    user = consume(db, body.token, "verify")
    if not user.email or not user.password_hash:
        raise HTTPException(400, "Activation incomplète")
    user.active = True
    return Status(message="Compte activé")


@router.post(
    "/resend-verification",
    response_model=Status,
    status_code=202,
    dependencies=[Depends(rate_limit)],
)
def resend_verification(body: EmailInput, db: DB) -> Status:
    user = db.scalar(
        select(User).where(User.email == str(body.email).lower(), User.active.is_(False))
    )
    if user:
        value = issue_token(db, user, "verify", 24)
        email(
            db,
            user,
            f"verify:{digest(value)}",
            "Vérification de votre adresse",
            f"{settings.frontend_url}/verify-email?token={value}",
        )
    return Status(message="Si le compte existe, un lien a été envoyé")


@router.post("/login", response_model=LoginView, dependencies=[Depends(rate_limit)])
def login(body: LoginInput, response: Response, db: DB) -> LoginView:
    user = db.scalar(select(User).where(User.email == str(body.email).lower()))
    valid = verify_password(body.password, user.password_hash if user else None)
    if not valid or user is None or not user.active:
        raise HTTPException(401, "Identifiants invalides")
    raw, csrf = token(), token()
    db.add(
        LoginSession(
            hash=digest(raw),
            user_id=user.id,
            csrf_hash=digest(csrf),
            expires_at=now() + timedelta(hours=settings.session_hours),
        )
    )
    response.set_cookie(
        "lsoc_session",
        raw,
        httponly=True,
        secure=settings.cookie_secure,
        samesite="lax",
        max_age=settings.session_hours * 3600,
        path="/",
    )
    response.set_cookie(
        "lsoc_csrf",
        csrf,
        httponly=False,
        secure=settings.cookie_secure,
        samesite="lax",
        max_age=settings.session_hours * 3600,
        path="/",
    )
    return LoginView(user=MeView.model_validate(user), csrf_token=csrf)


@router.get("/me", response_model=MeView)
def me(user: Actor) -> User:
    return user


@router.post("/logout", status_code=204)
def logout(
    user: Actor, db: DB, response: Response, cookie: Annotated[str | None, Depends(session_cookie)]
) -> None:
    if cookie:
        db.execute(delete(LoginSession).where(LoginSession.hash == digest(cookie)))
    response.delete_cookie("lsoc_session", path="/")
    response.delete_cookie("lsoc_csrf", path="/")


@router.post(
    "/forgot-password", response_model=Status, status_code=202, dependencies=[Depends(rate_limit)]
)
def forgot_password(body: EmailInput, db: DB) -> Status:
    user = db.scalar(
        select(User).where(User.email == str(body.email).lower(), User.active.is_(True))
    )
    if user:
        value = issue_token(db, user, "recovery", 1)
        email(
            db,
            user,
            f"recovery:{digest(value)}",
            "Réinitialisation du mot de passe",
            f"{settings.frontend_url}/reset-password?token={value}",
        )
    return Status(message="Si le compte existe, un lien a été envoyé")


@router.post("/reset-password", response_model=Status, dependencies=[Depends(rate_limit)])
def reset_password(body: ResetInput, db: DB) -> Status:
    user = consume(db, body.token, "recovery")
    if not user.active:
        raise HTTPException(400, "Compte inactif")
    user.password_hash = hash_password(body.password)
    db.execute(delete(LoginSession).where(LoginSession.user_id == user.id))
    return Status(message="Mot de passe modifié")
