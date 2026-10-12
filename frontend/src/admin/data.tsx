import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useSession } from '../auth/session';
import { createAdminApi, type AdminApi } from './api';
import type { Assignment, Catalog, Team } from './types';

interface AdminContextValue {
  api: AdminApi;
  catalog: Catalog;
  reloadCatalog: () => void;
  /** Administrateur ; sinon coach, en lecture seule. */
  admin: boolean;
  /** Équipes du périmètre du coach ; nul pour un administrateur (tout le club). */
  scope: string[] | null;
  /** Prénoms des référents d’équipe hors de la liste des utilisateurs (coach). */
  referents: Record<string, string>;
}
interface Loaded {
  catalog: Catalog;
  scope: string[] | null;
  referents: Record<string, string>;
}
const AdminContext = createContext<AdminContextValue | null>(null);
export function useAdmin() {
  const value = useContext(AdminContext);
  if (!value) throw new Error('AdminProvider requis');
  return value;
}

export function useLoad<T>(loader: (signal: AbortSignal) => Promise<T>) {
  const [result, setResult] = useState<{ data?: T; error?: string; loaded: boolean }>({
    loaded: false,
  });
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => {
    setResult((previous) => ({ data: previous.data, loaded: false }));
    setVersion((value) => value + 1);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    loader(controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setResult({ data, loaded: true });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setResult((previous) => ({
            data: previous.data,
            loaded: true,
            error: error instanceof Error ? error.message : 'Lecture impossible. Réessayez.',
          }));
      });
    return () => controller.abort();
  }, [loader, version]);
  return { ...result, reload };
}

export function useResource<T>(path: string, paginated = false) {
  const { api } = useAdmin();
  const loader = useCallback(
    (signal: AbortSignal) => api.list<T>(path, paginated, signal),
    [api, path, paginated],
  );
  return useLoad(loader);
}

export function AdminProvider({ children }: { children: ReactNode }) {
  const { account, csrfToken, clear } = useSession();
  const api = useMemo(() => createAdminApi(csrfToken, clear), [csrfToken, clear]);
  const admin = account?.roles.includes('admin') ?? false;
  const accountId = account?.id ?? '';
  const loader = useCallback(
    async (signal: AbortSignal): Promise<Loaded> => {
      if (!admin) {
        // Coach : membres de ses équipes (filtrés par le serveur), sections et équipes en
        // lecture, prénoms des référents, ses propres rattachements.
        const [users, sections, teams, mine] = await Promise.all([
          api.list<Catalog['users'][number]>('/users', true, signal),
          api.list<Catalog['sections'][number]>('/sections', false, signal),
          api.list<Team>('/teams', false, signal),
          api.list<Assignment>(
            `/users/${encodeURIComponent(accountId)}/assignments`,
            false,
            signal,
          ),
        ]);
        const unknown = [
          ...new Set(
            teams.flatMap((team) =>
              team.referent_id && !users.some((user) => user.id === team.referent_id)
                ? [team.referent_id]
                : [],
            ),
          ),
        ];
        const profiles = await Promise.all(
          unknown.map((id) =>
            api
              .request<{ id: string; first_name: string; category: string }>(
                `/profiles/${encodeURIComponent(id)}`,
                'GET',
                undefined,
                signal,
              )
              .catch(() => null),
          ),
        );
        const referents = Object.fromEntries(
          profiles.flatMap((profile) => (profile ? [[profile.id, profile.first_name]] : [])),
        );
        const scope = teams
          .filter(
            (team) =>
              team.referent_id === accountId ||
              mine.some((item) => item.team_id === team.id && item.kind === 'coach'),
          )
          .map((team) => team.id);
        return {
          catalog: { users, sections, teams, gymnasiums: [], sources: [] },
          scope,
          referents,
        };
      }
      const [users, sections, teams, gymnasiums, sources] = await Promise.all([
        api.list<Catalog['users'][number]>('/users', true, signal),
        api.list<Catalog['sections'][number]>('/sections', false, signal),
        api.list<Catalog['teams'][number]>('/teams', false, signal),
        api.list<Catalog['gymnasiums'][number]>('/gymnasiums', false, signal),
        api.list<Catalog['sources'][number]>('/ffvb/sources', false, signal),
      ]);
      return {
        catalog: { users, sections, teams, gymnasiums, sources },
        scope: null,
        referents: {},
      };
    },
    [api, admin, accountId],
  );
  const result = useLoad(loader);
  if (!result.data)
    return (
      <div className="admin-loading">
        {result.error ? (
          <>
            <p role="alert">{result.error}</p>
            <button className="admin-button" onClick={result.reload}>
              Réessayer
            </button>
          </>
        ) : (
          <p role="status">Chargement de l’administration…</p>
        )}
      </div>
    );
  return (
    <AdminContext.Provider
      value={{
        api,
        catalog: result.data.catalog,
        reloadCatalog: result.reload,
        admin,
        scope: result.data.scope,
        referents: result.data.referents,
      }}
    >
      {result.error && (
        <div className="admin-notice" role="alert">
          Les dernières données n’ont pas pu être chargées : {result.error}{' '}
          <button className="admin-button" onClick={result.reload}>
            Réessayer
          </button>
        </div>
      )}
      {children}
    </AdminContext.Provider>
  );
}
