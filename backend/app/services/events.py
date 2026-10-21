from datetime import UTC, date, datetime, time, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from fastapi import HTTPException
from sqlalchemy import delete, func, select, text
from sqlalchemy.orm import Session

from app.api.common import get, require_admin
from app.api.schemas import CapacityView, EventInput, EventPatch, EventView
from app.core.security import token
from app.domain.capacity import capacity_segments
from app.persistence.models import (
    AvailabilityBlock,
    ChangeRequest,
    CoachEventRequest,
    Event,
    EventRevision,
    EventSeries,
    FFVBMatchState,
    FFVBSource,
    Gymnasium,
    QuestionThread,
    Registration,
    Section,
    Team,
    User,
)
from app.services.notifications import admins, event_changed, event_deleted, event_unavailable

PARIS = ZoneInfo("Europe/Paris")


def lock_planning(db: Session) -> None:
    # Club-level lock keeps series/import/move lock acquisition ordered in V1.
    db.execute(text("SELECT pg_advisory_xact_lock(781011)"))


def lock_gyms(db: Session, identifiers: list[str | None]) -> None:
    lock_planning(db)
    for identifier in sorted({item for item in identifiers if item is not None}):
        value = db.scalar(select(Gymnasium).where(Gymnasium.id == identifier).with_for_update())
        if value is None:
            raise HTTPException(404, "Gymnase introuvable")


def availability(db: Session, gym_id: str, start: datetime, end: datetime) -> CapacityView:
    gym = get(db, Gymnasium, gym_id)
    events = db.scalars(
        select(Event).where(
            Event.gymnasium_id == gym_id,
            Event.cancelled.is_(False),
            Event.starts_at < end,
            Event.ends_at > start,
        )
    )
    blocks = db.scalars(
        select(AvailabilityBlock).where(
            AvailabilityBlock.gymnasium_id == gym_id,
            AvailabilityBlock.starts_at < end,
            AvailabilityBlock.ends_at > start,
        )
    )
    reservations = [(e.starts_at, e.ends_at, e.courts) for e in events] + [
        (b.starts_at, b.ends_at, b.courts) for b in blocks
    ]
    return CapacityView(
        gymnasium_id=gym_id,
        capacity=gym.capacity,
        segments=capacity_segments(gym.capacity, start, end, reservations),
    )


def blocking(db: Session, event: Event) -> AvailabilityBlock | None:
    """Indisponibilité qui ne laisse pas assez de terrains à l’événement.

    Seules les indisponibilités comptent : un conflit entre événements reste une alerte de
    capacité, tandis que l’indisponibilité est prioritaire et annule l’événement.
    """
    if event.cancelled or not event.gymnasium_id or event.courts <= 0:
        return None
    gym = get(db, Gymnasium, event.gymnasium_id)
    blocks = list(
        db.scalars(
            select(AvailabilityBlock)
            .where(
                AvailabilityBlock.gymnasium_id == event.gymnasium_id,
                AvailabilityBlock.starts_at < event.ends_at,
                AvailabilityBlock.ends_at > event.starts_at,
            )
            .order_by(AvailabilityBlock.starts_at, AvailabilityBlock.id)
        )
    )
    reservations = [(b.starts_at, b.ends_at, b.courts) for b in blocks]
    reservations.append((event.starts_at, event.ends_at, event.courts))
    segments = capacity_segments(gym.capacity, event.starts_at, event.ends_at, reservations)
    return blocks[0] if blocks and any(s.excess for s in segments) else None


def cancel_if_blocked(db: Session, event: Event, actor: User | None, record: bool = True) -> bool:
    """Annule sans erreur un événement placé sur une indisponibilité et prévient ses membres.

    `record=False` laisse l’appelant historiser l’annulation avec sa propre révision.
    """
    block = blocking(db, event)
    if block is None:
        return False
    before = snapshot(event)
    event.cancelled = True
    if record:
        event.version += 1
        revision(db, event, actor, before, "unavailability_cancel", origin="unavailability")
    db.flush()
    event_unavailable(db, event, block)
    return True


def apply_unavailability(db: Session, block: AvailabilityBlock, actor: User) -> None:
    """Annule les événements que l’indisponibilité prive de terrains, puis alerte le reste."""
    for event in db.scalars(
        select(Event)
        .where(
            Event.gymnasium_id == block.gymnasium_id,
            Event.cancelled.is_(False),
            Event.starts_at < block.ends_at,
            Event.ends_at > block.starts_at,
        )
        .order_by(Event.starts_at, Event.id)
    ):
        cancel_if_blocked(db, event, actor)
    alert_capacity(db, block.gymnasium_id)


def check_capacity(db: Session, event: Event, actor: User | None, force: bool) -> bool:
    if event.cancelled or not event.gymnasium_id:
        return False
    db.flush()
    # L’indisponibilité l’emporte : l’événement est annulé plutôt que refusé.
    if cancel_if_blocked(db, event, actor, record=False):
        return False
    segments = availability(db, event.gymnasium_id, event.starts_at, event.ends_at).segments
    conflicts = [s.model_dump(mode="json") for s in segments if s.excess > 0]
    if conflicts:
        if not force or (actor is not None and "admin" not in actor.roles):
            raise HTTPException(409, {"code": "capacity_exceeded", "segments": conflicts})
        admins(
            db,
            f"capacity:{event.id}:{event.version}",
            "capacity_conflict",
            f"Capacité dépassée : {event.title}",
            event.id,
        )
    return bool(conflicts)


def alert_capacity(db: Session, gym_id: str) -> None:
    for event in db.scalars(
        select(Event).where(Event.gymnasium_id == gym_id, Event.cancelled.is_(False))
    ):
        if any(s.excess for s in availability(db, gym_id, event.starts_at, event.ends_at).segments):
            admins(
                db,
                f"capacity-block:{event.id}:{token()}",
                "capacity_conflict",
                f"Capacité dépassée : {event.title}",
                event.id,
            )


REFERENT_ROLES = {"coach", "admin"}


def check_referents(db: Session, identifiers: list[str], previous: list[str] | None = None) -> None:
    """Référents distincts et actifs ; seuls les coachs et les administrateurs peuvent le devenir.

    Un référent déjà en place (`previous`) le reste, même sans ce rôle, jusqu’à son retrait.
    """
    if len(set(identifiers)) != len(identifiers):
        raise HTTPException(422, "Référent en double")
    for identifier in identifiers:
        user = get(db, User, identifier)
        if not user.active:
            raise HTTPException(422, "Chaque référent doit avoir un compte actif")
        if identifier not in (previous or []) and not REFERENT_ROLES & set(user.roles):
            raise HTTPException(
                422, "Seuls les coachs et les administrateurs peuvent être référents"
            )


def validate_event(db: Session, event: Event, previous_referents: list[str] | None = None) -> None:
    if event.ends_at <= event.starts_at:
        raise HTTPException(422, "La fin doit suivre le début")
    if len(set(event.team_ids)) != len(event.team_ids):
        raise HTTPException(422, "Équipe organisatrice en double")
    # Les sections des équipes organisatrices sont toujours concernées.
    sections = list(event.section_ids)
    for identifier in event.team_ids:
        section = get(db, Team, identifier).section_id
        if section not in sections:
            sections.append(section)
    if sections != event.section_ids:
        event.section_ids = sections
    # Sans section organisatrice, l’événement n’existe que par ses inscriptions libres.
    if not event.section_ids and not (
        event.registration_section_ids or event.registration_team_ids
    ):
        raise HTTPException(
            422,
            "Sans section organisatrice, ouvrez les inscriptions à au moins une section ou équipe",
        )
    for identifier in event.section_ids:
        get(db, Section, identifier)
    check_referents(db, event.referent_ids, previous_referents)
    if event.gymnasium_id is None and event.courts != 0:
        raise HTTPException(422, "Un événement sans gymnase local doit occuper zéro terrain")
    if event.gymnasium_id is not None:
        get(db, Gymnasium, event.gymnasium_id)
        if event.courts <= 0:
            raise HTTPException(422, "Une réservation locale doit occuper au moins un terrain")
    if len(set(event.registration_section_ids)) != len(event.registration_section_ids):
        raise HTTPException(422, "Section d’inscription en double")
    for identifier in event.registration_section_ids:
        get(db, Section, identifier)
    if len(set(event.registration_team_ids)) != len(event.registration_team_ids):
        raise HTTPException(422, "Équipe d’inscription en double")
    for identifier in event.registration_team_ids:
        get(db, Team, identifier)
    if (
        event.registration_section_ids or event.registration_team_ids
    ) and event.registration_limit is None:
        raise HTTPException(422, "Une séance ouverte exige une limite d’inscrits")
    if event.registration_limit is not None:
        registered = db.scalar(
            select(func.count(Registration.id)).where(
                Registration.event_id == event.id, Registration.status == "accepted"
            )
        )
        if (registered or 0) > event.registration_limit:
            raise HTTPException(422, "La limite ne peut pas être inférieure au nombre d’inscrits")


def snapshot(event: Event) -> dict[str, Any]:
    # Le nombre d’inscrits n’est pas un champ modifiable : il reste hors de l’historique.
    return EventView.model_validate(event).model_dump(mode="json", exclude={"registration_count"})


def revision(
    db: Session,
    event: Event,
    actor: User | None,
    before: dict[str, Any],
    action: str,
    forced: bool = False,
    origin: str = "human",
) -> None:
    db.add(
        EventRevision(
            event_id=event.id,
            actor_id=actor.id if actor else None,
            actor_name=actor.first_name if actor else "FFVB",
            origin=origin,
            action=action,
            before=before,
            after=snapshot(event),
            forced=forced,
        )
    )


def team_events(db: Session, team: Team) -> list[Event]:
    """Événements d’une équipe : ses matchs FFVB et ceux nés de ses demandes de coach."""
    ffvb = (
        select(Event.id)
        .join(FFVBMatchState, FFVBMatchState.id == Event.ffvb_match_id)
        .join(FFVBSource, FFVBSource.id == FFVBMatchState.source_id)
        .where(FFVBSource.team_id == team.id)
    )
    requested = select(CoachEventRequest.event_id).where(
        CoachEventRequest.team_id == team.id, CoachEventRequest.event_id.is_not(None)
    )
    return list(
        db.scalars(
            select(Event)
            .where(Event.id.in_(ffvb.union(requested)))
            .order_by(Event.starts_at, Event.id)
        )
    )


def reassign_team_events(db: Session, team: Team, previous: list[str], actor: User) -> None:
    """Reporte les nouveaux référents d’équipe sur ses événements, passés compris.

    Un événement confié par un admin à d’autres référents que ceux de l’équipe garde
    ce choix explicite.
    """
    for event in team_events(db, team):
        if event.referent_ids not in (previous, []) or event.referent_ids == team.referent_ids:
            continue
        before = snapshot(event)
        event.referent_ids = list(team.referent_ids)
        event.direct_edit = False
        event.version += 1
        db.flush()
        revision(db, event, actor, before, "update")
        event_changed(db, event, actor.id)


def series_days(start: datetime, until: date, weekdays: list[int] | None) -> list[date]:
    """Jours des occurrences d’une série hebdomadaire, du premier événement à `until`."""
    first = start.astimezone(PARIS).date()
    if until < first or (until - first).days > 730:
        raise HTTPException(422, "La série doit durer de zéro à deux ans")
    chosen = sorted(weekdays or [first.weekday()])
    week = first - timedelta(days=first.weekday())
    days: list[date] = []
    while week <= until:
        days += [
            day
            for day in (week + timedelta(days=weekday) for weekday in chosen)
            if first <= day <= until
        ]
        week += timedelta(days=7)
    if not days:
        raise HTTPException(422, "Aucune occurrence entre le début et la fin de la série")
    return days


def occurrences(
    starts_at: datetime, ends_at: datetime, until: date | None, weekdays: list[int] | None
) -> list[tuple[datetime, datetime]]:
    """Créneaux d’un événement, ou de chaque occurrence de sa série (heure de Paris conservée)."""
    if until is None:
        return [(starts_at, ends_at)]
    start = starts_at.astimezone(PARIS)
    end = ends_at.astimezone(PARIS)
    span = (end.date() - start.date()).days
    result = []
    for day in series_days(start, until, weekdays):
        cursor = datetime.combine(day, time(), tzinfo=PARIS)
        result.append((wall_time(start, cursor), wall_time(end, cursor + timedelta(days=span))))
    return result


def no_court_left(db: Session, gym_id: str, start: datetime, end: datetime) -> bool:
    """Les autres événements occupent tous les terrains à un moment du créneau.

    Les indisponibilités sont exclues : elles annulent l’événement au lieu de le refuser.
    """
    gym = get(db, Gymnasium, gym_id)
    events = db.scalars(
        select(Event).where(
            Event.gymnasium_id == gym_id,
            Event.cancelled.is_(False),
            Event.starts_at < end,
            Event.ends_at > start,
        )
    )
    reservations = [(e.starts_at, e.ends_at, e.courts) for e in events]
    return any(s.available == 0 for s in capacity_segments(gym.capacity, start, end, reservations))


def create_series_events(
    db: Session,
    template: EventInput,
    until: date,
    weekdays: list[int] | None,
    actor: User,
    force: bool = False,
) -> list[Event]:
    """Matérialise une série hebdomadaire ; l’heure locale de Paris est conservée."""
    start = template.starts_at.astimezone(PARIS)
    end = template.ends_at.astimezone(PARIS)
    days = series_days(start, until, weekdays)
    series = EventSeries()
    db.add(series)
    db.flush()
    span = (end.date() - start.date()).days
    result: list[Event] = []
    for day in days:
        cursor = datetime.combine(day, time(), tzinfo=PARIS)
        values = template.model_dump()
        values["starts_at"] = wall_time(start, cursor)
        values["ends_at"] = wall_time(end, cursor + timedelta(days=span))
        result.append(create_event(db, EventInput.model_validate(values), actor, force, series.id))
    return result


def delete_event(db: Session, event: Event, actor: User) -> None:
    """Supprime définitivement un événement local et ses données attachées.

    Suivis, inscriptions et notifications disparaissent en cascade ; historique, demandes de
    modification et questions sont effacés ici. Les personnes concernées sont prévenues.
    """
    event_deleted(db, event, actor.id)
    db.execute(delete(EventRevision).where(EventRevision.event_id == event.id))
    db.execute(delete(ChangeRequest).where(ChangeRequest.event_id == event.id))
    db.execute(delete(QuestionThread).where(QuestionThread.event_id == event.id))
    db.delete(event)


def create_event(
    db: Session, body: EventInput, actor: User, force: bool = False, series_id: str | None = None
) -> Event:
    require_admin(actor)
    lock_gyms(db, [body.gymnasium_id])
    event = Event(**body.model_dump(), series_id=series_id)
    db.add(event)
    db.flush()
    validate_event(db, event)
    forced = check_capacity(db, event, actor, force)
    revision(db, event, actor, {}, "create", forced)
    return event


def permission(
    event: Event, actor: User, patch: EventPatch, direct: bool, acknowledge_ffvb: bool
) -> None:
    is_admin = "admin" in actor.roles
    if not is_admin:
        if actor.id not in event.referent_ids or (direct and not event.direct_edit):
            raise HTTPException(
                403, "Modification réservée au référent autorisé ou aux administrateurs"
            )
        if patch.model_fields_set & {
            "referent_ids",
            "direct_edit",
            "section_ids",
            "team_ids",
            "before_minutes",
            "after_minutes",
            "registration_section_ids",
            "registration_team_ids",
            "registration_limit",
        }:
            raise HTTPException(403, "Champ réservé aux administrateurs")
    official_fields = {"gymnasium_id", "location", "kickoff_at", "starts_at", "ends_at"}
    if event.ffvb_match_id and patch.model_fields_set & official_fields:
        if not is_admin:
            raise HTTPException(403, "Les horaires et lieux FFVB sont réservés aux administrateurs")
        if not acknowledge_ffvb:
            raise HTTPException(
                409,
                {
                    "code": "ffvb_confirmation_required",
                    "message": "Ces champs sont normalement synchronisés depuis la FFVB",
                },
            )
        if patch.model_fields_set & {"starts_at", "ends_at"}:
            raise HTTPException(
                422, "Pour un match FFVB, modifier kickoff_at ou les marges de réservation"
            )


def change_event(
    db: Session,
    event: Event,
    patch: EventPatch,
    actor: User,
    base_version: int,
    force: bool = False,
    acknowledge_ffvb: bool = False,
    exception: bool = True,
    defer_capacity: bool = False,
    notify_change: bool = True,
) -> Event:
    lock_gyms(
        db,
        [
            event.gymnasium_id,
            patch.gymnasium_id if "gymnasium_id" in patch.model_fields_set else None,
        ],
    )
    db.refresh(event)
    if event.version != base_version:
        raise HTTPException(409, {"code": "stale_version", "current_version": event.version})
    permission(event, actor, patch, True, acknowledge_ffvb)
    if force:
        require_admin(actor)
    before = snapshot(event)
    values = patch.model_dump(exclude_unset=True)
    if (
        "referent_ids" in values
        and values["referent_ids"] != event.referent_ids
        and "direct_edit" not in values
    ):
        values["direct_edit"] = False
    for key, value in values.items():
        setattr(event, key, value)
    if event.ffvb_match_id:
        if "courts" in values and event.courts > 0:
            event.match_courts = event.courts
        if "match_courts" in values:
            event.courts = event.match_courts if event.gymnasium_id else 0
        state = get(db, FFVBMatchState, event.ffvb_match_id)
        protected = dict(state.protected)
        for key in values.keys() & {"kickoff_at", "gymnasium_id", "location"}:
            protected[key] = actor.id
        state.protected = protected
        if values.keys() & {"kickoff_at", "before_minutes", "after_minutes"} and event.kickoff_at:
            event.starts_at = event.kickoff_at - timedelta(minutes=event.before_minutes)
            event.ends_at = event.kickoff_at + timedelta(minutes=event.after_minutes)
    event.version += 1
    if event.series_id and exception:
        event.exception = True
    validate_event(db, event, list(before.get("referent_ids") or []))
    db.flush()
    forced = False if defer_capacity else check_capacity(db, event, actor, force)
    revision(db, event, actor, before, "update", forced)
    if notify_change:
        event_changed(db, event, actor.id)
    return event


def local_datetime(value: datetime) -> datetime:
    local = value.astimezone(PARIS)
    # Reject nonexistent local times instead of silently shifting a recurring occurrence.
    if local.replace(tzinfo=UTC).replace(tzinfo=PARIS).astimezone(UTC).astimezone(PARIS).replace(
        tzinfo=None
    ) != local.replace(tzinfo=None):
        raise HTTPException(422, "Heure locale inexistante au changement d’heure")
    return local


def wall_time(value: datetime, target_date: datetime) -> datetime:
    source = value.astimezone(PARIS)
    result = datetime.combine(target_date.date(), source.timetz(), tzinfo=PARIS)
    if result.astimezone(UTC).astimezone(PARIS).replace(tzinfo=None) != result.replace(tzinfo=None):
        raise HTTPException(422, "Heure locale inexistante au changement d’heure")
    return result.astimezone(UTC)
