export type Role = 'member' | 'coach' | 'admin';
export interface User {
  id: string;
  username?: string | null;
  first_name: string;
  category: string;
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
  referent_id: string | null;
  ffvb_source_warning_ignored?: boolean;
}
export interface Assignment {
  id: string;
  user_id: string;
  team_id: string;
  kind: 'player' | 'coach';
}
export interface Catalog {
  users: User[];
  sections: Section[];
  teams: Team[];
  gymnasiums: Gymnasium[];
  sources: Source[];
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
  kind: 'training' | 'match' | 'other';
  section_ids: string[];
  gymnasium_id: string | null;
  location: string;
  starts_at: string;
  ends_at: string;
  courts: number;
  referent_id: string | null;
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
