from collections.abc import Iterator
from typing import Annotated

from fastapi import Depends, HTTPException, Request
from fastapi.security import APIKeyCookie
from sqlalchemy.orm import Session

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


def current_user(
    request: Request, db: DB, cookie: Annotated[str | None, Depends(session_cookie)]
) -> User:
    record = db.get(LoginSession, digest(cookie)) if cookie else None
    if record is None or record.expires_at <= now():
        raise HTTPException(401, "Connexion requise")
    user = db.get(User, record.user_id)
    if user is None or not user.active:
        raise HTTPException(401, "Connexion requise")
    if request.method not in {"GET", "HEAD", "OPTIONS"}:
        supplied = request.headers.get("X-CSRF-Token", "")
        if not supplied or digest(supplied) != record.csrf_hash:
            raise HTTPException(403, "Jeton CSRF invalide")
    return user


Actor = Annotated[User, Depends(current_user)]


def admin_user(user: Actor) -> User:
    require_admin(user)
    return user


def require_admin(user: User) -> None:
    if "admin" not in user.roles:
        raise HTTPException(403, "Droit administrateur requis")


Admin = Annotated[User, Depends(admin_user)]
