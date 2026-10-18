import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { createAdminApi, type AdminApi } from '../admin/api';
import { useLoad } from '../admin/data';
import type { Assignment, Event, Gymnasium, Position, Section, Team, User } from '../admin/types';
import type { Account } from '../api/auth';
import { useSession } from '../auth/session';
import '../admin/admin.css';
import './club.css';

export interface Follow {
  id: string;
  user_id: string;
  event_id: string | null;
  series_id: string | null;
}
export interface Thread {
  id: string;
  user_id: string;
  /** Nul pour une conversation sans événement (décision sur une demande refusée…). */
  event_id: string | null;
  subject?: string;
}
export interface Message {
  id: string;
  thread_id: string;
  author_id: string;
  body: string;
  created_at: string;
  read_at: string | null;
}
export interface Notification {
  id: string;
  kind: string;
  title: string;
  /** Message de l’auteur (motif d’une décision…) ; absent des anciennes API. */
  body?: string;
  /** Écran à ouvrir, par exemple la validation d’une demande. */
  link?: string | null;
  event_id: string | null;
  read_at: string | null;
  created_at: string;
}
interface Club {
  sections: Section[];
  teams: Team[];
  gymnasiums: Gymnasium[];
  follows: Follow[];
  assignments: Assignment[];
  /** Postes des joueurs, pour afficher ceux du compte. */
  positions: Position[];
  /** Comptes, lisibles uniquement par les administrateurs. */
  users: User[];
}
interface ClubContextValue extends Club {
  api: AdminApi;
  account: Account;
  admin: boolean;
  /** Visite sans compte : seuls les matchs FFVB et les noms publics sont chargés. */
  guest: boolean;
  reload: () => void;
  setFollows: (follows: Follow[]) => void;
}
const ClubContext = createContext<ClubContextValue | null>(null);
export function useClub() {
  const value = useContext(ClubContext);
  if (!value) throw new Error('ClubProvider requis');
  return value;
}

export function ClubProvider({ account, children }: { account: Account; children: ReactNode }) {
  const { csrfToken, clear } = useSession();
  const api = useMemo(() => createAdminApi(csrfToken, clear), [csrfToken, clear]);
  const admin = account.roles.includes('admin');
  const loader = useCallback(
    async (signal: AbortSignal): Promise<Club> => {
      const [sections, teams, gymnasiums, follows, assignments, positions, users] =
        await Promise.all([
          api.list<Section>('/sections', false, signal),
          api.list<Team>('/teams', false, signal),
          api.list<Gymnasium>('/gymnasiums', false, signal),
          api.list<Follow>('/follows', false, signal),
          api.list<Assignment>(`/users/${account.id}/assignments`, false, signal),
          api.list<Position>('/positions', false, signal),
          admin ? api.list<User>('/users', true, signal) : Promise.resolve([]),
        ]);
      return { sections, teams, gymnasiums, follows, assignments, positions, users };
    },
    [api, account.id, admin],
  );
  const result = useLoad(loader);
  const [follows, setFollows] = useState<Follow[] | null>(null);
  if (!result.data)
    return (
      <div className="administration club">
        {result.error ? (
          <div className="admin-notice" role="alert">
            {result.error}
            <button className="admin-button" onClick={result.reload}>
              Réessayer
            </button>
          </div>
        ) : (
          <p className="admin-loading" role="status">
            Chargement…
          </p>
        )}
      </div>
    );
  const data = result.data;
  return (
    <ClubContext.Provider
      value={{
        ...data,
        follows: follows ?? data.follows,
        api,
        account,
        admin,
        guest: false,
        reload: () => {
          setFollows(null);
          result.reload();
        },
        setFollows,
      }}
    >
      <div className="administration club">
        {result.error && (
          <div className="admin-notice" role="alert">
            Les dernières données n’ont pas pu être chargées : {result.error}{' '}
            <button className="admin-button" onClick={result.reload}>
              Réessayer
            </button>
          </div>
        )}
        {children}
      </div>
    </ClubContext.Provider>
  );
}

/** Compte fictif des invités : aucun rôle, aucun identifiant réel. */
export const guestAccount: Account = {
  id: '',
  username: null,
  first_name: 'Invité',
  category: '',
  roles: [],
  active: true,
  email: null,
  messaging_allowed: false,
  followed_email: false,
  referent_email: false,
  admin_email: false,
};

/** Contexte club d’un invité, lu sur l’API publique : sections, équipes et noms des gymnases. */
export function GuestClubProvider({ children }: { children: ReactNode }) {
  const { csrfToken, clear } = useSession();
  const api = useMemo(() => createAdminApi(csrfToken, clear), [csrfToken, clear]);
  const loader = useCallback(
    async (signal: AbortSignal) => {
      const [sections, teams, gymnasiums] = await Promise.all([
        api.list<Section>('/public/sections', false, signal),
        api.list<Pick<Team, 'id' | 'name' | 'section_id'>>('/public/teams', false, signal),
        api.list<Pick<Gymnasium, 'id' | 'name'>>('/public/gymnasiums', false, signal),
      ]);
      return {
        sections,
        // Ni référent ni capacité ne sont publics ; aucune page invité ne les lit.
        teams: teams.map((team) => ({ ...team, referent_id: null })),
        gymnasiums: gymnasiums.map((gym) => ({ ...gym, capacity: 0 })),
      };
    },
    [api],
  );
  const result = useLoad(loader);
  if (!result.data)
    return (
      <div className="administration club">
        {result.error ? (
          <div className="admin-notice" role="alert">
            {result.error}
            <button className="admin-button" onClick={result.reload}>
              Réessayer
            </button>
          </div>
        ) : (
          <p className="admin-loading" role="status">
            Chargement…
          </p>
        )}
      </div>
    );
  return (
    <ClubContext.Provider
      value={{
        ...result.data,
        follows: [],
        assignments: [],
        positions: [],
        users: [],
        api,
        account: guestAccount,
        admin: false,
        guest: true,
        reload: result.reload,
        setFollows: () => undefined,
      }}
    >
      <div className="administration club">{children}</div>
    </ClubContext.Provider>
  );
}

// Prénoms visibles des comptes, partagés entre les écrans de la session.
const profiles = new Map<string, Promise<string>>();
export function usePersonName(id: string | null | undefined): string {
  const { api, users, account } = useClub();
  const known = !id
    ? 'Aucun'
    : id === account.id
      ? account.first_name
      : users.find((user) => user.id === id)?.first_name;
  const [loaded, setLoaded] = useState<{ id: string; name: string } | null>(null);
  useEffect(() => {
    if (!id || known) return;
    let active = true;
    let pending = profiles.get(id);
    if (!pending) {
      pending = api
        .request<{ first_name: string }>(`/profiles/${id}`)
        .then((profile) => profile.first_name)
        .catch(() => {
          profiles.delete(id);
          return 'Compte supprimé';
        });
      profiles.set(id, pending);
    }
    void pending.then((name) => {
      if (active) setLoaded({ id, name });
    });
    return () => {
      active = false;
    };
  }, [api, id, known]);
  return known ?? (loaded && loaded.id === id ? loaded.name : '…');
}
export function PersonName({ id }: { id: string | null | undefined }) {
  return <>{usePersonName(id)}</>;
}

/** Sections reliées au compte par ses rattachements d’équipe. */
export function useMySections(): Section[] {
  const { assignments, teams, sections } = useClub();
  const ids = new Set(
    assignments
      .map((item) => teams.find((team) => team.id === item.team_id)?.section_id)
      .filter((id): id is string => !!id),
  );
  return sections.filter((section) => ids.has(section.id));
}

export function isFollowed(follows: Follow[], event: Event) {
  return follows.some(
    (follow) =>
      follow.event_id === event.id || (!!event.series_id && follow.series_id === event.series_id),
  );
}
