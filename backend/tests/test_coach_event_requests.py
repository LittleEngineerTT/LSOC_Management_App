from concurrent.futures import ThreadPoolExecutor, TimeoutError
from threading import Event as ThreadEvent

import pytest
from conftest import add_user, login
from fastapi.testclient import TestClient
from sqlalchemy import select, text
from test_events import payload, setup_planning
from test_ffvb_settings_migration import legacy_schema, migrate  # noqa: F401
from test_migrations import run

from app.persistence.database import SessionFactory, engine
from app.persistence.models import Event, EventRevision, User

START = "2099-10-15T18:00:00+02:00"
END = "2099-10-15T20:00:00+02:00"


def coach_setup(admin: TestClient) -> tuple[TestClient, str, str, str]:
    section, gym = setup_planning(admin)
    add_user("coach", ["coach"])
    team = admin.post("/api/v1/teams", json={"name": "Équipe coach", "section_id": section}).json()[
        "id"
    ]
    assert (
        admin.post(
            "/api/v1/users/coach/assignments", json={"team_id": team, "kind": "coach"}
        ).status_code
        == 201
    )
    return login("coach"), team, section, gym


def proposal(team: str, gym: str | None = None, **values: object) -> dict[str, object]:
    return {
        "team_id": team,
        "title": "Stage proposé",
        "kind": "training",
        "starts_at": START,
        "ends_at": END,
        "gymnasium_id": gym,
        "courts": 2 if gym else 0,
        "note": "Pour préparer le tournoi",
    } | values


def request_event(
    coach: TestClient, team: str, gym: str | None = None, **values: object
) -> dict[str, object]:
    response = coach.post("/api/v1/event-requests", json=proposal(team, gym, **values))
    assert response.status_code == 201, response.text
    return response.json()


def test_coach_proposal_is_private_and_creates_no_event(admin: TestClient) -> None:
    coach, team, section, gym = coach_setup(admin)
    add_user("other", ["coach"])
    other = login("other")
    request = request_event(coach, team, gym)
    assert request["status"] == "pending" and request["event_id"] is None
    assert request["proposal"]["section_ids"] == [section]
    assert request["proposal"]["referent_id"] == "coach"
    assert request["proposal"]["direct_edit"] is False
    assert request["note"] == "Pour préparer le tournoi"
    assert admin.get("/api/v1/events").json() == []
    assert other.get("/api/v1/event-requests").json() == []
    assert other.get(f"/api/v1/event-requests/{request['id']}").status_code == 403
    assert coach.get(f"/api/v1/event-requests/{request['id']}").status_code == 200
    assert len(admin.get("/api/v1/event-requests").json()) == 1
    assert any(n["kind"] == "event_request" for n in admin.get("/api/v1/notifications").json())
    assert any(n["kind"] == "event_request" for n in coach.get("/api/v1/notifications").json())


def test_requires_coach_assignment_and_forbids_privileged_fields(admin: TestClient) -> None:
    coach, team, section, gym = coach_setup(admin)
    add_user("member")
    member = login("member")
    assert member.post("/api/v1/event-requests", json=proposal(team)).status_code == 403
    other_team = admin.post(
        "/api/v1/teams", json={"name": "Autre équipe", "section_id": section}
    ).json()["id"]
    assert coach.post("/api/v1/event-requests", json=proposal(other_team)).status_code == 403
    for field, value in [
        ("force", True),
        ("section_ids", [section]),
        ("referent_id", "admin"),
        ("direct_edit", True),
        ("series_id", "series"),
    ]:
        assert (
            coach.post(
                "/api/v1/event-requests", json=proposal(team, gym, **{field: value})
            ).status_code
            == 422
        )
    assert (
        admin.post(
            "/api/v1/users/coach/assignments", json={"team_id": other_team, "kind": "coach"}
        ).status_code
        == 201
    )
    assert coach.post("/api/v1/event-requests", json=proposal(other_team)).status_code == 201


def test_acceptance_is_admin_only_and_single_under_concurrency(admin: TestClient) -> None:
    coach, team, section, gym = coach_setup(admin)
    request = request_event(coach, team, gym)
    path = f"/api/v1/event-requests/{request['id']}/decision"
    assert coach.post(path, json={"accept": True}).status_code == 403
    cookies, csrf = dict(admin.cookies), admin.headers["X-CSRF-Token"]

    def accept(_: int) -> int:
        with TestClient(admin.app, cookies=cookies, headers={"X-CSRF-Token": csrf}) as client:
            return client.post(path, json={"accept": True, "reason": "Validé"}).status_code

    with ThreadPoolExecutor(2) as pool:
        assert sorted(pool.map(accept, range(2))) == [200, 409]
    accepted = coach.get(f"/api/v1/event-requests/{request['id']}").json()
    assert accepted["status"] == "accepted" and accepted["decision"] == "Validé"
    assert accepted["decider_name"] == "Admin" and accepted["decided_at"] is not None
    event = admin.get(f"/api/v1/events/{accepted['event_id']}").json()
    assert event["section_ids"] == [section] and event["referent_id"] == "coach"
    assert event["direct_edit"] is False and event["series_id"] is None
    assert len(admin.get("/api/v1/events").json()) == 1
    assert coach.get("/api/v1/event-requests").json() == []
    assert len(coach.get("/api/v1/event-requests?status=").json()) == 1
    assert coach.get("/api/v1/event-requests?status=&limit=1&offset=1").json() == []
    assert any(
        n["kind"] == "event_request_decided" and n["event_id"] == event["id"]
        for n in coach.get("/api/v1/notifications").json()
    )


@pytest.mark.parametrize("revocation", ["role", "assignment", "inactive"])
def test_revoked_request_cannot_be_accepted_but_can_be_rejected(
    admin: TestClient, revocation: str
) -> None:
    coach, team, _, _ = coach_setup(admin)
    request = request_event(coach, team)
    if revocation == "role":
        assert (
            admin.put(
                "/api/v1/users/coach", json={"first_name": "Coach", "roles": ["member"]}
            ).status_code
            == 200
        )
    elif revocation == "assignment":
        assignment = admin.get("/api/v1/users/coach/assignments").json()[0]["id"]
        assert admin.delete(f"/api/v1/users/coach/assignments/{assignment}").status_code == 200
    else:
        with SessionFactory.begin() as db:
            db.get(User, "coach").active = False
    path = f"/api/v1/event-requests/{request['id']}/decision"
    assert admin.post(path, json={"accept": True}).status_code in (403, 409)
    assert admin.get("/api/v1/events").json() == []
    rejected = admin.post(path, json={"accept": False, "reason": "Rattachement retiré"})
    assert rejected.status_code == 200, rejected.text
    assert rejected.json()["status"] == "rejected" and rejected.json()["event_id"] is None


def test_capacity_failure_rolls_back_and_admin_can_force(admin: TestClient) -> None:
    coach, team, section, gym = coach_setup(admin)
    assert (
        admin.post("/api/v1/events", json=payload(section, gym, start=START, end=END)).status_code
        == 201
    )
    request = request_event(coach, team, gym)
    path = f"/api/v1/event-requests/{request['id']}/decision"
    failed = admin.post(path, json={"accept": True})
    assert failed.status_code == 409 and failed.json()["detail"]["code"] == "capacity_exceeded"
    assert coach.get(f"/api/v1/event-requests/{request['id']}").json()["status"] == "pending"
    assert len(admin.get("/api/v1/events").json()) == 1
    accepted = admin.post(path, json={"accept": True, "force": True})
    assert accepted.status_code == 200, accepted.text
    event = accepted.json()["event_id"]
    assert admin.get(f"/api/v1/events/{event}/history").json()[0]["forced"] is True


def test_proposal_validates_opening_and_revalidates_objects(admin: TestClient) -> None:
    coach, team, _, _ = coach_setup(admin)
    assert (
        coach.post(
            "/api/v1/event-requests", json=proposal(team, registration_team_ids=[team])
        ).status_code
        == 422
    )
    assert (
        coach.post(
            "/api/v1/event-requests",
            json=proposal(team, registration_team_ids=["missing"], registration_limit=4),
        ).status_code
        == 404
    )
    assert (
        coach.post(
            "/api/v1/event-requests",
            json=proposal(team, registration_team_ids=[team, team], registration_limit=4),
        ).status_code
        == 422
    )
    request = request_event(coach, team, registration_team_ids=[team], registration_limit=4)
    assert admin.delete(f"/api/v1/teams/{team}").status_code == 204
    assert admin.post(
        f"/api/v1/event-requests/{request['id']}/decision", json={"accept": True}
    ).status_code in (403, 404, 409)
    assert admin.get("/api/v1/events").json() == []


def test_team_opening_does_not_open_section_and_unions_explicit_sections(admin: TestClient) -> None:
    coach, team, section, gym = coach_setup(admin)
    second_section = admin.post("/api/v1/sections", json={"name": "Compétition"}).json()["id"]
    other_team = admin.post(
        "/api/v1/teams", json={"name": "Autres loisirs", "section_id": section}
    ).json()["id"]
    section_team = admin.post(
        "/api/v1/teams", json={"name": "Compétition A", "section_id": second_section}
    ).json()["id"]
    for user, assigned_team in [
        ("teamplayer", team),
        ("sectionplayer", section_team),
        ("outsider", other_team),
    ]:
        add_user(user)
        assert (
            admin.post(
                f"/api/v1/users/{user}/assignments",
                json={"team_id": assigned_team, "kind": "player"},
            ).status_code
            == 201
        )
    request = request_event(
        coach,
        team,
        gym,
        registration_team_ids=[team],
        registration_section_ids=[second_section],
        registration_limit=1,
    )
    event = admin.post(
        f"/api/v1/event-requests/{request['id']}/decision", json={"accept": True}
    ).json()["event_id"]
    assert login("outsider").post(f"/api/v1/events/{event}/registration").status_code == 403
    teamplayer, sectionplayer = login("teamplayer"), login("sectionplayer")
    assert teamplayer.get(f"/api/v1/events/{event}/registrations").json()["eligible"] is True
    assert sectionplayer.get(f"/api/v1/events/{event}/registrations").json()["eligible"] is True
    assert teamplayer.post(f"/api/v1/events/{event}/registration").status_code == 201
    assert (
        sectionplayer.post(f"/api/v1/events/{event}/registration").json()["detail"]["code"]
        == "registration_full"
    )
    assert (
        coach.patch(
            f"/api/v1/events/{event}",
            json={"base_version": 1, "changes": {"registration_team_ids": [other_team]}},
        ).status_code
        == 403
    )
    assert (
        coach.post(
            f"/api/v1/events/{event}/change-requests",
            json={"base_version": 1, "changes": {"registration_team_ids": [other_team]}},
        ).status_code
        == 403
    )


def test_team_only_event_is_open_and_requires_a_limit(admin: TestClient) -> None:
    _, team, section, gym = coach_setup(admin)
    body = payload(section, gym, start=START, end=END) | {"registration_team_ids": [team]}
    assert admin.post("/api/v1/events", json=body).status_code == 422
    response = admin.post("/api/v1/events", json=body | {"registration_limit": 2})
    assert response.status_code == 201, response.text
    event = response.json()["id"]
    assert response.json()["registration_team_ids"] == [team]
    assert admin.get(f"/api/v1/events/{event}/registrations").json()["open"] is True
    assert (
        admin.patch(
            f"/api/v1/events/{event}",
            json={"base_version": 1, "changes": {"registration_limit": None}},
        ).status_code
        == 422
    )
    assert (
        admin.patch(
            f"/api/v1/events/{event}",
            json={"base_version": 1, "changes": {"registration_team_ids": []}},
        ).status_code
        == 200
    )
    assert admin.get(f"/api/v1/events/{event}/registrations").json()["open"] is False


def test_delete_account_scrubs_proposals_notes_and_deciders(admin: TestClient) -> None:
    coach, team, _, _ = coach_setup(admin)
    pending = request_event(coach, team, note="Identité personnelle")
    accepted = request_event(coach, team)
    assert (
        admin.post(
            f"/api/v1/event-requests/{accepted['id']}/decision",
            json={"accept": True, "reason": "Commentaire personnel"},
        ).status_code
        == 200
    )
    assert admin.delete("/api/v1/users/coach").status_code == 204
    requests = admin.get("/api/v1/event-requests?status=").json()
    assert len(requests) == 2
    for request in requests:
        assert request["actor_id"] is None and request["actor_name"] == "Compte supprimé"
        assert request["note"] == "" and request["decision"] == ""
        assert request["proposal"].get("referent_id") is None
    assert next(r for r in requests if r["id"] == pending["id"])["status"] == "withdrawn"
    with SessionFactory() as db:
        assert all(r.after.get("referent_id") is None for r in db.scalars(select(EventRevision)))
        assert all(e.referent_id is None for e in db.scalars(select(Event)))


def test_admin_role_revoked_while_decision_waits_is_rechecked(
    admin: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    from app.api import event_requests
    from app.services.events import lock_planning

    coach, team, _, _ = coach_setup(admin)
    request = request_event(coach, team)
    entered = ThreadEvent()

    def signalled_lock(db: object) -> None:
        entered.set()
        lock_planning(db)

    monkeypatch.setattr(event_requests, "lock_planning", signalled_lock)
    cookies, csrf = dict(admin.cookies), admin.headers["X-CSRF-Token"]

    def accept() -> int:
        with TestClient(admin.app, cookies=cookies, headers={"X-CSRF-Token": csrf}) as client:
            return client.post(
                f"/api/v1/event-requests/{request['id']}/decision", json={"accept": True}
            ).status_code

    with ThreadPoolExecutor(1) as pool:
        with SessionFactory.begin() as db:
            lock_planning(db)
            pending = pool.submit(accept)
            assert entered.wait(5)
            db.get(User, "admin").roles = ["member"]
        assert pending.result(timeout=5) == 403
    assert coach.get(f"/api/v1/event-requests/{request['id']}").json()["status"] == "pending"


def test_deleted_coach_while_proposal_waits_cannot_submit(
    admin: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    from app.api import event_requests
    from app.services.events import lock_planning

    coach, team, _, _ = coach_setup(admin)
    entered = ThreadEvent()

    def signalled_lock(db: object) -> None:
        entered.set()
        lock_planning(db)

    monkeypatch.setattr(event_requests, "lock_planning", signalled_lock)
    with ThreadPoolExecutor(1) as pool:
        with SessionFactory.begin() as db:
            lock_planning(db)
            pending = pool.submit(coach.post, "/api/v1/event-requests", json=proposal(team))
            assert entered.wait(5)
            db.delete(db.get(User, "coach"))
        assert pending.result(timeout=5).status_code == 401
    assert admin.get("/api/v1/event-requests?status=").json() == []


@pytest.mark.usefixtures("legacy_schema")
def test_coach_request_migration_preserves_existing_events() -> None:
    migrate("0006_event_registrations")
    with engine.begin() as db:
        db.execute(
            text(
                "INSERT INTO users (id, first_name, category, roles, active, messaging_allowed, followed_email, referent_email, admin_email) VALUES ('legacy-admin', 'Admin', 'adult', '[\"admin\"]', true, true, true, true, true)"
            )
        )
        db.execute(
            text(
                "INSERT INTO events (id, title, kind, section_ids, location, starts_at, ends_at, courts, direct_edit, cancelled, version, exception, before_minutes, after_minutes, match_courts, occupancy_unknown, registration_section_ids, registration_limit) VALUES ('legacy-event', 'Stage existant', 'training', '[]', 'Extérieur', '2099-10-15T18:00:00Z', '2099-10-15T20:00:00Z', 0, false, false, 1, false, 75, 150, 3, false, '[]', 7)"
            )
        )
    migrate("head")
    run("check")
    with engine.connect() as db:
        row = db.execute(
            text(
                "SELECT title, registration_team_ids, registration_limit FROM events WHERE id='legacy-event'"
            )
        ).one()
        assert (row.title, row.registration_team_ids, row.registration_limit) == (
            "Stage existant",
            [],
            7,
        )
        assert db.scalar(text("SELECT COUNT(*) FROM coach_event_requests")) == 0
    run("downgrade", "0006_event_registrations")
    with engine.connect() as db:
        assert (
            db.scalar(text("SELECT title FROM events WHERE id='legacy-event'")) == "Stage existant"
        )
    migrate("head")


def opened_catalog_target(admin: TestClient, kind: str) -> tuple[str, str, str, str]:
    section, gym = setup_planning(admin)
    other = admin.post("/api/v1/sections", json={"name": "Autre section"}).json()["id"]
    if kind == "teams":
        target = admin.post(
            "/api/v1/teams", json={"name": "Équipe invitée", "section_id": other}
        ).json()["id"]
        field = "registration_team_ids"
    else:
        target, field = other, "registration_section_ids"
    return section, gym, target, field


@pytest.mark.parametrize("kind", ["teams", "sections"])
@pytest.mark.parametrize("cancelled", [False, True])
def test_opened_catalog_target_cannot_be_deleted_until_event_is_closed(
    admin: TestClient, kind: str, cancelled: bool
) -> None:
    section, gym, target, field = opened_catalog_target(admin, kind)
    body = payload(section, gym, start=START, end=END) | {field: [target], "registration_limit": 4}
    response = admin.post("/api/v1/events", json=body)
    assert response.status_code == 201, response.text
    event, version = response.json()["id"], 1
    if cancelled:
        assert (
            admin.patch(
                f"/api/v1/events/{event}",
                json={"base_version": version, "changes": {"cancelled": True}},
            ).status_code
            == 200
        )
        version += 1
    assert admin.delete(f"/api/v1/{kind}/{target}").status_code == 409
    updated = admin.patch(
        f"/api/v1/events/{event}",
        json={"base_version": version, "changes": {"title": "Modification toujours possible"}},
    )
    assert updated.status_code == 200, updated.text
    assert (
        admin.patch(
            f"/api/v1/events/{event}", json={"base_version": version + 1, "changes": {field: []}}
        ).status_code
        == 200
    )
    assert admin.delete(f"/api/v1/{kind}/{target}").status_code == 204


@pytest.mark.parametrize("kind", ["teams", "sections"])
def test_catalog_deletion_waits_for_event_opening_transaction(
    admin: TestClient, monkeypatch: pytest.MonkeyPatch, kind: str
) -> None:
    from app.services import events

    section, gym, target, field = opened_catalog_target(admin, kind)
    validated, release = ThreadEvent(), ThreadEvent()
    original = events.validate_event

    def paused_validation(db: object, event: object) -> None:
        original(db, event)
        validated.set()
        assert release.wait(5)

    monkeypatch.setattr(events, "validate_event", paused_validation)
    cookies, csrf = dict(admin.cookies), admin.headers["X-CSRF-Token"]

    def create() -> int:
        with TestClient(admin.app, cookies=cookies, headers={"X-CSRF-Token": csrf}) as client:
            return client.post(
                "/api/v1/events",
                json=payload(section, gym, start=START, end=END)
                | {field: [target], "registration_limit": 4},
            ).status_code

    def remove() -> int:
        with TestClient(admin.app, cookies=cookies, headers={"X-CSRF-Token": csrf}) as client:
            return client.delete(f"/api/v1/{kind}/{target}").status_code

    with ThreadPoolExecutor(2) as pool:
        creation = pool.submit(create)
        assert validated.wait(5)
        deletion = pool.submit(remove)
        try:
            with pytest.raises(TimeoutError):
                deletion.result(timeout=0.3)
        finally:
            release.set()
        assert creation.result(timeout=5) == 201
        assert deletion.result(timeout=5) == 409


def test_description_follows_the_accepted_request_and_stays_editable(admin: TestClient) -> None:
    coach, team, section, gym = coach_setup(admin)
    request = request_event(coach, team, gym, description="Échauffement, ateliers puis matchs.")
    assert request["proposal"]["description"] == "Échauffement, ateliers puis matchs."
    decided = admin.post(f"/api/v1/event-requests/{request['id']}/decision", json={"accept": True})
    assert decided.status_code == 200, decided.text
    event = admin.get(f"/api/v1/events/{decided.json()['event_id']}").json()
    assert event["description"] == "Échauffement, ateliers puis matchs."
    changed = admin.patch(
        f"/api/v1/events/{event['id']}",
        json={"base_version": event["version"], "changes": {"description": "Ateliers seulement."}},
    )
    assert changed.status_code == 200 and changed.json()["description"] == "Ateliers seulement."
    assert admin.post("/api/v1/events", json=payload(section, gym, start=START, end=END) | {"courts": 1}).json()["description"] == ""
