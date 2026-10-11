from datetime import date, datetime
from typing import Literal

from pydantic import (
    AwareDatetime,
    BaseModel,
    ConfigDict,
    EmailStr,
    Field,
    field_validator,
    model_validator,
)

Role = Literal["member", "coach", "admin"]
Category = Literal["M18", "M21", "adult", "M15", "M13", "M11", "M9"]


class Input(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class View(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class Status(View):
    message: str


class TokenInput(Input):
    token: str = Field(min_length=20, max_length=200)


class PasswordInput(Input):
    password: str = Field(min_length=12, max_length=128)


# Identifiant libre ou adresse e-mail, sans vérification de l’adresse.
USERNAME_PATTERN = r"^[a-z0-9][a-z0-9._+-]*(@[a-z0-9][a-z0-9.-]*)?$"


class UsernameInput(Input):
    username: str = Field(min_length=3, max_length=80, pattern=USERNAME_PATTERN)

    @field_validator("username", mode="before")
    @classmethod
    def normalize_username(cls, value: object) -> object:
        return value.strip().lower() if isinstance(value, str) else value


class ActivateInput(TokenInput, PasswordInput, UsernameInput):
    pass


class ResetInput(TokenInput, PasswordInput):
    pass


class EmailInput(Input):
    email: EmailStr


class LoginInput(UsernameInput):
    password: str = Field(min_length=1, max_length=128)


class UserInput(Input):
    first_name: str = Field(min_length=1, max_length=80)
    category: Category = "adult"
    roles: list[Role] = Field(min_length=1)
    messaging_allowed: bool = True

    @model_validator(mode="after")
    def age(self) -> "UserInput":
        if "member" in self.roles and self.category not in {"M18", "M21", "adult"}:
            raise ValueError("Les adhérents doivent appartenir à M18 ou plus")
        self.roles = list(dict.fromkeys(self.roles))
        return self


class PublicProfileView(View):
    id: str
    first_name: str
    category: str


class UserView(View):
    id: str
    first_name: str
    category: str
    roles: list[str]
    active: bool
    messaging_allowed: bool
    username: str | None


class MeView(UserView):
    email: str | None
    followed_email: bool
    referent_email: bool
    admin_email: bool


class LoginView(View):
    user: MeView
    csrf_token: str


class InvitationView(View):
    user: UserView
    invitation_token: str
    invitation_url: str


class PasswordResetView(View):
    reset_token: str
    reset_url: str
    expires_at: datetime


class Preferences(Input):
    email: EmailStr | None = None
    followed_email: bool = True
    referent_email: bool = True
    admin_email: bool = True


class NameInput(Input):
    name: str = Field(min_length=1, max_length=120)


class SectionView(View):
    id: str
    name: str


class GymInput(NameInput):
    capacity: int = Field(gt=0, le=100)


class GymView(SectionView):
    capacity: int


class TeamInput(NameInput):
    section_id: str
    referent_id: str | None = None


class TeamView(SectionView):
    section_id: str
    referent_id: str | None
    ffvb_source_warning_ignored: bool


class TeamWarningInput(Input):
    ignored: bool


class AssignmentInput(Input):
    team_id: str
    kind: Literal["player", "coach"]


class AssignmentView(View):
    id: str
    user_id: str
    team_id: str
    kind: str


class Interval(Input):
    starts_at: AwareDatetime
    ends_at: AwareDatetime

    @model_validator(mode="after")
    def interval(self) -> "Interval":
        if self.ends_at <= self.starts_at:
            raise ValueError("La fin doit suivre le début")
        return self


class BlockInput(Interval):
    gymnasium_id: str
    title: str = Field(min_length=1, max_length=200)
    courts: int = Field(gt=0, le=100)


class BlockView(View):
    id: str
    gymnasium_id: str
    title: str
    starts_at: datetime
    ends_at: datetime
    courts: int


class EventInput(Interval):
    title: str = Field(min_length=1, max_length=200)
    description: str = Field(default="", max_length=2000)
    kind: Literal["training", "match", "other"] = "training"
    section_ids: list[str] = Field(min_length=1)
    gymnasium_id: str | None = None
    location: str = Field(default="", max_length=200)
    courts: int = Field(ge=0, le=100)
    referent_id: str
    direct_edit: bool = False
    registration_section_ids: list[str] = Field(default_factory=list)
    registration_team_ids: list[str] = Field(default_factory=list)
    registration_limit: int | None = Field(default=None, gt=0, le=1000)


class EventPatch(Input):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=2000)
    section_ids: list[str] | None = Field(default=None, min_length=1)
    gymnasium_id: str | None = None
    location: str | None = Field(default=None, max_length=200)
    starts_at: AwareDatetime | None = None
    ends_at: AwareDatetime | None = None
    courts: int | None = Field(default=None, ge=0, le=100)
    referent_id: str | None = None
    direct_edit: bool | None = None
    cancelled: bool | None = None
    match_courts: int | None = Field(default=None, gt=0, le=100)
    before_minutes: int | None = Field(default=None, ge=0, le=1440)
    after_minutes: int | None = Field(default=None, gt=0, le=1440)
    kickoff_at: AwareDatetime | None = None
    registration_section_ids: list[str] | None = None
    registration_team_ids: list[str] | None = Field(default_factory=list)
    registration_limit: int | None = Field(default=None, gt=0, le=1000)

    @model_validator(mode="after")
    def no_nulls(self) -> "EventPatch":
        for key in self.model_fields_set:
            if getattr(self, key) is None and key not in {"gymnasium_id", "registration_limit"}:
                raise ValueError(f"{key} ne peut pas être nul")
        if not self.model_fields_set:
            raise ValueError("Aucune modification")
        return self


class ChangeInput(Input):
    base_version: int = Field(gt=0)
    changes: EventPatch
    force: bool = False
    acknowledge_ffvb: bool = False


class EventView(View):
    id: str
    title: str
    description: str
    kind: str
    section_ids: list[str]
    gymnasium_id: str | None
    location: str
    starts_at: datetime
    ends_at: datetime
    courts: int
    referent_id: str | None
    direct_edit: bool
    cancelled: bool
    version: int
    series_id: str | None
    exception: bool
    ffvb_match_id: str | None
    kickoff_at: datetime | None
    before_minutes: int
    after_minutes: int
    occupancy_unknown: bool
    match_courts: int
    registration_section_ids: list[str]
    registration_team_ids: list[str] = Field(default_factory=list)
    registration_limit: int | None
    registration_count: int


class SeriesInput(Input):
    event: EventInput
    until: date
    force: bool = False


class SeriesChange(ChangeInput):
    from_event_id: str
    include_exceptions: bool = False


class DecisionInput(Input):
    accept: bool
    reason: str = Field(default="", max_length=2000)
    force: bool = False
    acknowledge_ffvb: bool = False


class ChangeView(View):
    id: str
    event_id: str
    actor_id: str | None
    actor_name: str
    base_version: int
    changes: dict[str, object]
    status: str
    decision: str
    decided_by: str | None
    decider_name: str | None
    decided_at: datetime | None
    created_at: datetime


class CoachEventRequestInput(Interval):
    team_id: str
    title: str = Field(min_length=1, max_length=200)
    description: str = Field(default="", max_length=2000)
    kind: Literal["training", "match", "other"] = "training"
    gymnasium_id: str | None = None
    location: str = Field(default="", max_length=200)
    courts: int = Field(ge=0, le=100)
    registration_section_ids: list[str] = Field(default_factory=list)
    registration_team_ids: list[str] = Field(default_factory=list)
    registration_limit: int | None = Field(default=None, gt=0, le=1000)
    note: str = Field(default="", max_length=2000)


class CoachEventRequestView(View):
    id: str
    team_id: str | None
    actor_id: str | None
    actor_name: str
    proposal: dict[str, object]
    note: str
    status: str
    decision: str
    decider_name: str | None
    decided_at: datetime | None
    created_at: datetime
    event_id: str | None


class RevisionView(View):
    id: str
    event_id: str
    actor_id: str | None
    actor_name: str
    origin: str
    action: str
    before: dict[str, object]
    after: dict[str, object]
    forced: bool
    decision_reason: str
    created_at: datetime


class RestoreInput(Input):
    base_version: int = Field(gt=0)
    fields: list[str] = Field(min_length=1)
    force: bool = False
    acknowledge_ffvb: bool = False


class CapacitySegment(View):
    starts_at: datetime
    ends_at: datetime
    occupied: int
    available: int
    excess: int


class CapacityView(View):
    gymnasium_id: str
    capacity: int
    segments: list[CapacitySegment]


class MessageInput(Input):
    body: str = Field(min_length=1, max_length=5000)


class MessageView(View):
    id: str
    thread_id: str
    author_id: str
    body: str
    created_at: datetime
    read_at: datetime | None


class ThreadView(View):
    id: str
    user_id: str
    event_id: str


class RegistrationView(View):
    id: str
    user_id: str
    event_id: str
    created_at: datetime


class ParticipantView(View):
    user_id: str
    first_name: str
    created_at: datetime


class RegistrationSummary(View):
    event_id: str
    open: bool
    limit: int | None
    count: int
    registered: bool
    eligible: bool
    participants: list[ParticipantView] | None


class UnreadView(View):
    messages: int
    notifications: int
    threads: list[str]


class FollowView(View):
    id: str
    user_id: str
    event_id: str | None
    series_id: str | None


class NotificationView(View):
    id: str
    kind: str
    title: str
    event_id: str | None
    read_at: datetime | None
    created_at: datetime


class FFVBSourceInput(Input):
    team_id: str
    season: str = Field(pattern=r"^\d{4}/\d{4}$")
    entity: str = Field(pattern=r"^[A-Za-z0-9]+$", max_length=30)
    pool: str = Field(pattern=r"^[A-Za-z0-9]+$", max_length=30)
    team_number: str = Field(pattern=r"^\d+$", max_length=20)
    team_name: str = Field(min_length=1, max_length=200)
    club_code: str = Field(pattern=r"^\d+$", max_length=30)
    enabled: bool = True
    interval_minutes: int = Field(default=1440, ge=5, le=525600, deprecated=True)
    interval_days: int | None = Field(default=None, ge=1, le=365, exclude=True)

    @model_validator(mode="after")
    def days(self) -> "FFVBSourceInput":
        if self.interval_days is not None:
            if (
                "interval_minutes" in self.model_fields_set
                and self.interval_minutes != self.interval_days * 1440
            ):
                raise ValueError("Fréquences en jours et minutes incompatibles")
            self.interval_minutes = self.interval_days * 1440
        return self


class FFVBSourceView(View):
    id: str
    team_id: str
    season: str
    entity: str
    pool: str
    team_number: str
    team_name: str
    club_code: str
    enabled: bool
    interval_minutes: int
    interval_days: float
    next_check_at: datetime
    last_success_at: datetime | None
    last_error: str | None


class FFVBClubInput(Input):
    club_code: str = Field(pattern=r"^\d+$", max_length=30)


class FFVBClubView(View):
    club_code: str | None


class SourceURLInput(Input):
    url: str = Field(min_length=1, max_length=2048)


class SourceCandidate(View):
    team_number: str
    team_name: str
    team_id: str | None = None


class SourcePreview(View):
    season: str
    entity: str
    pool: str
    club_code: str | None
    candidates: list[SourceCandidate]
    warning: str | None = None


class MappingInput(Input):
    official_name: str = Field(min_length=1, max_length=200)
    gymnasium_id: str


class MappingView(View):
    id: str
    official_name: str
    gymnasium_id: str


class MatchView(View):
    id: str
    source_id: str
    season: str
    entity: str
    match_code: str
    official: dict[str, object]
    protected: dict[str, str | None]
    last_verified_at: datetime | None
    last_changed_at: datetime | None
    suspended_until: datetime | None
    disabled: bool
    missing: bool


class ConflictView(View):
    id: str
    match_id: str
    field: str
    official_value: str | None
    local_value: str | None
    author_id: str | None
    status: str
    resolved_by: str | None
    resolver_name: str | None
    resolved_at: datetime | None
    created_at: datetime


class ResolutionInput(Input):
    action: Literal["accept_ffvb", "suspend_48h", "disable"]


class MatchDefaults(Input):
    before_minutes: int = Field(default=75, ge=0, le=1440)
    after_minutes: int = Field(default=150, gt=0, le=1440)
    courts: int = Field(default=3, gt=0, le=100)


class EmailJobView(View):
    id: str
    user_id: str
    attempts: int
    due_at: datetime
    sent_at: datetime | None
