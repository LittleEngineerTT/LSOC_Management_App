from datetime import datetime, timedelta
from typing import Any

import httpx
from fastapi import HTTPException
from sqlalchemy import delete, select, text
from sqlalchemy.orm import Session

from app.api.common import get
from app.core.config import settings
from app.core.security import now
from app.integrations.ffvb import fetch, normalize, parse_calendar
from app.persistence.models import (
    ClubSettings,
    Event,
    FFVBConflict,
    FFVBMatchState,
    FFVBSource,
    GymMapping,
    Gymnasium,
    Team,
    User,
)
from app.services.events import check_capacity, lock_gyms, lock_planning, revision, snapshot
from app.services.notifications import admins, email, event_changed


def defaults(db: Session) -> ClubSettings:
    db.execute(text("SELECT pg_advisory_xact_lock(781012)"))
    value = db.get(ClubSettings, 1)
    if value is None:
        value = ClubSettings(
            id=1,
            before_minutes=settings.match_before_minutes,
            after_minutes=settings.match_after_minutes,
            courts=settings.match_courts,
        )
        db.add(value)
        db.flush()
    return value


class Venues:
    """Résolution du gymnase local d’un match FFVB.

    Ordre : association FFVB explicite, puis gymnase local de même nom lorsque l’équipe qui
    reçoit est du club (préfixe configuré). Les noms sont comparés sans accents ni casse.
    """

    def __init__(self, db: Session) -> None:
        self.mapped = {
            normalize(m.official_name): m.gymnasium_id for m in db.scalars(select(GymMapping))
        }
        self.local = {normalize(g.name): g.id for g in db.scalars(select(Gymnasium))}
        self.prefix = normalize(settings.ffvb_home_prefix)

    def club_hosts(self, home_team: str) -> bool:
        return bool(self.prefix) and normalize(home_team).startswith(self.prefix)

    def resolve(self, location: str, home_team: str, team_name: str) -> tuple[bool, str | None]:
        club_hosts = self.club_hosts(home_team)
        home = club_hosts or normalize(home_team) == normalize(team_name)
        if not home:
            return False, None
        key = normalize(location)
        gym = self.mapped.get(key)
        if gym is None and club_hosts:
            gym = self.local.get(key)
        return True, gym


def match_settings(db: Session, source: FFVBSource) -> tuple[int, int, int]:
    """Marges avant/après et terrains effectifs d’une source : les siens, sinon ceux du club."""
    config = defaults(db)
    return (
        config.before_minutes if source.before_minutes is None else source.before_minutes,
        config.after_minutes if source.after_minutes is None else source.after_minutes,
        config.courts if source.courts is None else source.courts,
    )


def apply_source_settings(
    db: Session, source: FFVBSource, previous: tuple[int, int, int], actor: User
) -> int:
    """Reporte les réglages effectifs d’une source sur ses matchs à venir.

    Une valeur modifiée à la main sur un match (différente de l’ancien réglage) est conservée.
    """
    current = match_settings(db, source)
    if current == previous:
        return 0
    changed = 0
    for state, event in db.execute(
        select(FFVBMatchState, Event)
        .join(Event, Event.ffvb_match_id == FFVBMatchState.id)
        .where(FFVBMatchState.source_id == source.id, Event.kickoff_at > now())
        .order_by(Event.kickoff_at, Event.id)
    ):
        values = (event.before_minutes, event.after_minutes, event.match_courts)
        updated = tuple(
            new if value == old else value
            for value, old, new in zip(values, previous, current, strict=True)
        )
        if updated == values:
            continue
        lock_gyms(db, [event.gymnasium_id])
        before = snapshot(event)
        event.before_minutes, event.after_minutes, event.match_courts = updated
        if apply_official(
            db, event, state, state.official, actor=actor, action="source_settings", before=before
        ):
            changed += 1
    return changed


def delete_source(db: Session, source: FFVBSource, actor: User, cancel_upcoming: bool) -> None:
    """Supprime une source ; ses matchs deviennent des événements ordinaires non synchronisés.

    Avec `cancel_upcoming`, les matchs à venir sont annulés, ce qui libère leurs terrains.
    """
    lock_planning(db)
    states = list(db.scalars(select(FFVBMatchState).where(FFVBMatchState.source_id == source.id)))
    for state in states:
        event = db.scalar(select(Event).where(Event.ffvb_match_id == state.id))
        if event is None:
            continue
        before = snapshot(event)
        event.ffvb_match_id = None
        event.occupancy_unknown = False
        if cancel_upcoming and not event.cancelled and event.starts_at > now():
            event.cancelled = True
        event.version += 1
        db.flush()
        revision(db, event, actor, before, "ffvb_source_deleted")
        event_changed(db, event, actor.id)
    identifiers = [state.id for state in states]
    if identifiers:
        db.execute(delete(FFVBConflict).where(FFVBConflict.match_id.in_(identifiers)))
        db.execute(delete(FFVBMatchState).where(FFVBMatchState.id.in_(identifiers)))
    db.delete(source)


def remap_venues(db: Session) -> int:
    """Réapplique les gymnases aux matchs déjà importés ; renvoie le nombre de matchs changés."""
    lock_planning(db)
    venues = Venues(db)
    changed = 0
    for state in db.scalars(select(FFVBMatchState).order_by(FFVBMatchState.id)):
        if state.disabled or (state.suspended_until is not None and state.suspended_until > now()):
            continue
        source = db.get(FFVBSource, state.source_id)
        event = db.scalar(select(Event).where(Event.ffvb_match_id == state.id))
        if source is None or event is None:
            continue
        official = dict(state.official)
        home, gym = venues.resolve(
            str(official.get("location", "")),
            str(official.get("home_team", "")),
            source.team_name,
        )
        if official.get("gymnasium_id") == gym and official.get("home") == home:
            continue
        official["gymnasium_id"], official["home"] = gym, home
        lock_gyms(db, [event.gymnasium_id, gym])
        state.official = official
        if apply_official(db, event, state, official):
            changed += 1
    return changed


def official_value(event: Event, key: str) -> str | None:
    value = getattr(event, key)
    return value.isoformat() if isinstance(value, datetime) else value


def apply_official(
    db: Session,
    event: Event,
    state: FFVBMatchState,
    official: dict[str, Any],
    initial: bool = False,
    actor: User | None = None,
    action: str | None = None,
    before: dict[str, Any] | None = None,
) -> bool:
    # `before` permet à l’appelant d’historiser une modification faite juste avant l’appel.
    before = snapshot(event) if before is None else before
    for key in ("kickoff_at", "gymnasium_id", "location"):
        local = official_value(event, key)
        remote = official.get(key)
        if key in state.protected and local != remote:
            existing = db.scalar(
                select(FFVBConflict).where(
                    FFVBConflict.match_id == state.id,
                    FFVBConflict.field == key,
                    FFVBConflict.status == "open",
                )
            )
            if (
                existing is not None
                and existing.official_value == remote
                and existing.local_value == local
            ):
                continue
            if existing is not None:
                existing.status = "superseded"
            author_id = state.protected[key]
            conflict = FFVBConflict(
                match_id=state.id,
                field=key,
                official_value=remote,
                local_value=local,
                author_id=author_id,
            )
            db.add(conflict)
            db.flush()
            author = db.get(User, author_id) if author_id else None
            if author:
                # The divergence email belongs solely to its author, not the admin group.
                email(
                    db,
                    author,
                    f"ffvb-conflict:{conflict.id}",
                    "Conflit avec le calendrier FFVB",
                    f"Une valeur locale de {event.title} diffère de la FFVB. Consultez le conflit dans l’application.",
                )
            continue
        if key in state.protected:
            continue
        if key == "kickoff_at":
            event.kickoff_at = datetime.fromisoformat(remote) if remote else None
        else:
            setattr(event, key, remote)
    event.title = f"{official['home_team']} / {official['away_team']}"[:200]
    home = official["home"]
    # Local reservations follow the mapped location; unknown venues never select an arbitrary gym.
    event.occupancy_unknown = bool(home and event.gymnasium_id is None)
    if event.gymnasium_id is None:
        event.courts = 0
    else:
        event.courts = event.match_courts
    if event.kickoff_at:
        if home or event.gymnasium_id is not None:
            event.starts_at = event.kickoff_at - timedelta(minutes=event.before_minutes)
            event.ends_at = event.kickoff_at + timedelta(minutes=event.after_minutes)
        else:
            event.starts_at = event.kickoff_at
            event.ends_at = event.kickoff_at + timedelta(minutes=event.after_minutes)
    after = snapshot(event)
    changed = initial or before != after
    if changed:
        if not initial:
            event.version += 1
        state.last_changed_at = now()
        forced = check_capacity(db, event, None, True)
        revision(
            db,
            event,
            actor,
            {} if initial else before,
            action or ("import" if initial else ("ffvb_accept" if actor else "sync")),
            forced,
            origin="human" if actor else "ffvb",
        )
        if not initial:
            event_changed(db, event, actor.id if actor else None)
        if event.occupancy_unknown:
            admins(
                db,
                f"ffvb-unmapped:{event.id}:{event.version}",
                "ffvb_unmapped",
                f"Gymnase FFVB à associer : {event.location}",
                event.id,
            )
    return changed


def sync_source(db: Session, source: FFVBSource, client: httpx.Client) -> bool:
    fetch_started = now()
    identity = (source.team_id, source.season, source.entity, source.pool, source.team_name)
    if not source.enabled:
        return False
    team = get(db, Team, source.team_id)
    referent = db.get(User, team.referent_id) if team.referent_id else None
    if referent is None or not referent.active:
        lock_planning(db)
        source.next_check_at = now() + timedelta(minutes=source.interval_minutes)
        source.last_error = "Un référent actif doit être configuré sur l’équipe"
        return False
    try:
        html = fetch(client, source.season, source.entity, source.pool)
        matches = parse_calendar(html, source.season, source.entity, source.pool, source.team_name)
    except (httpx.HTTPError, ValueError):
        lock_planning(db)
        db.refresh(source)
        if source.last_success_at is not None and source.last_success_at > fetch_started:
            return False
        source.next_check_at = now() + timedelta(minutes=source.interval_minutes)
        source.last_error = "La source FFVB est indisponible ou inexploitable"
        return False
    lock_planning(db)
    db.refresh(source)
    if not source.enabled or (
        source.last_success_at is not None and source.last_success_at > fetch_started
    ):
        return False
    source.next_check_at = now() + timedelta(minutes=source.interval_minutes)
    if identity != (source.team_id, source.season, source.entity, source.pool, source.team_name):
        source.last_error = (
            "Configuration modifiée pendant la récupération ; nouvelle vérification nécessaire"
        )
        return False
    db.refresh(team)
    referent = db.get(User, team.referent_id) if team.referent_id else None
    if referent is None or not referent.active:
        source.last_error = "Un référent actif doit être configuré sur l’équipe"
        return False
    venues = Venues(db)
    seen: set[str] = set()
    before, after, courts = match_settings(db, source)
    for match in matches:
        seen.add(match.code)
        state = db.scalar(
            select(FFVBMatchState).where(
                FFVBMatchState.season == source.season,
                FFVBMatchState.entity == source.entity,
                FFVBMatchState.match_code == match.code,
            )
        )
        if state is not None and (
            state.disabled or (state.suspended_until is not None and state.suspended_until > now())
        ):
            continue
        if match.location is None and state is None:
            # Match déjà joué jamais importé : passé et sans lieu connu, il n’est pas créé.
            continue
        location = (
            match.location
            if match.location is not None
            else str(state.official.get("location", ""))
            if state is not None
            else ""
        )
        home, gym = venues.resolve(location, match.home_team, source.team_name)
        official: dict[str, Any] = {
            "kickoff_at": match.kickoff_at.isoformat(),
            "gymnasium_id": gym,
            "location": location,
            "home_team": match.home_team,
            "away_team": match.away_team,
            "home": home,
        }
        initial = state is None
        if state is None:
            state = FFVBMatchState(
                source_id=source.id,
                season=source.season,
                entity=source.entity,
                match_code=match.code,
                official=official,
            )
            db.add(state)
            db.flush()
            event = Event(
                title=f"{match.home_team} / {match.away_team}"[:200],
                kind="match",
                section_ids=[team.section_id],
                gymnasium_id=official["gymnasium_id"],
                location=location,
                starts_at=match.kickoff_at,
                ends_at=match.kickoff_at + timedelta(minutes=after),
                courts=courts if official["gymnasium_id"] else 0,
                referent_id=team.referent_id,
                ffvb_match_id=state.id,
                kickoff_at=match.kickoff_at,
                before_minutes=before,
                after_minutes=after,
                match_courts=courts,
            )
            db.add(event)
            db.flush()
        else:
            existing_event = db.scalar(select(Event).where(Event.ffvb_match_id == state.id))
            if existing_event is None:
                raise HTTPException(409, "État FFVB sans événement")
            event = existing_event
        lock_gyms(db, [event.gymnasium_id, official["gymnasium_id"]])
        state.official = official
        state.last_verified_at = now()
        state.missing = False
        state.suspended_until = None
        apply_official(db, event, state, official, initial)
    for state in db.scalars(select(FFVBMatchState).where(FFVBMatchState.source_id == source.id)):
        if (
            state.match_code not in seen
            and not state.disabled
            and not (state.suspended_until and state.suspended_until > now())
        ):
            if not state.missing:
                admins(
                    db,
                    f"ffvb-missing:{state.id}:{now().isoformat()}",
                    "ffvb_missing",
                    f"Match FFVB absent : {state.match_code}",
                )
            state.missing = True
    source.last_success_at = now()
    source.last_error = None
    return True


def resolve(db: Session, conflict: FFVBConflict, action: str, actor: User) -> FFVBMatchState:
    lock_planning(db)
    if conflict.status != "open":
        raise HTTPException(409, "Conflit déjà résolu")
    state = get(db, FFVBMatchState, conflict.match_id)
    event = db.scalar(select(Event).where(Event.ffvb_match_id == state.id))
    if event is None:
        raise HTTPException(404, "Événement FFVB introuvable")
    before = snapshot(event) | {
        "ffvb_disabled": state.disabled,
        "ffvb_suspended_until": state.suspended_until.isoformat()
        if state.suspended_until
        else None,
    }
    conflict.resolved_by = actor.id
    conflict.resolver_name = actor.first_name
    conflict.resolved_at = now()
    if action == "accept_ffvb":
        protected = dict(state.protected)
        protected.pop(conflict.field, None)
        state.protected = protected
        lock_gyms(db, [event.gymnasium_id, state.official.get("gymnasium_id")])
        conflict.status = "accepted"
        changed = apply_official(db, event, state, state.official, actor=actor)
        if not changed:
            revision(db, event, actor, snapshot(event), "ffvb_accept")
    elif action == "suspend_48h":
        state.suspended_until = now() + timedelta(hours=48)
    elif action == "disable":
        state.disabled = True
    if action != "accept_ffvb":
        for other in db.scalars(
            select(FFVBConflict).where(
                FFVBConflict.match_id == state.id, FFVBConflict.status == "open"
            )
        ):
            other.status = "suspended" if action == "suspend_48h" else "disabled"
            other.resolved_by = actor.id
            other.resolver_name = actor.first_name
            other.resolved_at = now()
        event.version += 1
        from app.persistence.models import EventRevision

        after = snapshot(event) | {
            "ffvb_disabled": state.disabled,
            "ffvb_suspended_until": state.suspended_until.isoformat()
            if state.suspended_until
            else None,
        }
        db.add(
            EventRevision(
                event_id=event.id,
                actor_id=actor.id,
                actor_name=actor.first_name,
                origin="human",
                action=action,
                before=before,
                after=after,
            )
        )
        event_changed(db, event, actor.id)
    return state
