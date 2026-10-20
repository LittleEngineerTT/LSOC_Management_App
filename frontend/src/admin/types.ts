export type Role = 'member' | 'coach' | 'admin';
export interface User {
  /** Numéro de licence, ou identifiant temporaire « initiale-prénom-section ». */
  id: string;
  username?: string | null;
  first_name: string;
  /** Initiale du nom de famille, seule partie conservée. */
  last_initial?: string;
  category: string;
  /** Facultatif : M ou F. */
  sex?: 'M' | 'F' | null;
  roles: Role[];
  active: boolean;
  messaging_allowed: boolean;
}
export interface Invitation {
  user: User;
  invitation_url: string;
  invitation_token: string;
}
export interface Section {
  id: string;
  name: string;
}
export interface Gymnasium extends Section {
  capacity: number;
}
export interface Team extends Section {
  section_id: string;
  /** Référents de l’équipe, à égalité de droits ; vide : à désigner. */
  referent_ids: string[];
  ffvb_source_warning_ignored?: boolean;
}
export interface Assignment {
  id: string;
  user_id: string;
  team_id: string;
  kind: 'player' | 'coach';
  /** Numéro de maillot et poste, pour un joueur. */
  number?: number | null;
  position_id?: string | null;
}
/** Poste attribuable aux joueurs, défini dans l’administration. */
export type Position = Section;
export interface Catalog {
  users: User[];
  sections: Section[];
  teams: Team[];
  gymnasiums: Gymnasium[];
  sources: Source[];
  positions: Position[];
}
export interface Block {
  id: string;
  gymnasium_id: string;
  title: string;
  starts_at: string;
  ends_at: string;
  courts: number;
}
export interface Source {
  id: string;
  team_id: string;
  season: string;
  entity: string;
  pool: string;
  team_number: string;
  team_name: string;
  club_code: string;
  enabled: boolean;
  /** Réglages propres à la source ; nul = configuration par défaut. */
  before_minutes?: number | null;
  after_minutes?: number | null;
  courts?: number | null;
  interval_minutes: number;
  interval_days?: number;
  next_check_at: string;
  last_success_at: string | null;
  last_error: string | null;
}
export interface Mapping {
  id: string;
  official_name: string;
  gymnasium_id: string;
}
export interface Defaults {
  before_minutes: number;
  after_minutes: number;
  courts: number;
}
export interface Match {
  id: string;
  source_id: string;
  season: string;
  entity: string;
  match_code: string;
  official: Record<string, unknown>;
  protected: Record<string, string | null>;
  last_verified_at: string | null;
  last_changed_at: string | null;
  suspended_until: string | null;
  disabled: boolean;
  missing: boolean;
}
export interface Conflict {
  id: string;
  match_id: string;
  field: string;
  official_value: string | null;
  local_value: string | null;
  author_id: string | null;
  status: string;
  created_at: string;
}
export interface EmailJob {
  id: string;
  user_id: string;
  attempts: number;
  due_at: string;
  sent_at: string | null;
}
export interface Event {
  id: string;
  title: string;
  /** Texte libre ; absent dans les contrats antérieurs à la migration 0008. */
  description?: string;
  kind: 'training' | 'match' | 'other';
  section_ids: string[];
  gymnasium_id: string | null;
  location: string;
  starts_at: string;
  ends_at: string;
  courts: number;
  /** Référents de l’événement, à égalité de droits. */
  referent_ids: string[];
  direct_edit: boolean;
  cancelled: boolean;
  version: number;
  series_id: string | null;
  exception: boolean;
  ffvb_match_id: string | null;
  kickoff_at: string | null;
  before_minutes: number;
  after_minutes: number;
  match_courts: number;
  occupancy_unknown: boolean;
  /** Sections dont les adhérents peuvent s’inscrire. */
  registration_section_ids: string[];
  /** Équipes ouvertes, en union avec les sections ; absent dans les anciens contrats. */
  registration_team_ids?: string[];
  registration_limit: number | null;
  registration_count: number;
  /** Équipes organisatrices ; absentes des anciens contrats. */
  team_ids?: string[];
}
/** Demande d’inscription : seule une demande acceptée compte parmi les inscrits. */
export type RegistrationStatus = 'pending' | 'accepted' | 'rejected';
export interface Participant {
  user_id: string;
  first_name: string;
  created_at: string;
  status: RegistrationStatus;
  /** Poste demandé ; vide si l’administration l’a supprimé depuis. */
  position_id: string | null;
  message: string;
}
export interface RegistrationSummary {
  event_id: string;
  open: boolean;
  limit: number | null;
  /** Inscrits acceptés ; les demandes en attente sont dans `pending`. */
  count: number;
  pending: number;
  registered: boolean;
  /** Demande du compte connecté. */
  status: RegistrationStatus | null;
  /** Message joint à la décision sur cette demande. */
  decision: string;
  eligible: boolean;
  /** Demandes en attente et inscrits, pour les administrateurs et le référent. */
  participants: Participant[] | null;
}
export interface Registration {
  id: string;
  user_id: string;
  event_id: string;
  status: RegistrationStatus;
  position_id: string | null;
  message: string;
  decision: string;
  decided_at: string | null;
  created_at: string;
}
export interface ChangeRequest {
  id: string;
  event_id: string;
  actor_name: string;
  base_version: number;
  changes: Record<string, unknown>;
  status: string;
  decision: string;
  decider_name: string | null;
  decided_at: string | null;
  created_at: string;
}
export interface EventProposal extends Record<string, unknown> {
  title: string;
  kind: Event['kind'];
  section_ids: string[];
  /** Équipes organisatrices, la principale en tête ; absentes des anciennes demandes. */
  team_ids?: string[];
  gymnasium_id: string | null;
  location: string;
  starts_at: string;
  ends_at: string;
  courts: number;
  referent_ids: string[];
  direct_edit: boolean;
  registration_section_ids: string[];
  registration_team_ids: string[];
  registration_limit: number | null;
}
export interface EventRequest {
  id: string;
  /** Demande en attente : créneaux sur une indisponibilité du gymnase (« jj/mm/aaaa : motif »). */
  unavailability?: string[];
  team_id: string | null;
  actor_id: string | null;
  actor_name: string;
  proposal: EventProposal;
  note: string;
  status: string;
  decision: string;
  decider_name: string | null;
  decided_at: string | null;
  created_at: string;
  event_id: string | null;
}
export interface Revision {
  id: string;
  event_id: string;
  actor_name: string;
  origin: string;
  action: string;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  forced: boolean;
  decision_reason: string;
  created_at: string;
}
export interface Capacity {
  capacity: number;
  segments: {
    starts_at: string;
    ends_at: string;
    occupied: number;
    available: number;
    excess: number;
  }[];
}
