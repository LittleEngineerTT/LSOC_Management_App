"""Signal « pastilles à rafraîchir », émis par PostgreSQL NOTIFY dans la transaction qui écrit.

Toute écriture d’une notification ou d’un message (création, lecture, suppression), par l’API
comme par le worker, signale les comptes concernés sur le canal `CHANNEL`. NOTIFY n’est remis
qu’à la validation de la transaction, et jamais si elle est annulée : un navigateur ne recharge
ses compteurs que lorsque les données ont changé. Le signal ne porte que des identifiants de
comptes ; les compteurs eux-mêmes se relisent par `GET /unread`, avec les droits habituels.
"""

import json
from typing import Any

from sqlalchemy import event, select, text
from sqlalchemy.orm import Session

from app.persistence.models import Notification, QuestionMessage, QuestionThread

CHANNEL = "lsoc_live"
# Une charge NOTIFY est limitée à 8000 octets : les identifiants partent par lots.
BATCH = 100
PENDING = "live_signal"


def _pending(session: Session) -> dict[str, Any]:
    return session.info.setdefault(PENDING, {"users": set(), "threads": set()})


@event.listens_for(Session, "after_flush")
def _collect(session: Session, _context: object) -> None:
    for item in (*session.new, *session.dirty, *session.deleted):
        if isinstance(item, Notification):
            _pending(session)["users"].add(item.user_id)
        elif isinstance(item, QuestionMessage):
            _pending(session)["threads"].add(item.thread_id)


@event.listens_for(Session, "after_flush_postexec")
def _emit(session: Session, _context: object) -> None:
    pending = session.info.pop(PENDING, None)
    if not pending:
        return
    users: set[str] = set(pending["users"])
    admins = False
    if pending["threads"]:
        # Un message concerne l’auteur du fil et, venant de lui, les administrateurs.
        owners = select(QuestionThread.user_id).where(QuestionThread.id.in_(pending["threads"]))
        with session.no_autoflush:
            users |= set(session.scalars(owners))
        admins = True
    send(session, sorted(users), admins)


def send(session: Session, users: list[str], admins: bool = False) -> None:
    """Signale `users` (et tous les administrateurs si `admins`) à la validation."""
    if session.get_bind().dialect.name != "postgresql":
        return
    batches = [users[index : index + BATCH] for index in range(0, len(users), BATCH)] or [[]]
    for index, batch in enumerate(batches):
        everyone = admins and index == 0
        if not batch and not everyone:
            continue
        payload = json.dumps({"u": batch, "a": everyone}, separators=(",", ":"))
        session.execute(
            text("SELECT pg_notify(:channel, :payload)"), {"channel": CHANNEL, "payload": payload}
        )
