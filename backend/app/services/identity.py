"""Identifiant des comptes : numéro de licence, ou à défaut `initiale-prénom-section`."""

import re
import secrets
import string
import unicodedata
from typing import Any

from fastapi import HTTPException
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.persistence.models import (
    Assignment,
    ChangeRequest,
    CoachEventRequest,
    EventRevision,
    FFVBMatchState,
    License,
    Section,
    Team,
    User,
)
from app.services.notifications import admins

# Les colonnes de clé étrangère font 36 caractères : chaque partie est raccourcie.
ID_LENGTH = 36


def slug(value: str) -> str:
    bare = unicodedata.normalize("NFKD", value)
    bare = "".join(char for char in bare if not unicodedata.combining(char)).lower()
    return re.sub(r"[^a-z0-9]+", "-", bare).strip("-")


def user_sections(db: Session, user_id: str) -> list[Section]:
    return list(
        db.scalars(
            select(Section)
            .join(Team, Team.section_id == Section.id)
            .join(Assignment, Assignment.team_id == Team.id)
            .where(Assignment.user_id == user_id)
            .distinct()
            .order_by(Section.name, Section.id)
        )
    )


def temporary_base(db: Session, user: User) -> str:
    sections = user_sections(db, user.id)
    section = slug(sections[0].name) if sections else "sans-section"
    first = slug(user.first_name) or "membre"
    initial = slug(user.last_initial) or "x"
    # Place laissée au suffixe « -abc » d’un doublon.
    return f"{initial}-{first[:14]}-{section[:15]}".strip("-")[: ID_LENGTH - 4]


def desired_id(db: Session, user: User) -> str:
    license = db.get(License, user.id)
    if license is not None and license.number:
        return license.number
    base = temporary_base(db, user)
    # Un identifiant temporaire déjà attribué (avec ou sans suffixe) reste stable.
    if user.id == base or re.fullmatch(re.escape(base) + r"-[a-z]{3}", user.id):
        return user.id
    candidate = base
    while db.get(User, candidate) is not None:
        candidate = f"{base}-{''.join(secrets.choice(string.ascii_lowercase) for _ in range(3))}"
    return candidate


def replace_in(values: dict[str, Any], old: str, new: str) -> dict[str, Any] | None:
    if values.get("referent_id") != old:
        return None
    return values | {"referent_id": new}


def rename_user(db: Session, user: User, new_id: str) -> User:
    """Change l’identifiant d’un compte ; clés étrangères et références JSON suivent."""
    old = user.id
    if db.get(User, new_id) is not None:
        raise HTTPException(409, "Cet identifiant de compte est déjà utilisé")
    db.flush()
    # La licence a pour clé l’identifiant du compte : son instance devient obsolète.
    license = db.get(License, old)
    if license is not None:
        db.expunge(license)
    db.execute(text("UPDATE users SET id = :new WHERE id = :old"), {"new": new_id, "old": old})
    for revision in db.scalars(select(EventRevision)):
        for field in ("before", "after"):
            changed = replace_in(dict(getattr(revision, field)), old, new_id)
            if changed is not None:
                setattr(revision, field, changed)
    for change in db.scalars(select(ChangeRequest)):
        changed = replace_in(dict(change.changes), old, new_id)
        if changed is not None:
            change.changes = changed
    for request in db.scalars(select(CoachEventRequest)):
        changed = replace_in(dict(request.proposal), old, new_id)
        if changed is not None:
            request.proposal = changed
    for state in db.scalars(select(FFVBMatchState)):
        if old in state.protected.values():
            state.protected = {
                key: new_id if value == old else value for key, value in state.protected.items()
            }
    db.flush()
    db.expunge(user)
    db.expire_all()
    renamed = db.get(User, new_id)
    assert renamed is not None
    return renamed


def rekey(db: Session, user: User) -> User:
    """Aligne l’identifiant du compte sur sa licence ou son identifiant temporaire."""
    wanted = desired_id(db, user)
    return user if wanted == user.id else rename_user(db, user, wanted)


def alert_duplicates(db: Session, user: User) -> None:
    """Alerte les admins si un autre compte de la section a le même prénom et la même initiale."""
    key = (slug(user.first_name), slug(user.last_initial))
    for section in user_sections(db, user.id):
        twins = sorted(
            other.id
            for other in db.scalars(
                # Comptes encore en attente d’activation compris : le doublon se voit dès la création.
                select(User).where(
                    User.id.in_(
                        select(Assignment.user_id)
                        .join(Team, Team.id == Assignment.team_id)
                        .where(Team.section_id == section.id)
                    ),
                )
            )
            if (slug(other.first_name), slug(other.last_initial)) == key
        )
        if len(twins) > 1:
            name = f"{user.first_name} {user.last_initial}.".strip()
            admins(
                db,
                f"duplicate:{section.id}:{'+'.join(twins)}",
                "duplicate_user",
                f"Doublon possible dans {section.name} : {name}",
                link="/app/administration?tab=users",
            )


def has_access(db: Session, user: User) -> bool:
    """Un compte ne sert qu’avec un numéro de licence, sauf pour les administrateurs."""
    if "admin" in user.roles:
        return True
    license = db.get(License, user.id)
    return license is not None and bool(license.number)
