"""Photos des entraîneurs, présentées dans « Notre club » : déposées par le coach depuis son
profil ou par un administrateur, stockées sur le S3 public sous un nom aléatoire."""

import secrets
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request
from sqlalchemy import text

from app.api.common import DB, Actor, Admin, get
from app.api.schemas import MeView, UserView
from app.integrations import s3
from app.persistence.models import User

router = APIRouter(tags=["Photos"])

MAX_PHOTO_BYTES = 5 * 1024 * 1024
# Formats acceptés, reconnus à leur signature et non au seul type annoncé.
SIGNATURES = {
    "image/jpeg": lambda body: body.startswith(b"\xff\xd8\xff"),
    "image/png": lambda body: body.startswith(b"\x89PNG\r\n\x1a\n"),
    "image/webp": lambda body: body[:4] == b"RIFF" and body[8:12] == b"WEBP",
}
UNSUPPORTED = "La photo doit être une image JPEG, PNG ou WebP"


async def photo_body(request: Request) -> tuple[bytes, str]:
    """Corps brut d’une image JPEG, PNG ou WebP de 5 Mo au plus, avec son type."""
    content_type = request.headers.get("content-type", "").split(";")[0].strip().lower()
    if content_type not in SIGNATURES:
        raise HTTPException(415, UNSUPPORTED)
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > MAX_PHOTO_BYTES:
        raise HTTPException(413, "La photo dépasse 5 Mo")
    body = bytearray()
    async for chunk in request.stream():
        body += chunk
        if len(body) > MAX_PHOTO_BYTES:
            raise HTTPException(413, "La photo dépasse 5 Mo")
    if not SIGNATURES[content_type](bytes(body)):
        raise HTTPException(415, UNSUPPORTED)
    return bytes(body), content_type


# Corps lu seulement après le contrôle de la session, du CSRF et du rôle : sinon n’importe qui
# ferait charger 5 Mo en mémoire par requête.
async def own_photo_body(request: Request, actor: Actor) -> tuple[bytes, str]:
    return await photo_body(request)


async def admin_photo_body(request: Request, actor: Admin) -> tuple[bytes, str]:
    return await photo_body(request)


PHOTO_BODY = {
    "requestBody": {
        "required": True,
        "content": {
            kind: {"schema": {"type": "string", "format": "binary"}} for kind in SIGNATURES
        },
    }
}


def lock_photos(db: DB) -> None:
    db.execute(text("SELECT pg_advisory_xact_lock(781016)"))


def require_coach(user: User) -> None:
    if "coach" not in user.roles:
        raise HTTPException(409, "Seuls les entraîneurs ont une photo")


def store(db: DB, user: User, body: bytes, content_type: str, tasks: BackgroundTasks) -> User:
    """Dépose la photo et remplace la précédente, effacée après la validation."""
    if not s3.configured():
        raise HTTPException(503, "Stockage des photos non configuré")
    require_coach(user)
    # Nom de 64 caractères aléatoires : l’adresse publique ne se devine pas.
    key = f"photos/{secrets.token_hex(32)}"
    try:
        s3.put(key, body, content_type, "inline")
    except s3.StorageError as error:
        raise HTTPException(502, str(error)) from error
    lock_photos(db)
    db.refresh(user)
    previous, user.photo_key = user.photo_key, key
    db.flush()
    tasks.add_task(s3.discard, previous)
    return user


def remove(db: DB, user: User, tasks: BackgroundTasks) -> User:
    lock_photos(db)
    db.refresh(user)
    if user.photo_key is None:
        raise HTTPException(404, "Aucune photo")
    previous, user.photo_key = user.photo_key, None
    db.flush()
    tasks.add_task(s3.discard, previous)
    return user


@router.put("/me/photo", response_model=MeView, openapi_extra=PHOTO_BODY)
def upload_own(
    actor: Actor,
    body: Annotated[tuple[bytes, str], Depends(own_photo_body)],
    tasks: BackgroundTasks,
    db: DB,
) -> User:
    """Photo de l’entraîneur connecté, présentée dans les dirigeants de « Notre club »."""
    return store(db, actor, *body, tasks)


@router.delete("/me/photo", response_model=MeView)
def delete_own(actor: Actor, tasks: BackgroundTasks, db: DB) -> User:
    return remove(db, actor, tasks)


@router.put("/users/{user_id}/photo", response_model=UserView, openapi_extra=PHOTO_BODY)
def upload_for(
    user_id: str,
    actor: Admin,
    body: Annotated[tuple[bytes, str], Depends(admin_photo_body)],
    tasks: BackgroundTasks,
    db: DB,
) -> User:
    """Photo d’un entraîneur, déposée par un administrateur (à la création du compte…)."""
    return store(db, get(db, User, user_id), *body, tasks)


@router.delete("/users/{user_id}/photo", response_model=UserView)
def delete_for(user_id: str, actor: Admin, tasks: BackgroundTasks, db: DB) -> User:
    return remove(db, get(db, User, user_id), tasks)
