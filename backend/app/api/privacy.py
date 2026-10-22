"""Droits RGPD exercés par la personne elle-même : accès, portabilité et effacement."""

from datetime import date, datetime
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field
from sqlalchemy import delete, or_, select

from app.api.auth import lock_auth, rate_limit
from app.api.common import DB, Actor, session_cookie
from app.core.security import digest, hash_password, verify_password
from app.persistence.models import (
    Assignment,
    Base,
    ChangeRequest,
    CoachEventRequest,
    Dossier,
    DossierDocument,
    Event,
    EventRevision,
    Follow,
    HiddenThread,
    License,
    LoginSession,
    Notification,
    QuestionMessage,
    QuestionThread,
    Registration,
    StaffRequest,
    User,
    listed,
)

router = APIRouter(prefix="/me", tags=["Comptes"])

# Jamais exportés : secrets d’authentification.
SECRET_FIELDS = {"password_hash"}


class ErasureInput(BaseModel):
    password: str = Field(min_length=1, max_length=128)


class PasswordChangeInput(BaseModel):
    current_password: str = Field(min_length=1, max_length=128)
    new_password: str = Field(min_length=12, max_length=128)


def plain(value: Base) -> dict[str, Any]:
    """Colonnes d’une ligne, en valeurs JSON."""
    result: dict[str, Any] = {}
    for column in value.__table__.columns:
        if column.name in SECRET_FIELDS:
            continue
        item = getattr(value, column.key)
        result[column.name] = item.isoformat() if isinstance(item, date | datetime) else item
    return result


@router.get("/export")
def export(db: DB, actor: Actor) -> dict[str, Any]:
    """Toutes les données rattachées au compte, dans un format réutilisable (JSON)."""
    me = actor.id
    threads = list(db.scalars(select(QuestionThread).where(QuestionThread.user_id == me)))
    thread_ids = [thread.id for thread in threads]
    license = db.get(License, me)
    return {
        "compte": plain(actor),
        "licence": plain(license) if license else None,
        "rattachements": [
            plain(v) for v in db.scalars(select(Assignment).where(Assignment.user_id == me))
        ],
        "inscriptions": [
            plain(v) for v in db.scalars(select(Registration).where(Registration.user_id == me))
        ],
        "suivis": [plain(v) for v in db.scalars(select(Follow).where(Follow.user_id == me))],
        "dossiers_d_inscription": [
            plain(v) for v in db.scalars(select(Dossier).where(Dossier.user_id == me))
        ],
        # État des pièces seulement : les fichiers se téléchargent depuis l’application.
        "pieces_demandees": [
            plain(v)
            for v in db.scalars(
                select(DossierDocument)
                .join(Dossier, Dossier.id == DossierDocument.dossier_id)
                .where(Dossier.user_id == me)
            )
        ],
        "evenements_referent": [
            plain(v) for v in db.scalars(select(Event).where(listed(Event.referent_ids, me)))
        ],
        "notifications": [
            plain(v) for v in db.scalars(select(Notification).where(Notification.user_id == me))
        ],
        "conversations": [plain(v) for v in threads],
        "conversations_supprimees": [
            plain(v) for v in db.scalars(select(HiddenThread).where(HiddenThread.user_id == me))
        ],
        "messages": [
            plain(v)
            for v in db.scalars(
                select(QuestionMessage).where(
                    or_(QuestionMessage.author_id == me, QuestionMessage.thread_id.in_(thread_ids))
                )
            )
        ],
        "demandes_de_modification": [
            plain(v) for v in db.scalars(select(ChangeRequest).where(ChangeRequest.actor_id == me))
        ],
        "demandes_d_evenement": [
            plain(v)
            for v in db.scalars(select(CoachEventRequest).where(CoachEventRequest.actor_id == me))
        ],
        "demandes_aux_administrateurs": [
            plain(v) for v in db.scalars(select(StaffRequest).where(StaffRequest.actor_id == me))
        ],
        "historique": [
            plain(v) for v in db.scalars(select(EventRevision).where(EventRevision.actor_id == me))
        ],
    }


@router.post("/delete", status_code=204)
def erase(body: ErasureInput, db: DB, actor: Actor, response: Response) -> None:
    """Effacement immédiat du compte, confirmé par le mot de passe."""
    from app.api.accounts import erase_account

    user = db.get(User, actor.id)
    if user is None or not verify_password(body.password, user.password_hash):
        raise HTTPException(403, "Mot de passe incorrect")
    erase_account(db, user)
    response.delete_cookie("lsoc_session", path="/")
    response.delete_cookie("lsoc_csrf", path="/")


@router.post("/password", status_code=204, dependencies=[Depends(rate_limit)])
def change_password(
    body: PasswordChangeInput,
    db: DB,
    actor: Actor,
    cookie: Annotated[str | None, Depends(session_cookie)],
) -> None:
    """Nouveau mot de passe, confirmé par l’actuel ; les autres sessions sont fermées."""
    user = db.get(User, actor.id)
    if user is None or not verify_password(body.current_password, user.password_hash):
        raise HTTPException(403, "Mot de passe actuel incorrect")
    lock_auth(db)
    user.password_hash = hash_password(body.new_password)
    db.execute(
        delete(LoginSession).where(
            LoginSession.user_id == user.id, LoginSession.hash != digest(cookie or "")
        )
    )


@router.post("/sessions/revoke", status_code=204)
def revoke_other_sessions(
    db: DB, actor: Actor, cookie: Annotated[str | None, Depends(session_cookie)]
) -> None:
    """Déconnecte tous les autres appareils ; la session courante reste ouverte."""
    db.execute(
        delete(LoginSession).where(
            LoginSession.user_id == actor.id, LoginSession.hash != digest(cookie or "")
        )
    )
