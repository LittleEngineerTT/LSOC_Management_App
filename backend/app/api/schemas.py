from datetime import date, datetime, time
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

Role = Literal["member", "coach", "admin", "president", "vice_president"]
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
    # Seule l’initiale est conservée ; obligatoire à la création, facultatif ensuite.
    last_name: str | None = Field(default=None, min_length=1, max_length=80)
    category: Category = "adult"
    # Facultatif : M ou F.
    sex: Literal["M", "F"] | None = None
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
    last_initial: str
    category: str
    sex: str | None = None
    roles: list[str]
    active: bool
    messaging_allowed: bool
    username: str | None
    # Photo d’entraîneur, lisible publiquement ; nulle sans photo.
    photo_url: str | None = None


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
    # Référents de l’équipe, à égalité de droits ; vide : à désigner.
    referent_ids: list[str] = Field(default_factory=list, max_length=10)


class TeamView(SectionView):
    section_id: str
    referent_ids: list[str]
    ffvb_source_warning_ignored: bool


class TeamWarningInput(Input):
    ignored: bool


class PlayerDetailsInput(Input):
    """Numéro de maillot et poste, réservés aux rattachements joueur."""

    number: int | None = Field(default=None, ge=1, le=99)
    position_id: str | None = None


class AssignmentInput(PlayerDetailsInput):
    team_id: str
    kind: Literal["player", "coach"]


class AssignmentView(View):
    id: str
    user_id: str
    team_id: str
    kind: str
    number: int | None
    position_id: str | None


class Interval(Input):
    starts_at: AwareDatetime
    ends_at: AwareDatetime

    @model_validator(mode="after")
    def interval(self) -> "Interval":
        if self.ends_at <= self.starts_at:
            raise ValueError("La fin doit suivre le début")
        return self


class RegistrationQuota(Input):
    """Places réservées : `limit` membres de la section, inscrits à l’un des postes."""

    # Places existantes : leur identifiant ; nouvelles : vide, attribué à l’enregistrement.
    id: str | None = Field(default=None, max_length=36)
    section_id: str = Field(min_length=1, max_length=36)
    position_ids: list[str] = Field(min_length=1, max_length=20)
    limit: int = Field(gt=0, le=1000)


class RegistrationQuotaView(View):
    id: str
    section_id: str
    position_ids: list[str]
    limit: int


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
    # Peut rester vide si des équipes organisatrices apportent leurs sections, ou si
    # l’événement est ouvert aux inscriptions de sections ou d’équipes.
    section_ids: list[str] = Field(default_factory=list)
    team_ids: list[str] = Field(default_factory=list)
    gymnasium_id: str | None = None
    location: str = Field(default="", max_length=200)
    courts: int = Field(ge=0, le=100)
    referent_ids: list[str] = Field(min_length=1, max_length=10)
    direct_edit: bool = False
    registration_section_ids: list[str] = Field(default_factory=list)
    registration_team_ids: list[str] = Field(default_factory=list)
    registration_limit: int | None = Field(default=None, gt=0, le=1000)
    registration_quotas: list[RegistrationQuota] = Field(default_factory=list, max_length=20)


class EventPatch(Input):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=2000)
    section_ids: list[str] | None = None
    team_ids: list[str] | None = None
    gymnasium_id: str | None = None
    location: str | None = Field(default=None, max_length=200)
    starts_at: AwareDatetime | None = None
    ends_at: AwareDatetime | None = None
    courts: int | None = Field(default=None, ge=0, le=100)
    referent_ids: list[str] | None = Field(default=None, min_length=1, max_length=10)
    direct_edit: bool | None = None
    cancelled: bool | None = None
    # 0 : tout le gymnase, selon sa capacité.
    match_courts: int | None = Field(default=None, ge=0, le=100)
    before_minutes: int | None = Field(default=None, ge=0, le=1440)
    after_minutes: int | None = Field(default=None, gt=0, le=1440)
    kickoff_at: AwareDatetime | None = None
    registration_section_ids: list[str] | None = None
    registration_team_ids: list[str] | None = Field(default_factory=list)
    registration_limit: int | None = Field(default=None, gt=0, le=1000)
    registration_quotas: list[RegistrationQuota] | None = Field(default=None, max_length=20)

    @model_validator(mode="after")
    def no_nulls(self) -> "EventPatch":
        for key in self.model_fields_set:
            if getattr(self, key) is None and key not in {"gymnasium_id", "registration_limit"}:
                raise ValueError(f"{key} ne peut pas être nul")
        if not self.model_fields_set:
            raise ValueError("Aucune modification")
        return self


class CancelInput(Input):
    base_version: int = Field(gt=0)
    # Motif choisi par l’annulation manuelle ; à défaut, le rôle de la personne qui annule.
    reason: Literal["capacity"] | None = None


class ChangeInput(Input):
    base_version: int = Field(gt=0)
    changes: EventPatch
    force: bool = False
    acknowledge_ffvb: bool = False
    # Explication jointe à une demande de modification ; ignorée d’une modification directe.
    description: str = Field(default="", max_length=2000)


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
    referent_ids: list[str]
    direct_edit: bool
    cancelled: bool
    cancel_reason: str = ""
    cancel_note: str = ""
    # Privé de terrains par une indisponibilité du gymnase, sans être annulé.
    conflict: bool = False
    conflict_note: str = ""
    version: int
    series_id: str | None
    exception: bool
    ffvb_match_id: str | None
    kickoff_at: datetime | None
    before_minutes: int
    after_minutes: int
    occupancy_unknown: bool
    # Match FFVB sur sa journée, heure à compléter.
    time_unknown: bool = False
    match_courts: int
    registration_section_ids: list[str]
    registration_team_ids: list[str] = Field(default_factory=list)
    registration_limit: int | None
    registration_quotas: list[RegistrationQuotaView] = Field(default_factory=list)
    registration_count: int
    team_ids: list[str] = Field(default_factory=list)


EventProblemCode = Literal[
    "capacity_exceeded",
    "missing_gymnasium",
    "no_referent",
    "ffvb_divergence",
    "ffvb_missing",
    "ffvb_disabled",
    "ffvb_suspended",
    "time_unknown",
    "unavailability_conflict",
]


class EventProblem(View):
    """Anomalie d’un événement à venir, à traiter par un administrateur."""

    code: EventProblemCode
    message: str


class EventConflictView(View):
    event: EventView
    problems: list[EventProblem]
    # Divergences FFVB ouvertes du match, à trancher depuis l’onglet Conflits.
    divergences: list["ConflictView"] = Field(default_factory=list)
    # Résumé des problèmes affichés : ignorer le conflit vaut tant qu’il ne change pas.
    signature: str
    ignored: bool = False
    ignorer_name: str | None = None
    ignored_at: datetime | None = None


class IgnoreInput(Input):
    """Signature du conflit tel que l’administrateur l’a vu."""

    signature: str = Field(min_length=1, max_length=64)


StaffFunction = Literal["president", "vice_president", "coach"]


class StaffView(View):
    """Membre du bureau ou entraîneur, présenté sans compte : prénom et fonctions seulement."""

    first_name: str
    functions: list[StaffFunction]
    # Photo d’un entraîneur ; nulle sans photo.
    photo: str | None = None
    # Équipes qu’entraîne un entraîneur (rattachements coach), par nom.
    teams: list[str] = []


class PublicTeamView(SectionView):
    """Équipe visible sans compte : nom et section, sans référent."""

    section_id: str


class PublicEventView(View):
    """Match FFVB visible sans compte : ni référent, ni inscriptions, ni description."""

    id: str
    title: str
    kind: str
    section_ids: list[str]
    gymnasium_id: str | None
    location: str
    starts_at: datetime
    ends_at: datetime
    cancelled: bool
    conflict: bool = False
    ffvb_match_id: str
    kickoff_at: datetime | None
    # Match à domicile au gymnase non associé : ni à l’extérieur, ni dans un gymnase connu.
    occupancy_unknown: bool = False
    # Journée connue, heure du match à compléter.
    time_unknown: bool = False
    team_ids: list[str]


class SeriesInput(Input):
    event: EventInput
    until: date
    # Jours de la semaine (0 = lundi … 6 = dimanche) ; par défaut, celui du premier événement.
    weekdays: list[int] | None = Field(default=None, min_length=1, max_length=7)
    force: bool = False

    @field_validator("weekdays")
    @classmethod
    def days(cls, value: list[int] | None) -> list[int] | None:
        if value is not None and (
            len(set(value)) != len(value) or any(d not in range(7) for d in value)
        ):
            raise ValueError("Jours de la semaine invalides")
        return value


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
    description: str
    status: str
    decision: str
    decided_by: str | None
    decider_name: str | None
    decided_at: datetime | None
    created_at: datetime


class CoachEventRequestInput(Interval):
    team_id: str
    # Autres équipes organisatrices, toutes entraînées ou référencées par le demandeur.
    team_ids: list[str] = Field(default_factory=list, max_length=20)
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
    # Récurrence hebdomadaire : fin incluse et jours (0 = lundi), comme POST /series.
    until: date | None = None
    weekdays: list[int] | None = Field(default=None, min_length=1, max_length=7)

    @field_validator("weekdays")
    @classmethod
    def days(cls, value: list[int] | None) -> list[int] | None:
        if value is not None and (
            len(set(value)) != len(value) or any(d not in range(7) for d in value)
        ):
            raise ValueError("Jours de la semaine invalides")
        return value


class CoachEventRequestView(View):
    id: str
    team_id: str | None
    # Demande en attente : créneaux tombant sur une indisponibilité (l’événement serait en conflit).
    unavailability: list[str] = Field(default_factory=list)
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


RequestKind = Literal["event_change", "slot", "document", "other", "registration"]


class RequestedDocument(Input):
    kind: Literal["medical_certificate", "identity", "reduction_proof", "other"]
    # Libellé d’une pièce « Autre » ; vide pour les pièces prédéfinies.
    label: str = Field(default="", max_length=120)


class StaffRequestInput(Input):
    """Demande aux administrateurs : pièces à obtenir d’un joueur, ou demande libre."""

    kind: Literal["document", "other"]
    title: str = Field(default="", max_length=200)
    description: str = Field(default="", max_length=4000)
    event_id: str | None = None
    player_id: str | None = None
    documents: list[RequestedDocument] = Field(default_factory=list, max_length=10)


# Un numéro lisible : chiffres, espaces, points, tirets, parenthèses et « + » initial.
PHONE_PATTERN = r"^\+?[0-9 .()-]{6,30}$"


class ContactInput(Input):
    """Demande de contact : un moyen de réponse au moins, la question et les équipes visées."""

    email: EmailStr | None = None
    phone: str | None = Field(default=None, max_length=30, pattern=PHONE_PATTERN)
    message: str = Field(min_length=1, max_length=4000)
    team_ids: list[str] = Field(min_length=1, max_length=20)

    @field_validator("email", "phone", mode="before")
    @classmethod
    def blank_is_none(cls, value: object) -> object:
        return None if isinstance(value, str) and not value.strip() else value

    @model_validator(mode="after")
    def reachable(self) -> "ContactInput":
        if self.email is None and self.phone is None:
            raise ValueError("Indiquez une adresse e-mail ou un téléphone pour la réponse")
        if self.phone is not None and sum(char.isdigit() for char in self.phone) < 6:
            raise ValueError("Numéro de téléphone invalide")
        return self


class ContactRequestView(View):
    id: str
    email: str | None
    phone: str | None
    message: str
    team_ids: list[str]
    status: Literal["open", "resolved"]
    handler_id: str | None
    handler_name: str | None
    handled_at: datetime | None
    resolved_at: datetime | None
    created_at: datetime


class RequestDecisionInput(Input):
    accept: bool
    reason: str = Field(default="", max_length=2000)


class RequestView(View):
    """Demande de tout type, sous une forme commune pour la liste unique des demandes."""

    id: str
    kind: RequestKind
    title: str
    description: str
    event_id: str | None
    actor_id: str | None
    actor_name: str
    status: str
    decision: str
    decider_name: str | None
    decided_at: datetime | None
    created_at: datetime
    thread_id: str | None = None
    player_id: str | None = None
    documents: list[dict[str, str]] = Field(default_factory=list)
    # Écran où la demande se traite (créneau et modification ont leur écran de validation).
    link: str
    # Demande d’inscription : poste demandé différent de celui du joueur en équipe.
    position_warning: bool = False


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


class OccurrenceConflict(View):
    """Occurrence d’une demande qui dépasserait la capacité du gymnase : terrains manquants."""

    starts_at: datetime
    ends_at: datetime
    missing: int


class SlotSearchInput(Input):
    """Recherche de créneau : période (par défaut d’aujourd’hui au 31 juillet), jours de la
    semaine (0 = lundi ; vide : tous), heure de début précise (`end` absent) ou plage horaire,
    durée, gymnases (vide : tous) et terrains."""

    from_date: date | None = None
    to_date: date | None = None
    weekdays: list[int] = Field(default_factory=list, max_length=7)
    start: time
    end: time | None = None
    duration_minutes: int = Field(ge=15, le=720)
    gymnasium_ids: list[str] = Field(default_factory=list, max_length=50)
    courts: int = Field(ge=1, le=100)

    @model_validator(mode="after")
    def window(self) -> "SlotSearchInput":
        if any(day < 0 or day > 6 for day in self.weekdays):
            raise ValueError("Jour de la semaine invalide")
        if self.from_date and self.to_date:
            if self.to_date < self.from_date:
                raise ValueError("La date de fin précède la date de début")
            if (self.to_date - self.from_date).days > 366:
                raise ValueError("La période de recherche ne dépasse pas un an")
        if self.end is not None:
            span = (self.end.hour * 60 + self.end.minute) - (
                self.start.hour * 60 + self.start.minute
            )
            if span < self.duration_minutes:
                raise ValueError("La plage horaire est plus courte que la durée demandée")
        return self


class SlotView(View):
    """Jour et gymnase où l’événement tient sans conflit : premières et dernières heures de début
    possibles (les mêmes pour une heure précise)."""

    day: date
    gymnasium_id: str
    first_start: datetime
    last_start: datetime


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
    event_id: str | None
    subject: str


RegistrationStatus = Literal["pending", "accepted", "rejected"]


class RegistrationInput(Input):
    # Poste sur lequel le joueur veut s’entraîner.
    position_id: str = Field(min_length=1, max_length=36)
    message: str = Field(default="", max_length=1000)


class RegistrationDecisionInput(Input):
    accept: bool
    reason: str = Field(default="", max_length=2000)


class RegistrationView(View):
    id: str
    user_id: str
    event_id: str
    status: RegistrationStatus
    position_id: str | None
    message: str
    decision: str
    decided_at: datetime | None
    created_at: datetime


class ParticipantView(View):
    user_id: str
    first_name: str
    created_at: datetime
    status: RegistrationStatus
    position_id: str | None
    message: str
    # Places réservées occupées ; nulle : ouverture classique.
    quota_id: str | None = None
    # Postes du joueur dans ses équipes ; alerte si le poste demandé n’en fait pas partie.
    team_position_ids: list[str] = Field(default_factory=list)
    position_warning: bool = False


class QuotaSummary(RegistrationQuotaView):
    # Inscrits acceptés sur ces places.
    count: int


class RegistrationSummary(View):
    event_id: str
    open: bool
    limit: int | None
    # Inscrits acceptés ; les demandes en attente sont comptées à part.
    count: int
    pending: int
    registered: bool
    # Demande du compte connecté : en attente, acceptée, refusée ou aucune.
    status: RegistrationStatus | None
    decision: str
    eligible: bool
    # Places réservées et leurs inscrits ; `count` les inclut, `limit` ne vaut que hors réserve.
    quotas: list[QuotaSummary] = Field(default_factory=list)
    # Postes que le compte connecté peut demander ; nul : tous (ouverture classique).
    allowed_position_ids: list[str] | None = None
    # Demandes en attente et inscrits, réservés aux administrateurs et au référent.
    participants: list[ParticipantView] | None


class UnreadView(View):
    messages: int
    notifications: int
    threads: list[str]
    # Nombre de messages non lus par fil, pour les pastilles de la messagerie.
    thread_counts: dict[str, int]
    # Notifications de demandes non lues (coachs et administrateurs), suivies dans
    # Messagerie › Demandes ; celles écrites dans un fil comptent déjà parmi les messages.
    requests: int = 0
    # Demandes de contact non résolues, pour la pastille de l’application Contact (admins).
    contacts: int = 0
    # Au moins un conflit ou un point FFVB à traiter : pastille sans nombre d’Administration.
    administration: bool = False
    # Au moins une question sans réponse ou une demande à décider : pastille de Messagerie.
    messaging_pending: bool = False
    # Le détail par onglet de la messagerie : demandes à décider, questions sans réponse.
    requests_pending: bool = False
    questions_pending: bool = False


LicenseStatus = Literal["none", "in_progress", "payment_pending", "active"]
# La licence coach n’a pas d’étape de paiement.
CoachLicenseStatus = Literal["none", "in_progress", "active"]


DocumentKind = Literal["medical_certificate", "identity", "reduction_proof", "other"]
DocumentStatus = Literal["requested", "submitted", "validated", "rejected"]


class DossierInput(Input):
    """Pièces ou paiement demandés à un joueur : ouvre son dossier, ou complète celui en cours."""

    user_id: str
    documents: list[RequestedDocument] = Field(default_factory=list, max_length=10)
    payment: bool = False
    note: str = Field(default="", max_length=2000)


class DocumentDecisionInput(Input):
    accept: bool
    reason: str = Field(default="", max_length=2000)


class DossierDocumentView(View):
    id: str
    kind: DocumentKind
    label: str
    status: DocumentStatus
    file_name: str | None
    uploaded_at: datetime | None
    decision: str
    # Fichier encore conservé : il disparaît à la clôture du dossier.
    has_file: bool


class DossierView(View):
    id: str
    user_id: str
    first_name: str
    opened_by: str | None
    note: str
    payment_requested: bool
    payment_validated_at: datetime | None
    created_at: datetime
    closed_at: datetime | None
    documents: list[DossierDocumentView]


class LicenseInput(Input):
    """Numéros et statuts des licences joueur et coach ; un champ absent reste inchangé."""

    number: str | None = Field(default=None, max_length=40, pattern=r"^[A-Za-z0-9-]+$")
    status: LicenseStatus | None = None
    coach_number: str | None = Field(default=None, max_length=40, pattern=r"^[A-Za-z0-9-]+$")
    coach_status: CoachLicenseStatus | None = None

    @field_validator("number", "coach_number", mode="before")
    @classmethod
    def blank(cls, value: object) -> object:
        return None if isinstance(value, str) and not value.strip() else value


class MyLicenseView(View):
    status: LicenseStatus
    coach_status: CoachLicenseStatus
    # Le compte est concerné par la licence coach (rôle ou rattachement coach).
    coach: bool


class LicenseTeamView(View):
    team_id: str
    kind: str


class LicenseView(View):
    user_id: str
    first_name: str
    username: str | None
    # Numéro de la licence joueur, qui sert d’identifiant au compte.
    number: str | None
    status: LicenseStatus
    # Numéro de la licence coach, éventuellement le même.
    coach_number: str | None = None
    coach_status: CoachLicenseStatus
    updated_at: datetime | None
    teams: list[LicenseTeamView]
    coach: bool
    # Joueur (resp. coach) rattaché à une équipe du périmètre sans licence active.
    missing_player: bool
    missing_coach: bool
    # Manque pour le type de licence consulté.
    missing: bool
    # URL publique du PDF déposé, lue directement par le navigateur.
    file_url: str | None = None
    file_uploaded_at: datetime | None = None
    # PDF de la licence coach.
    coach_file_url: str | None = None
    coach_file_uploaded_at: datetime | None = None


class FollowView(View):
    id: str
    user_id: str
    event_id: str | None
    series_id: str | None


class NotificationView(View):
    id: str
    kind: str
    title: str
    body: str
    link: str | None
    event_id: str | None
    read_at: datetime | None
    created_at: datetime


class FFVBResultView(View):
    match_code: str
    kickoff_at: datetime
    home_team: str
    away_team: str
    home_sets: int
    away_sets: int
    set_scores: list[str]
    points: str


class SourceResultsView(View):
    """Résultats récents d’une source FFVB, avec l’équipe et la section concernées."""

    source_id: str
    season: str
    pool: str
    # Nom de l’équipe du club sur la FFVB, pour savoir de quel côté elle joue.
    club_team: str
    team_id: str
    team_name: str
    section_id: str
    section_name: str
    results: list[FFVBResultView]


class StandingView(View):
    rank: int
    team: str
    points: int
    played: int
    won: int
    lost: int
    forfeits: int
    wins_3_0: int
    wins_3_1: int
    wins_3_2: int
    losses_2_3: int
    losses_1_3: int
    losses_0_3: int


class MatchScoreView(View):
    home_sets: int
    away_sets: int
    # Détail des sets, points de l’équipe à domicile en premier : « 25:21 ».
    set_scores: list[str]
    points: str


class TeamMatchView(View):
    """Match d’une équipe du club : à venir, ou joué avec son score."""

    match_code: str
    kickoff_at: datetime
    home_team: str
    away_team: str
    # Lieu FFVB ; nul pour un match joué avant le premier import, la FFVB n’affichant plus que
    # le score.
    location: str | None
    score: MatchScoreView | None
    # Journée connue, heure à compléter : `kickoff_at` est alors minuit, heure de Paris.
    time_unknown: bool = False


class SourceStandingsView(View):
    """Classement de la poule d’une équipe du club, pour sa saison la plus récente."""

    source_id: str
    season: str
    pool: str
    # Intitulé FFVB : « 2FC - CHAMPIONNAT REGIONAL 2 SENIOR FEMININ : POULE C ».
    title: str | None
    # Nom de l’équipe du club sur la FFVB, pour la repérer dans le classement.
    club_team: str
    team_id: str
    team_name: str
    section_id: str
    section_name: str
    # Dernier relevé ; nul tant que le classement n’a jamais été lu.
    updated_at: datetime | None
    rows: list[StandingView]
    # Matchs de l’équipe sur la saison, du plus ancien au plus récent.
    matches: list[TeamMatchView]


class FFVBSourceInput(Input):
    team_id: str
    season: str = Field(pattern=r"^\d{4}/\d{4}$")
    entity: str = Field(pattern=r"^[A-Za-z0-9]+$", max_length=30)
    pool: str = Field(pattern=r"^[A-Za-z0-9]+$", max_length=30)
    team_number: str = Field(pattern=r"^\d+$", max_length=20)
    team_name: str = Field(min_length=1, max_length=200)
    club_code: str = Field(pattern=r"^\d+$", max_length=30)
    enabled: bool = True
    # Vide : la source suit la configuration par défaut des matchs.
    before_minutes: int | None = Field(default=None, ge=0, le=1440)
    after_minutes: int | None = Field(default=None, gt=0, le=1440)
    # 0 : tout le gymnase, selon sa capacité.
    courts: int | None = Field(default=None, ge=0, le=100)
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
    before_minutes: int | None
    after_minutes: int | None
    courts: int | None
    interval_minutes: int
    interval_days: float
    next_check_at: datetime
    last_success_at: datetime | None
    results_checked_at: datetime | None = None
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
    # 0 : tout le gymnase, selon sa capacité.
    courts: int = Field(default=3, ge=0, le=100)


class EmailJobView(View):
    id: str
    user_id: str
    attempts: int
    due_at: datetime
    sent_at: datetime | None


# Référence en avant : la vue d’une divergence FFVB est définie plus bas.
EventConflictView.model_rebuild()
