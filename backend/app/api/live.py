"""Flux temps réel des pastilles (Server-Sent Events).

Le navigateur garde une connexion `GET /live` ouverte ; à chaque signal NOTIFY qui le concerne
(`app.persistence.signals`), il reçoit `event: unread` et relit `GET /unread`. Chaque processus
de l’API n’ouvre qu’une connexion PostgreSQL d’écoute, partagée par tous ses flux, quel que soit
le nombre de navigateurs connectés.

Le flux ne prolonge pas la session (chemin passif). Il envoie un commentaire toutes les
`HEARTBEAT` secondes pour traverser les proxys, revérifie la session toutes les `CHECK` secondes
(`event: session` puis fermeture si elle a pris fin) et se ferme après `LIFETIME` secondes :
EventSource se reconnecte seul, ce qui répartit les connexions après un redéploiement.
"""

import asyncio
import json
import logging
from collections.abc import AsyncIterator
from dataclasses import dataclass, field

import psycopg
from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse
from psycopg import sql
from starlette.concurrency import run_in_threadpool

from app.api.common import Actor
from app.core.security import digest, now
from app.persistence.database import SessionFactory, engine
from app.persistence.models import LoginSession, User
from app.persistence.signals import CHANNEL

log = logging.getLogger(__name__)
router = APIRouter(tags=["Temps réel"])

# Sous le délai d’inactivité courant des proxys (60 s).
HEARTBEAT = 25.0
CHECK = 60.0
LIFETIME = 3600.0
# Regroupe les signaux d’une même rafale (alerte et e-mail à plusieurs comptes…).
COALESCE = 0.25
RETRY_MS = 5000


@dataclass(eq=False)
class Subscriber:
    user_id: str
    admin: bool
    wake: asyncio.Event = field(default_factory=asyncio.Event)


def conninfo() -> str:
    return engine.url.set(drivername="postgresql").render_as_string(hide_password=False)


class Hub:
    """Abonnés de ce processus et écoute du canal NOTIFY, démarrée au premier abonné."""

    def __init__(self) -> None:
        self.subscribers: set[Subscriber] = set()
        self.task: asyncio.Task[None] | None = None

    def subscribe(self, user_id: str, admin: bool) -> Subscriber:
        subscriber = Subscriber(user_id, admin)
        self.subscribers.add(subscriber)
        if self.task is None or self.task.done():
            self.task = asyncio.get_running_loop().create_task(self.listen())
        return subscriber

    def unsubscribe(self, subscriber: Subscriber) -> None:
        self.subscribers.discard(subscriber)

    def wake_all(self) -> None:
        for subscriber in self.subscribers:
            subscriber.wake.set()

    def dispatch(self, payload: str) -> None:
        try:
            data = json.loads(payload)
            users = set(data.get("u") or [])
            admins = bool(data.get("a"))
        except (ValueError, AttributeError, TypeError):
            # Signal illisible : tout le monde relit ses compteurs plutôt que de rien manquer.
            self.wake_all()
            return
        for subscriber in self.subscribers:
            if subscriber.user_id in users or (admins and subscriber.admin):
                subscriber.wake.set()

    async def listen(self) -> None:
        delay = 1.0
        while self.subscribers:
            try:
                async with await psycopg.AsyncConnection.connect(
                    conninfo(), autocommit=True
                ) as connection:
                    await connection.execute(sql.SQL("LISTEN {}").format(sql.Identifier(CHANNEL)))
                    delay = 1.0
                    # Des signaux ont pu passer avant l’écoute ou pendant une coupure.
                    self.wake_all()
                    while self.subscribers:
                        async for item in connection.notifies(timeout=HEARTBEAT):
                            self.dispatch(item.payload)
            except (psycopg.Error, OSError):
                log.warning("Écoute des signaux interrompue ; nouvel essai", exc_info=True)
                await asyncio.sleep(delay)
                delay = min(delay * 2, 30.0)


hub = Hub()


def still_valid(token_digest: str, user_id: str) -> bool:
    with SessionFactory() as db:
        record = db.get(LoginSession, token_digest)
        if record is None or record.user_id != user_id or record.expires_at <= now():
            return False
        user = db.get(User, user_id)
        return user is not None and user.active


def frame(name: str) -> str:
    return f"event: {name}\ndata: {{}}\n\n"


@router.get("/live", response_class=StreamingResponse)
async def live(request: Request, actor: Actor) -> StreamingResponse:
    """Flux `text/event-stream` : `unread` quand les pastilles du compte changent, `session`
    quand la session a pris fin, et des commentaires de maintien."""
    token_digest = digest(request.cookies.get("lsoc_session", ""))
    user_id, admin = actor.id, "admin" in actor.roles

    async def stream() -> AsyncIterator[str]:
        loop = asyncio.get_running_loop()
        subscriber = hub.subscribe(user_id, admin)
        started = checked = loop.time()
        try:
            yield f"retry: {RETRY_MS}\n\n"
            # Une reconnexion a pu manquer des signaux : le navigateur relit ses compteurs.
            yield frame("unread")
            while loop.time() - started < LIFETIME:
                try:
                    await asyncio.wait_for(subscriber.wake.wait(), HEARTBEAT)
                except TimeoutError:
                    yield ": ping\n\n"
                else:
                    await asyncio.sleep(COALESCE)
                    subscriber.wake.clear()
                    yield frame("unread")
                if loop.time() - checked >= CHECK:
                    checked = loop.time()
                    if not await run_in_threadpool(still_valid, token_digest, user_id):
                        yield frame("session")
                        return
        finally:
            hub.unsubscribe(subscriber)

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            # Sans quoi nginx (et d’autres proxys) retiennent les événements dans leur tampon.
            "X-Accel-Buffering": "no",
        },
    )
