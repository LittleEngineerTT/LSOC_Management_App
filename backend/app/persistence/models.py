from datetime import date, datetime
from typing import Any
from uuid import uuid4

from sqlalchemy import (
    JSON,
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    cast,
    func,
    select,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import (
    DeclarativeBase,
    InstrumentedAttribute,
    Mapped,
    column_property,
    mapped_column,
)
from sqlalchemy.sql.elements import ColumnElement

from app.core.security import now


def uid() -> str:
    return str(uuid4())


class Base(DeclarativeBase):
    pass


class Identity:
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)


class User(Identity, Base):
    """Compte ; `id` est le numéro de licence, ou à défaut `initiale-prénom-section`."""

    __tablename__ = "users"
    __table_args__ = (CheckConstraint("sex IN ('M','F')", name="users_sex_check"),)
    first_name: Mapped[str] = mapped_column(String(80))
    # Seule l’initiale du nom de famille est conservée.
    last_initial: Mapped[str] = mapped_column(String(1), default="", server_default="")
    category: Mapped[str] = mapped_column(String(30), default="adult")
    # Facultatif : « M » ou « F ».
    sex: Mapped[str | None] = mapped_column(String(1))
    roles: Mapped[list[str]] = mapped_column(JSON, default=list)
    username: Mapped[str | None] = mapped_column(String(80), unique=True)
    email: Mapped[str | None] = mapped_column(String(254))
    password_hash: Mapped[str | None] = mapped_column(Text)
    active: Mapped[bool] = mapped_column(Boolean, default=False)
    messaging_allowed: Mapped[bool] = mapped_column(Boolean, default=True)
    followed_email: Mapped[bool] = mapped_column(Boolean, default=True)
    referent_email: Mapped[bool] = mapped_column(Boolean, default=True)
    admin_email: Mapped[bool] = mapped_column(Boolean, default=True)
    # Dernière activité (connexion ou session prolongée) : base de la purge après 2 ans.
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class License(Base):
    """Licence d’un adhérent ; l’absence de ligne vaut « pas de licence ».

    Un seul numéro par personne ; le statut joueur et le statut coach évoluent séparément.
    """

    __tablename__ = "licenses"
    __table_args__ = (
        CheckConstraint(
            "status IN ('none','in_progress','payment_pending','active')",
            name="licenses_status_check",
        ),
        CheckConstraint("status <> 'active' OR number IS NOT NULL", name="licenses_active_number"),
        CheckConstraint(
            "coach_status IN ('none','in_progress','active')", name="licenses_coach_status_check"
        ),
        CheckConstraint(
            "coach_status <> 'active' OR number IS NOT NULL", name="licenses_coach_active_number"
        ),
    )
    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE", onupdate="CASCADE"), primary_key=True
    )
    number: Mapped[str | None] = mapped_column(String(40), unique=True)
    status: Mapped[str] = mapped_column(String(20), default="none")
    # Licence d’encadrement : pas d’étape de paiement.
    coach_status: Mapped[str] = mapped_column(String(20), default="none", server_default="none")
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    updated_by: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL", onupdate="CASCADE")
    )
    # PDF de la licence dans le bucket S3 : clé « licences/ » + 64 caractères aléatoires.
    file_key: Mapped[str | None] = mapped_column(String(80))
    file_uploaded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Dossier(Identity, Base):
    """Procédure d’inscription ouverte pour un joueur par un administrateur ou un coach.

    Chaque étape est facultative : les pièces demandées, et le paiement (réglé hors de la
    plateforme, validé par un administrateur). Un seul dossier ouvert par joueur.
    """

    __tablename__ = "dossiers"
    __table_args__ = (
        Index(
            "dossiers_one_open",
            "user_id",
            unique=True,
            postgresql_where=text("closed_at IS NULL"),
        ),
    )
    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE", onupdate="CASCADE"), index=True
    )
    opened_by: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL", onupdate="CASCADE")
    )
    # Message au joueur avec la demande.
    note: Mapped[str] = mapped_column(Text, default="", server_default="")
    payment_requested: Mapped[bool] = mapped_column(Boolean, default=False)
    payment_validated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class DossierDocument(Identity, Base):
    """Pièce demandée dans un dossier ; le fichier disparaît à la clôture du dossier."""

    __tablename__ = "dossier_documents"
    __table_args__ = (
        UniqueConstraint("dossier_id", "kind", "label"),
        CheckConstraint(
            "kind IN ('medical_certificate','identity','reduction_proof','other')",
            name="dossier_documents_kind_check",
        ),
        CheckConstraint("(kind = 'other') = (label <> '')", name="dossier_documents_label_check"),
        CheckConstraint(
            "status IN ('requested','submitted','validated','rejected')",
            name="dossier_documents_status_check",
        ),
    )
    dossier_id: Mapped[str] = mapped_column(
        ForeignKey("dossiers.id", ondelete="CASCADE"), index=True
    )
    kind: Mapped[str] = mapped_column(String(30))
    # Nom d’une pièce « Autre », choisi par l’administration ; vide sinon.
    label: Mapped[str] = mapped_column(String(120), default="", server_default="")
    status: Mapped[str] = mapped_column(String(10), default="requested")
    # Fichier chiffré dans le bucket S3 : clé « dossiers/ » + 64 caractères aléatoires.
    file_key: Mapped[str | None] = mapped_column(String(80))
    file_name: Mapped[str | None] = mapped_column(String(200))
    content_type: Mapped[str | None] = mapped_column(String(100))
    uploaded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Motif d’un refus, transmis au joueur.
    decision: Mapped[str] = mapped_column(Text, default="", server_default="")


class AuthToken(Base):
    __tablename__ = "auth_tokens"
    hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE", onupdate="CASCADE"), index=True
    )
    purpose: Mapped[str] = mapped_column(String(20))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class LoginSession(Base):
    __tablename__ = "sessions"
    hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE", onupdate="CASCADE"), index=True
    )
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
    # Référents de l’équipe, à égalité de droits ; liste vide : à désigner.
    referent_ids: Mapped[list[str]] = mapped_column(JSON, default=list)
    ffvb_source_warning_ignored: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default="false"
    )


class Position(Identity, Base):
    """Poste attribuable aux joueurs, défini par l’administration."""

    __tablename__ = "positions"
    name: Mapped[str] = mapped_column(String(120), unique=True)


class Assignment(Identity, Base):
    """Rattachement d’un compte à une équipe ; numéro de maillot et poste pour un joueur."""

    __tablename__ = "assignments"
    __table_args__ = (
        UniqueConstraint("user_id", "team_id", "kind"),
        CheckConstraint("kind IN ('player','coach')"),
        CheckConstraint(
            "number IS NULL OR number BETWEEN 1 AND 99", name="assignments_number_range"
        ),
        CheckConstraint(
            "kind = 'player' OR (number IS NULL AND position_id IS NULL)",
            name="assignments_player_details",
        ),
        # Deux joueurs d’une même équipe ne partagent pas un numéro.
        Index(
            "assignments_team_number",
            "team_id",
            "number",
            unique=True,
            postgresql_where=text("number IS NOT NULL"),
        ),
    )
    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE", onupdate="CASCADE"), index=True
    )
    team_id: Mapped[str] = mapped_column(ForeignKey("teams.id", ondelete="CASCADE"))
    kind: Mapped[str] = mapped_column(String(10))
    number: Mapped[int | None] = mapped_column(Integer)
    position_id: Mapped[str | None] = mapped_column(ForeignKey("positions.id", ondelete="SET NULL"))


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
    """Demande d’inscription ; seule une demande acceptée compte parmi les inscrits."""

    __tablename__ = "registrations"
    __table_args__ = (
        UniqueConstraint("user_id", "event_id"),
        CheckConstraint(
            "status IN ('pending','accepted','rejected')", name="registrations_status_check"
        ),
    )
    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE", onupdate="CASCADE"), index=True
    )
    event_id: Mapped[str] = mapped_column(ForeignKey("events.id", ondelete="CASCADE"), index=True)
    status: Mapped[str] = mapped_column(String(10), default="pending")
    # Poste sur lequel le joueur veut s’entraîner ; vide si l’administration l’a supprimé.
    position_id: Mapped[str | None] = mapped_column(ForeignKey("positions.id", ondelete="SET NULL"))
    message: Mapped[str] = mapped_column(Text, default="", server_default="")
    decision: Mapped[str] = mapped_column(Text, default="", server_default="")
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
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
    # Référents de l’événement, à égalité de droits.
    referent_ids: Mapped[list[str]] = mapped_column(JSON, default=list)
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
    # Équipes organisatrices : leurs sections sont toujours concernées par l’événement.
    team_ids: Mapped[list[str]] = mapped_column(JSON, default=list)
    registration_limit: Mapped[int | None] = mapped_column(Integer)
    registration_count: Mapped[int] = column_property(
        select(func.count(Registration.id))
        .where(Registration.event_id == id, Registration.status == "accepted")
        .correlate_except(Registration)
        .scalar_subquery()
    )


class EventRevision(Identity, Base):
    __tablename__ = "event_revisions"
    event_id: Mapped[str] = mapped_column(ForeignKey("events.id"), index=True)
    actor_id: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL", onupdate="CASCADE")
    )
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
    actor_id: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL", onupdate="CASCADE")
    )
    actor_name: Mapped[str] = mapped_column(String(80))
    base_version: Mapped[int] = mapped_column(Integer)
    changes: Mapped[dict[str, Any]] = mapped_column(JSON)
    # Explication libre du demandeur, jointe aux champs proposés.
    description: Mapped[str] = mapped_column(Text, default="", server_default="")
    status: Mapped[str] = mapped_column(String(20), default="pending")
    decision: Mapped[str] = mapped_column(Text, default="")
    decided_by: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL", onupdate="CASCADE")
    )
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
        ForeignKey("users.id", ondelete="SET NULL", onupdate="CASCADE"), index=True
    )
    actor_name: Mapped[str] = mapped_column(String(80))
    proposal: Mapped[dict[str, Any]] = mapped_column(JSON)
    note: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(20), default="pending", index=True)
    decision: Mapped[str] = mapped_column(Text, default="")
    decided_by: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL", onupdate="CASCADE")
    )
    decider_name: Mapped[str | None] = mapped_column(String(80))
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    event_id: Mapped[str | None] = mapped_column(
        ForeignKey("events.id", ondelete="SET NULL"), unique=True
    )


class StaffRequest(Identity, Base):
    """Demande d’un coach ou d’un administrateur aux administrateurs.

    Pièces à obtenir d’un joueur, ou demande libre ; liée à un événement ou non. Les demandes
    de créneau et de modification ont leurs propres tables (CoachEventRequest, ChangeRequest).
    """

    __tablename__ = "staff_requests"
    __table_args__ = (
        CheckConstraint("kind IN ('document','other')", name="staff_requests_kind_check"),
        CheckConstraint(
            "status IN ('pending','accepted','rejected','withdrawn')",
            name="staff_requests_status_check",
        ),
    )
    kind: Mapped[str] = mapped_column(String(20))
    title: Mapped[str] = mapped_column(String(200))
    description: Mapped[str] = mapped_column(Text, default="", server_default="")
    event_id: Mapped[str | None] = mapped_column(
        ForeignKey("events.id", ondelete="SET NULL"), index=True
    )
    actor_id: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL", onupdate="CASCADE"), index=True
    )
    actor_name: Mapped[str] = mapped_column(String(80))
    # Demande de pièces : le joueur et les pièces voulues ({kind, label}).
    player_id: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL", onupdate="CASCADE")
    )
    documents: Mapped[list[dict[str, str]]] = mapped_column(JSON, default=list)
    # Conversation de la demande dans la messagerie du demandeur.
    thread_id: Mapped[str | None] = mapped_column(
        ForeignKey("question_threads.id", ondelete="SET NULL")
    )
    status: Mapped[str] = mapped_column(String(20), default="pending", index=True)
    decision: Mapped[str] = mapped_column(Text, default="", server_default="")
    decided_by: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL", onupdate="CASCADE")
    )
    decider_name: Mapped[str | None] = mapped_column(String(80))
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class Follow(Identity, Base):
    __tablename__ = "follows"
    __table_args__ = (
        UniqueConstraint("user_id", "event_id"),
        UniqueConstraint("user_id", "series_id"),
        CheckConstraint("(event_id IS NULL) <> (series_id IS NULL)"),
    )
    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE", onupdate="CASCADE"), index=True
    )
    event_id: Mapped[str | None] = mapped_column(ForeignKey("events.id", ondelete="CASCADE"))
    series_id: Mapped[str | None] = mapped_column(ForeignKey("event_series.id", ondelete="CASCADE"))


class QuestionThread(Identity, Base):
    __tablename__ = "question_threads"
    __table_args__ = (UniqueConstraint("user_id", "event_id"),)
    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE", onupdate="CASCADE"), index=True
    )
    # Sans événement (demande refusée…), la conversation porte un sujet.
    event_id: Mapped[str | None] = mapped_column(ForeignKey("events.id"))
    subject: Mapped[str] = mapped_column(String(200), default="", server_default="")


class QuestionMessage(Identity, Base):
    __tablename__ = "question_messages"
    thread_id: Mapped[str] = mapped_column(
        ForeignKey("question_threads.id", ondelete="CASCADE"), index=True
    )
    author_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE", onupdate="CASCADE")
    )
    body: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Notification(Identity, Base):
    __tablename__ = "notifications"
    __table_args__ = (UniqueConstraint("user_id", "dedupe_key"),)
    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE", onupdate="CASCADE"), index=True
    )
    kind: Mapped[str] = mapped_column(String(50))
    title: Mapped[str] = mapped_column(String(200))
    # Message libre (motif d’une décision…) et lien interne vers l’écran à ouvrir.
    body: Mapped[str] = mapped_column(Text, default="", server_default="")
    link: Mapped[str | None] = mapped_column(String(300))
    event_id: Mapped[str | None] = mapped_column(ForeignKey("events.id", ondelete="CASCADE"))
    dedupe_key: Mapped[str] = mapped_column(String(200))
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class EmailJob(Identity, Base):
    __tablename__ = "email_jobs"
    __table_args__ = (UniqueConstraint("user_id", "dedupe_key"),)
    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE", onupdate="CASCADE"), index=True
    )
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
    # Dernier relevé des résultats d’un jour de match, à 23 h 59.
    results_checked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
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


class FFVBResult(Identity, Base):
    """Résultat d’un match FFVB joué, relevé à chaque synchronisation de sa source.

    Indépendant des événements : un match joué avant l’import de la source a aussi son
    résultat.
    """

    __tablename__ = "ffvb_results"
    __table_args__ = (UniqueConstraint("source_id", "match_code"),)
    source_id: Mapped[str] = mapped_column(
        ForeignKey("ffvb_sources.id", ondelete="CASCADE"), index=True
    )
    match_code: Mapped[str] = mapped_column(String(30))
    kickoff_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    home_team: Mapped[str] = mapped_column(String(200))
    away_team: Mapped[str] = mapped_column(String(200))
    home_sets: Mapped[int] = mapped_column(Integer)
    away_sets: Mapped[int] = mapped_column(Integer)
    # Détail des sets, points de l’équipe à domicile en premier : « 25:21 ».
    set_scores: Mapped[list[str]] = mapped_column(JSON, default=list)
    points: Mapped[str] = mapped_column(String(20), default="", server_default="")
    recorded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class FFVBConflict(Identity, Base):
    __tablename__ = "ffvb_conflicts"
    match_id: Mapped[str] = mapped_column(ForeignKey("ffvb_matches.id"), index=True)
    field: Mapped[str] = mapped_column(String(30))
    official_value: Mapped[str | None] = mapped_column(Text)
    local_value: Mapped[str | None] = mapped_column(Text)
    author_id: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL", onupdate="CASCADE")
    )
    status: Mapped[str] = mapped_column(String(20), default="open")
    resolved_by: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL", onupdate="CASCADE")
    )
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
    # Dernière remise à zéro des licences (1er août) : chaque saison se refait.
    licenses_reset_on: Mapped[date | None] = mapped_column(Date)


def listed(column: InstrumentedAttribute[list[str]], value: str) -> ColumnElement[bool]:
    """Liste JSON (référents, sections…) qui contient `value`."""
    return cast(column, JSONB).contains([value])
