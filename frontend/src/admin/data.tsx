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
import type { Catalog } from './types';

interface AdminContextValue {
  api: AdminApi;
  catalog: Catalog;
  reloadCatalog: () => void;
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
  const { csrfToken, clear } = useSession();
  const api = useMemo(() => createAdminApi(csrfToken, clear), [csrfToken, clear]);
  const loader = useCallback(
    async (signal: AbortSignal): Promise<Catalog> => {
      const [users, sections, teams, gymnasiums, sources] = await Promise.all([
        api.list<Catalog['users'][number]>('/users', true, signal),
        api.list<Catalog['sections'][number]>('/sections', false, signal),
        api.list<Catalog['teams'][number]>('/teams', false, signal),
        api.list<Catalog['gymnasiums'][number]>('/gymnasiums', false, signal),
        api.list<Catalog['sources'][number]>('/ffvb/sources', false, signal),
      ]);
      return { users, sections, teams, gymnasiums, sources };
    },
    [api],
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
    <AdminContext.Provider value={{ api, catalog: result.data, reloadCatalog: result.reload }}>
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
