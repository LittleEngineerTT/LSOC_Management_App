from collections.abc import Iterator
from datetime import timedelta
from typing import Annotated

from fastapi import Depends, HTTPException, Request, Response
from fastapi.security import APIKeyCookie
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.security import digest, now
from app.persistence.database import SessionFactory
from app.persistence.models import LoginSession, User

session_cookie = APIKeyCookie(name="lsoc_session", auto_error=False)


def get_db() -> Iterator[Session]:
    with SessionFactory.begin() as db:
        yield db


DB = Annotated[Session, Depends(get_db, scope="function")]


def get[T](db: Session, model: type[T], identifier: str) -> T:
    value = db.get(model, identifier)
    if value is None:
        raise HTTPException(404, "Ressource introuvable")
    return value


# Le délai d’inactivité n’est repoussé qu’une fois par heure, pour éviter une écriture par requête.
SESSION_REFRESH = timedelta(hours=1)
# Rafraîchissements automatiques de l’interface : ils ne comptent pas comme une activité.
PASSIVE_PATHS = ("/api/v1/unread",)


def session_lifetime() -> timedelta:
    return timedelta(days=settings.session_idle_days)


def set_session_cookies(response: Response, raw: str, csrf: str) -> None:
    for name, value, httponly in (("lsoc_session", raw, True), ("lsoc_csrf", csrf, False)):
        response.set_cookie(
            name,
            value,
            httponly=httponly,
            secure=settings.cookie_secure,
            samesite="lax",
            max_age=int(session_lifetime().total_seconds()),
            path="/",
        )


def current_user(
    request: Request,
    response: Response,
    db: DB,
    cookie: Annotated[str | None, Depends(session_cookie)],
) -> User:
    record = db.get(LoginSession, digest(cookie)) if cookie else None
    if record is None or record.expires_at <= now():
        raise HTTPException(401, "Connexion requise")
    user = db.get(User, record.user_id)
    if user is None or not user.active:
        raise HTTPException(401, "Connexion requise")
    from app.services.identity import has_access

    # Sans numéro de licence, aucune activité n’est possible (sauf pour un administrateur).
    if not has_access(db, user):
        raise HTTPException(401, "Licence requise")
    if request.method not in {"GET", "HEAD", "OPTIONS"}:
        supplied = request.headers.get("X-CSRF-Token", "")
        if not supplied or digest(supplied) != record.csrf_hash:
            raise HTTPException(403, "Jeton CSRF invalide")
    deadline = now() + session_lifetime()
    if (
        cookie
        and request.url.path not in PASSIVE_PATHS
        and deadline - record.expires_at >= SESSION_REFRESH
    ):
        record.expires_at = deadline
        # Activité réelle : repousse aussi la purge des comptes inactifs.
        user.last_seen_at = now()
        csrf = request.cookies.get("lsoc_csrf", "")
        # Le cookie CSRF n’est renouvelé que s’il correspond bien à cette session.
        if csrf and digest(csrf) == record.csrf_hash:
            set_session_cookies(response, cookie, csrf)
    return user


Actor = Annotated[User, Depends(current_user)]


def admin_user(user: Actor) -> User:
    require_admin(user)
    return user


def require_admin(user: User) -> None:
    if "admin" not in user.roles:
        raise HTTPException(403, "Droit administrateur requis")


Admin = Annotated[User, Depends(admin_user)]
