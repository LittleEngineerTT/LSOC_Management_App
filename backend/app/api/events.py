from datetime import UTC, datetime, time, timedelta
from typing import Annotated, Literal

from fastapi import APIRouter, HTTPException, Query
from pydantic import AwareDatetime
from sqlalchemy import cast, select
from sqlalchemy.dialects.postgresql import JSONB

from app.api.common import DB, Actor, Admin, get
from app.api.schemas import (
    BlockInput,
    BlockView,
    CapacityView,
    ChangeInput,
    ChangeView,
    DecisionInput,
    EventInput,
    EventPatch,
    EventView,
    RestoreInput,
    RevisionView,
    SeriesChange,
    SeriesInput,
)
from app.persistence.models import (
    AvailabilityBlock,
    ChangeRequest,
    Event,
    EventRevision,
    EventSeries,
)
from app.services.events import (
    PARIS,
    alert_capacity,
    availability,
    change_event,
    check_capacity,
    create_event,
    delete_event,
    lock_gyms,
    lock_planning,
    permission,
    revision,
    snapshot,
    wall_time,
)
from app.services.notifications import admins, decision_message, resolve_admin_alerts

router = APIRouter(tags=["Planning"])


@router.get("/events", response_model=list[EventView])
def events(
    db: DB,
    actor: Actor,
    starts_at: AwareDatetime | None = None,
    ends_at: AwareDatetime | None = None,
    gymnasium_id: str | None = None,
    section_id: str | None = None,
    series_id: str | None = None,
    include_cancelled: bool = False,
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
) -> list[Event]:
    if starts_at and ends_at and ends_at <= starts_at:
        raise HTTPException(422, "Intervalle invalide")
    query = select(Event)
    if starts_at:
        query = query.where(Event.ends_at > starts_at)
    if ends_at:
        query = query.where(Event.starts_at < ends_at)
    if gymnasium_id:
        query = query.where(Event.gymnasium_id == gymnasium_id)
    if series_id:
        query = query.where(Event.series_id == series_id)
    if not include_cancelled:
        query = query.where(Event.cancelled.is_(False))
    if section_id:
        query = query.where(cast(Event.section_ids, JSONB).contains([section_id]))
    return list(db.scalars(query.order_by(Event.starts_at, Event.id).offset(offset).limit(limit)))


@router.post("/events", response_model=EventView, status_code=201)
def create(body: EventInput, db: DB, actor: Admin, force: bool = False) -> Event:
    return create_event(db, body, actor, force)


@router.get("/events/{event_id}", response_model=EventView)
def detail(event_id: str, db: DB, actor: Actor) -> Event:
    return get(db, Event, event_id)


@router.patch("/events/{event_id}", response_model=EventView)
def update(event_id: str, body: ChangeInput, db: DB, actor: Actor) -> Event:
    lock_planning(db)
    return change_event(
        db,
        get(db, Event, event_id),
        body.changes,
        actor,
        body.base_version,
        body.force,
        body.acknowledge_ffvb,
    )


@router.get("/events/{event_id}/history", response_model=list[RevisionView])
def history(
    event_id: str,
    db: DB,
    actor: Actor,
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
) -> list[EventRevision]:
    get(db, Event, event_id)
    return list(
        db.scalars(
            select(EventRevision)
            .where(EventRevision.event_id == event_id)
            .order_by(EventRevision.created_at, EventRevision.id)
            .offset(offset)
            .limit(limit)
        )
    )


@router.post("/events/{event_id}/history/{revision_id}/restore", response_model=EventView)
def restore(event_id: str, revision_id: str, body: RestoreInput, db: DB, actor: Admin) -> Event:
    lock_planning(db)
    revision = get(db, EventRevision, revision_id)
    if revision.event_id != event_id:
        raise HTTPException(404, "Historique introuvable")
    allowed = set(EventPatch.model_fields)
    if any(key not in allowed or key not in revision.before for key in body.fields):
        raise HTTPException(422, "Champ non restaurable")
    patch = EventPatch.model_validate({key: revision.before[key] for key in body.fields})
    return change_event(
        db,
        get(db, Event, event_id),
        patch,
        actor,
        body.base_version,
        body.force,
        body.acknowledge_ffvb,
    )


@router.post("/events/{event_id}/change-requests", response_model=ChangeView, status_code=201)
def request_change(event_id: str, body: ChangeInput, db: DB, actor: Actor) -> ChangeRequest:
    lock_planning(db)
    event = get(db, Event, event_id)
    permission(event, actor, body.changes, False, body.acknowledge_ffvb)
    if body.force:
        raise HTTPException(422, "Le forçage appartient à la décision administrateur")
    if body.base_version != event.version:
        raise HTTPException(409, "Version obsolète")
    value = ChangeRequest(
        event_id=event_id,
        actor_id=actor.id,
        actor_name=actor.first_name,
        base_version=body.base_version,
        changes=body.changes.model_dump(mode="json", exclude_unset=True),
    )
    db.add(value)
    db.flush()
    admins(
        db,
        f"request:{value.id}",
        "change_request",
        f"Modification à valider : {event.title}",
        event_id,
        link=f"/app/administration?tab=requests&demande={value.id}",
    )
    return value


@router.get("/change-requests", response_model=list[ChangeView])
def requests(
    db: DB,
    actor: Actor,
    status: str | None = "pending",
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
) -> list[ChangeRequest]:
    query = select(ChangeRequest)
    if "admin" not in actor.roles:
        query = query.where(ChangeRequest.actor_id == actor.id)
    if status:
        query = query.where(ChangeRequest.status == status)
    return list(db.scalars(query.order_by(ChangeRequest.created_at).offset(offset).limit(limit)))


@router.post("/change-requests/{request_id}/decision", response_model=ChangeView)
def decide(request_id: str, body: DecisionInput, db: DB, actor: Admin) -> ChangeRequest:
    lock_planning(db)
    request = get(db, ChangeRequest, request_id)
    if request.status != "pending" or request.actor_id is None:
        raise HTTPException(409, "Demande non exécutable")
    event = get(db, Event, request.event_id)
    if body.accept:
        from app.persistence.models import User

        requester = get(db, User, request.actor_id)
        if not requester.active:
            raise HTTPException(409, "Demandeur inactif")
        patch = EventPatch.model_validate(request.changes)
        permission(event, requester, patch, False, body.acknowledge_ffvb)
        change_event(
            db, event, patch, actor, request.base_version, body.force, body.acknowledge_ffvb
        )
    from app.core.security import now

    revision(
        db, event, actor, snapshot(event), "request_accept" if body.accept else "request_reject"
    )
    db.flush()
    audit = db.scalar(
        select(EventRevision)
        .where(EventRevision.event_id == event.id)
        .order_by(EventRevision.created_at.desc())
        .limit(1)
    )
    if audit is not None:
        audit.decision_reason = body.reason
    request.decided_by = actor.id
    request.decider_name = actor.first_name
    request.decided_at = now()
    request.status = "accepted" if body.accept else "rejected"
    request.decision = body.reason
    resolve_admin_alerts(db, f"request:{request.id}")
    decision_message(
        db,
        {event.referent_id, request.actor_id},
        f"request-decided:{request.id}",
        f"Modification {'acceptée' if body.accept else 'refusée'} : {event.title}",
        body.reason,
        event.id,
        actor,
    )
    return request


@router.post("/series", response_model=list[EventView], status_code=201)
def create_series(body: SeriesInput, db: DB, actor: Admin) -> list[Event]:
    lock_planning(db)
    start = body.event.starts_at.astimezone(PARIS)
    end = body.event.ends_at.astimezone(PARIS)
    if body.until < start.date() or (body.until - start.date()).days > 730:
        raise HTTPException(422, "La série doit durer de zéro à deux ans")
    series = EventSeries()
    db.add(series)
    db.flush()
    result: list[Event] = []
    weekdays = sorted(body.weekdays or [start.weekday()])
    span = (end.date() - start.date()).days
    week = start.date() - timedelta(days=start.weekday())
    while week <= body.until:
        for weekday in weekdays:
            day = week + timedelta(days=weekday)
            if day < start.date() or day > body.until:
                continue
            cursor = datetime.combine(day, time(), tzinfo=PARIS)
            values = body.event.model_dump()
            values["starts_at"] = wall_time(start, cursor)
            values["ends_at"] = wall_time(end, cursor + timedelta(days=span))
            result.append(
                create_event(db, EventInput.model_validate(values), actor, body.force, series.id)
            )
        week += timedelta(days=7)
    if not result:
        raise HTTPException(422, "Aucune occurrence entre le début et la fin de la série")
    return result


@router.delete("/events/{event_id}", status_code=204)
def remove(
    event_id: str, db: DB, actor: Admin, scope: Literal["event", "following"] = "event"
) -> None:
    """Supprime un événement, ou celui-ci et les suivants de sa série."""
    lock_planning(db)
    event = get(db, Event, event_id)
    targets = [event]
    if scope == "following":
        if event.series_id is None:
            raise HTTPException(422, "Cet événement n’appartient à aucune série")
        targets = list(
            db.scalars(
                select(Event)
                .where(Event.series_id == event.series_id, Event.starts_at >= event.starts_at)
                .order_by(Event.starts_at, Event.id)
            )
        )
    if any(target.ffvb_match_id for target in targets):
        raise HTTPException(409, "Un match FFVB se supprime avec sa source ; vous pouvez l’annuler")
    series_id = event.series_id
    for target in targets:
        delete_event(db, target, actor)
    db.flush()
    if series_id and not db.scalar(select(Event.id).where(Event.series_id == series_id)):
        db.delete(get(db, EventSeries, series_id))


@router.patch("/series/{series_id}", response_model=list[EventView])
def update_series(series_id: str, body: SeriesChange, db: DB, actor: Actor) -> list[Event]:
    lock_planning(db)
    get(db, EventSeries, series_id)
    first = get(db, Event, body.from_event_id)
    if first.series_id != series_id:
        raise HTTPException(422, "Occurrence étrangère à la série")
    if first.version != body.base_version:
        raise HTTPException(409, "Version obsolète")
    values = list(
        db.scalars(
            select(Event)
            .where(Event.series_id == series_id, Event.starts_at >= first.starts_at)
            .order_by(Event.starts_at, Event.id)
        )
    )
    result: list[Event] = []
    baselines = {
        field: getattr(first, field).astimezone(PARIS) for field in ("starts_at", "ends_at")
    }
    for event in values:
        if event.exception and not body.include_exceptions:
            continue
        patch_values = body.changes.model_dump(exclude_unset=True)
        for field in ("starts_at", "ends_at"):
            if field in patch_values:
                desired = patch_values[field].astimezone(PARIS)
                baseline = baselines[field]
                local = getattr(event, field).astimezone(PARIS)
                delta = desired.replace(tzinfo=None) - baseline.replace(tzinfo=None)
                shifted = (local.replace(tzinfo=None) + delta).replace(tzinfo=PARIS)
                if shifted.astimezone(UTC).astimezone(PARIS).replace(
                    tzinfo=None
                ) != shifted.replace(tzinfo=None):
                    raise HTTPException(422, "Heure locale inexistante")
                patch_values[field] = shifted.astimezone(UTC)
        result.append(
            change_event(
                db,
                event,
                EventPatch.model_validate(patch_values),
                actor,
                event.version,
                body.force,
                body.acknowledge_ffvb,
                exception=False,
                defer_capacity=True,
            )
        )
    db.flush()
    conflicts = []
    for event in result:
        if event.cancelled or not event.gymnasium_id:
            continue
        segments = [
            segment.model_dump(mode="json")
            for segment in availability(
                db, event.gymnasium_id, event.starts_at, event.ends_at
            ).segments
            if segment.excess
        ]
        if segments:
            conflicts.append({"event_id": event.id, "segments": segments})
    if conflicts and not body.force:
        raise HTTPException(409, {"code": "capacity_exceeded", "events": conflicts})
    if conflicts:
        for event in result:
            forced = check_capacity(db, event, actor, body.force)
            if forced:
                audit = db.scalar(
                    select(EventRevision)
                    .where(EventRevision.event_id == event.id)
                    .order_by(EventRevision.created_at.desc())
                    .limit(1)
                )
                if audit is not None:
                    audit.forced = True
    return result


@router.get("/availability-blocks", response_model=list[BlockView])
def blocks(
    db: DB,
    actor: Actor,
    gymnasium_id: str | None = None,
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
) -> list[AvailabilityBlock]:
    query = select(AvailabilityBlock)
    if gymnasium_id:
        query = query.where(AvailabilityBlock.gymnasium_id == gymnasium_id)
    return list(db.scalars(query.order_by(AvailabilityBlock.starts_at).offset(offset).limit(limit)))


@router.post("/availability-blocks", response_model=BlockView, status_code=201)
def create_block(body: BlockInput, db: DB, actor: Admin) -> AvailabilityBlock:
    lock_gyms(db, [body.gymnasium_id])
    value = AvailabilityBlock(**body.model_dump())
    db.add(value)
    db.flush()
    alert_capacity(db, body.gymnasium_id)
    return value


@router.put("/availability-blocks/{block_id}", response_model=BlockView)
def update_block(block_id: str, body: BlockInput, db: DB, actor: Admin) -> AvailabilityBlock:
    lock_planning(db)
    value = get(db, AvailabilityBlock, block_id)
    lock_gyms(db, [value.gymnasium_id, body.gymnasium_id])
    for key, item in body.model_dump().items():
        setattr(value, key, item)
    db.flush()
    alert_capacity(db, body.gymnasium_id)
    return value


@router.delete("/availability-blocks/{block_id}", status_code=204)
def remove_block(block_id: str, db: DB, actor: Admin) -> None:
    lock_planning(db)
    block = get(db, AvailabilityBlock, block_id)
    lock_gyms(db, [block.gymnasium_id])
    db.delete(block)


@router.get("/gymnasiums/{gymnasium_id}/availability", response_model=CapacityView)
def capacity(
    gymnasium_id: str,
    db: DB,
    actor: Actor,
    starts_at: Annotated[AwareDatetime, Query()],
    ends_at: Annotated[AwareDatetime, Query()],
) -> CapacityView:
    if ends_at <= starts_at or ends_at - starts_at > timedelta(days=366):
        raise HTTPException(422, "Intervalle invalide ou supérieur à un an")
    return availability(db, gymnasium_id, starts_at, ends_at)
