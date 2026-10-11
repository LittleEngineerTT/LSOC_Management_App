from datetime import datetime
from typing import Any
from uuid import uuid4

from sqlalchemy import (
    JSON,
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
    select,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, column_property, mapped_column

from app.core.security import now


def uid() -> str:
    return str(uuid4())


class Base(DeclarativeBase):
    pass


class Identity:
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)


class User(Identity, Base):
    __tablename__ = "users"
    first_name: Mapped[str] = mapped_column(String(80))
    category: Mapped[str] = mapped_column(String(30), default="adult")
    roles: Mapped[list[str]] = mapped_column(JSON, default=list)
    username: Mapped[str | None] = mapped_column(String(80), unique=True)
    email: Mapped[str | None] = mapped_column(String(254))
    password_hash: Mapped[str | None] = mapped_column(Text)
    active: Mapped[bool] = mapped_column(Boolean, default=False)
    messaging_allowed: Mapped[bool] = mapped_column(Boolean, default=True)
    followed_email: Mapped[bool] = mapped_column(Boolean, default=True)
    referent_email: Mapped[bool] = mapped_column(Boolean, default=True)
    admin_email: Mapped[bool] = mapped_column(Boolean, default=True)


class AuthToken(Base):
    __tablename__ = "auth_tokens"
    hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    purpose: Mapped[str] = mapped_column(String(20))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class LoginSession(Base):
    __tablename__ = "sessions"
    hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    csrf_hash: Mapped[str] = mapped_column(String(64))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class RateBucket(Base):
    __tablename__ = "rate_buckets"
    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    count: Mapped[int] = mapped_column(Integer)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class Section(Identity, Base):
    __tablename__ = "sections"
    name: Mapped[str] = mapped_column(String(120), unique=True)


class Team(Identity, Base):
    __tablename__ = "teams"
    name: Mapped[str] = mapped_column(String(120))
    section_id: Mapped[str] = mapped_column(ForeignKey("sections.id"))
    referent_id: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    ffvb_source_warning_ignored: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default="false"
    )


class Assignment(Identity, Base):
    __tablename__ = "assignments"
    __table_args__ = (
        UniqueConstraint("user_id", "team_id", "kind"),
        CheckConstraint("kind IN ('player','coach')"),
    )
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    team_id: Mapped[str] = mapped_column(ForeignKey("teams.id", ondelete="CASCADE"))
    kind: Mapped[str] = mapped_column(String(10))


class Gymnasium(Identity, Base):
    __tablename__ = "gymnasiums"
    __table_args__ = (CheckConstraint("capacity > 0"),)
    name: Mapped[str] = mapped_column(String(120), unique=True)
    capacity: Mapped[int] = mapped_column(Integer)


class AvailabilityBlock(Identity, Base):
    __tablename__ = "availability_blocks"
    __table_args__ = (CheckConstraint("courts > 0"), CheckConstraint("ends_at > starts_at"))
    gymnasium_id: Mapped[str] = mapped_column(ForeignKey("gymnasiums.id"), index=True)
    title: Mapped[str] = mapped_column(String(200))
    starts_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    ends_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    courts: Mapped[int] = mapped_column(Integer)


class EventSeries(Identity, Base):
    __tablename__ = "event_series"
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class Registration(Identity, Base):
    __tablename__ = "registrations"
    __table_args__ = (UniqueConstraint("user_id", "event_id"),)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    event_id: Mapped[str] = mapped_column(ForeignKey("events.id", ondelete="CASCADE"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class Event(Identity, Base):
    __tablename__ = "events"
    __table_args__ = (
        CheckConstraint("ends_at > starts_at"),
        CheckConstraint("courts >= 0"),
        CheckConstraint("version > 0"),
        CheckConstraint(
            "registration_limit IS NULL OR registration_limit > 0",
            name="events_registration_limit_check",
        ),
    )
    # Redéclaré ici pour que le compteur d’inscrits puisse s’y corréler.
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    title: Mapped[str] = mapped_column(String(200))
    description: Mapped[str] = mapped_column(Text, default="")
    kind: Mapped[str] = mapped_column(String(20))
    section_ids: Mapped[list[str]] = mapped_column(JSON, default=list)
    gymnasium_id: Mapped[str | None] = mapped_column(ForeignKey("gymnasiums.id"), index=True)
    location: Mapped[str] = mapped_column(String(200), default="")
    starts_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    ends_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    courts: Mapped[int] = mapped_column(Integer)
    referent_id: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), index=True
    )
    direct_edit: Mapped[bool] = mapped_column(Boolean, default=False)
    cancelled: Mapped[bool] = mapped_column(Boolean, default=False)
    version: Mapped[int] = mapped_column(Integer, default=1)
    series_id: Mapped[str | None] = mapped_column(ForeignKey("event_series.id"), index=True)
    exception: Mapped[bool] = mapped_column(Boolean, default=False)
    ffvb_match_id: Mapped[str | None] = mapped_column(ForeignKey("ffvb_matches.id"), unique=True)
    kickoff_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    before_minutes: Mapped[int] = mapped_column(Integer, default=75)
    after_minutes: Mapped[int] = mapped_column(Integer, default=150)
    match_courts: Mapped[int] = mapped_column(Integer, default=3)
    occupancy_unknown: Mapped[bool] = mapped_column(Boolean, default=False)
    # Séance ouverte : union des sections et équipes autorisées.
    registration_section_ids: Mapped[list[str]] = mapped_column(JSON, default=list)
    registration_team_ids: Mapped[list[str]] = mapped_column(JSON, default=list)
    registration_limit: Mapped[int | None] = mapped_column(Integer)
    registration_count: Mapped[int] = column_property(
        select(func.count(Registration.id))
        .where(Registration.event_id == id)
        .correlate_except(Registration)
        .scalar_subquery()
    )


class EventRevision(Identity, Base):
    __tablename__ = "event_revisions"
    event_id: Mapped[str] = mapped_column(ForeignKey("events.id"), index=True)
    actor_id: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    actor_name: Mapped[str] = mapped_column(String(80))
    origin: Mapped[str] = mapped_column(String(20))
    action: Mapped[str] = mapped_column(String(30))
    before: Mapped[dict[str, Any]] = mapped_column(JSON)
    after: Mapped[dict[str, Any]] = mapped_column(JSON)
    decision_reason: Mapped[str] = mapped_column(Text, default="")
    forced: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class ChangeRequest(Identity, Base):
    __tablename__ = "change_requests"
    event_id: Mapped[str] = mapped_column(ForeignKey("events.id"), index=True)
    actor_id: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    actor_name: Mapped[str] = mapped_column(String(80))
    base_version: Mapped[int] = mapped_column(Integer)
    changes: Mapped[dict[str, Any]] = mapped_column(JSON)
    status: Mapped[str] = mapped_column(String(20), default="pending")
    decision: Mapped[str] = mapped_column(Text, default="")
    decided_by: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    decider_name: Mapped[str | None] = mapped_column(String(80))
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class CoachEventRequest(Identity, Base):
    __tablename__ = "coach_event_requests"
    __table_args__ = (CheckConstraint("status IN ('pending','accepted','rejected','withdrawn')"),)
    team_id: Mapped[str | None] = mapped_column(
        ForeignKey("teams.id", ondelete="SET NULL"), index=True
    )
    actor_id: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), index=True
    )
    actor_name: Mapped[str] = mapped_column(String(80))
    proposal: Mapped[dict[str, Any]] = mapped_column(JSON)
    note: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(20), default="pending", index=True)
    decision: Mapped[str] = mapped_column(Text, default="")
    decided_by: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    decider_name: Mapped[str | None] = mapped_column(String(80))
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    event_id: Mapped[str | None] = mapped_column(
        ForeignKey("events.id", ondelete="SET NULL"), unique=True
    )


class Follow(Identity, Base):
    __tablename__ = "follows"
    __table_args__ = (
        UniqueConstraint("user_id", "event_id"),
        UniqueConstraint("user_id", "series_id"),
        CheckConstraint("(event_id IS NULL) <> (series_id IS NULL)"),
    )
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    event_id: Mapped[str | None] = mapped_column(ForeignKey("events.id", ondelete="CASCADE"))
    series_id: Mapped[str | None] = mapped_column(ForeignKey("event_series.id", ondelete="CASCADE"))


class QuestionThread(Identity, Base):
    __tablename__ = "question_threads"
    __table_args__ = (UniqueConstraint("user_id", "event_id"),)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    event_id: Mapped[str] = mapped_column(ForeignKey("events.id"))


class QuestionMessage(Identity, Base):
    __tablename__ = "question_messages"
    thread_id: Mapped[str] = mapped_column(
        ForeignKey("question_threads.id", ondelete="CASCADE"), index=True
    )
    author_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    body: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Notification(Identity, Base):
    __tablename__ = "notifications"
    __table_args__ = (UniqueConstraint("user_id", "dedupe_key"),)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(50))
    title: Mapped[str] = mapped_column(String(200))
    event_id: Mapped[str | None] = mapped_column(ForeignKey("events.id", ondelete="CASCADE"))
    dedupe_key: Mapped[str] = mapped_column(String(200))
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class EmailJob(Identity, Base):
    __tablename__ = "email_jobs"
    __table_args__ = (UniqueConstraint("user_id", "dedupe_key"),)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    encrypted_payload: Mapped[str] = mapped_column(Text)
    dedupe_key: Mapped[str] = mapped_column(String(200))
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    due_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, index=True)
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class FFVBSource(Identity, Base):
    __tablename__ = "ffvb_sources"
    __table_args__ = (
        UniqueConstraint("team_id", "season"),
        CheckConstraint(
            "(before_minutes IS NULL OR before_minutes >= 0)"
            " AND (after_minutes IS NULL OR after_minutes > 0)"
            " AND (courts IS NULL OR courts > 0)",
            name="ffvb_sources_match_settings_check",
        ),
    )
    team_id: Mapped[str] = mapped_column(ForeignKey("teams.id"), index=True)
    season: Mapped[str] = mapped_column(String(9))
    entity: Mapped[str] = mapped_column(String(30))
    pool: Mapped[str] = mapped_column(String(30))
    team_number: Mapped[str] = mapped_column(String(20))
    team_name: Mapped[str] = mapped_column(String(200))
    club_code: Mapped[str] = mapped_column(String(30))
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    interval_minutes: Mapped[int] = mapped_column(Integer, default=1440)
    next_check_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=now, index=True
    )
    last_success_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_error: Mapped[str | None] = mapped_column(String(200))
    # Réglages des matchs de la source ; nul = configuration par défaut du club.
    before_minutes: Mapped[int | None] = mapped_column(Integer)
    after_minutes: Mapped[int | None] = mapped_column(Integer)
    courts: Mapped[int | None] = mapped_column(Integer)

    @property
    def interval_days(self) -> float:
        return self.interval_minutes / 1440


class GymMapping(Identity, Base):
    __tablename__ = "gym_mappings"
    __table_args__ = (UniqueConstraint("official_name"),)
    official_name: Mapped[str] = mapped_column(String(200))
    gymnasium_id: Mapped[str] = mapped_column(ForeignKey("gymnasiums.id"))


class FFVBMatchState(Identity, Base):
    __tablename__ = "ffvb_matches"
    __table_args__ = (UniqueConstraint("season", "entity", "match_code"),)
    source_id: Mapped[str] = mapped_column(ForeignKey("ffvb_sources.id"), index=True)
    season: Mapped[str] = mapped_column(String(9))
    entity: Mapped[str] = mapped_column(String(30))
    match_code: Mapped[str] = mapped_column(String(30))
    official: Mapped[dict[str, Any]] = mapped_column(JSON)
    protected: Mapped[dict[str, str | None]] = mapped_column(JSON, default=dict)
    last_verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_changed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    suspended_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    disabled: Mapped[bool] = mapped_column(Boolean, default=False)
    missing: Mapped[bool] = mapped_column(Boolean, default=False)


class FFVBConflict(Identity, Base):
    __tablename__ = "ffvb_conflicts"
    match_id: Mapped[str] = mapped_column(ForeignKey("ffvb_matches.id"), index=True)
    field: Mapped[str] = mapped_column(String(30))
    official_value: Mapped[str | None] = mapped_column(Text)
    local_value: Mapped[str | None] = mapped_column(Text)
    author_id: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    status: Mapped[str] = mapped_column(String(20), default="open")
    resolved_by: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    resolver_name: Mapped[str | None] = mapped_column(String(80))
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class ClubSettings(Base):
    __tablename__ = "club_settings"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    before_minutes: Mapped[int] = mapped_column(Integer, default=75)
    after_minutes: Mapped[int] = mapped_column(Integer, default=150)
    courts: Mapped[int] = mapped_column(Integer, default=3)
    club_code: Mapped[str | None] = mapped_column(String(30))
