import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createAdminApi } from '../admin/api';
import { useSession } from '../auth/session';

export interface Unread {
  /** Questions reçues (admin) ou réponses reçues (adhérent) non lues. */
  messages: number;
  notifications: number;
  /** Fils contenant au moins un message non lu. */
  threads: string[];
  /** Messages non lus par fil ; absent d’une API antérieure. */
  thread_counts?: Record<string, number>;
  /** Notifications de demandes non lues, suivies dans Messagerie › Demandes (coachs et
   * administrateurs) ; absent d’une API antérieure. */
  requests?: number;
  /** Demandes de contact non résolues (administrateurs) ; absent d’une API antérieure. */
  contacts?: number;
  /** Au moins un conflit ou un point FFVB à traiter (administrateurs) ; absent d’une API
   * antérieure. */
  administration?: boolean;
  /** Au moins une question sans réponse ou une demande à décider (coachs et
   * administrateurs) ; absent d’une API antérieure. */
  messaging_pending?: boolean;
}
interface UnreadContextValue extends Unread {
  refresh: () => void;
  /** Nombre de signaux reçus du serveur depuis l’ouverture : les listes s’y rechargent. */
  live: number;
}
const empty: Unread = { messages: 0, notifications: 0, threads: [] };
const UnreadContext = createContext<UnreadContextValue>({
  ...empty,
  refresh: () => undefined,
  live: 0,
});
export const useUnread = () => useContext(UnreadContext);

/** Flux d’événements du serveur (Server-Sent Events), sur le même domaine que l’API. */
export const LIVE_URL = '/api/v1/live';
// Sans flux (proxy qui le bloque, navigateur ancien) : relecture régulière des compteurs.
const FALLBACK_MS = 60_000;
// Avec flux : simple filet de sécurité, le serveur signale chaque changement.
const SAFETY_MS = 5 * 60_000;

/** Compteurs des pastilles du menu : mis à jour dès qu’un signal du serveur arrive, après
 * chaque lecture, au retour sur l’onglet et, en secours, à intervalle régulier. */
export function UnreadProvider({ children }: { children: ReactNode }) {
  const { csrfToken, clear } = useSession();
  const api = useMemo(() => createAdminApi(csrfToken, clear), [csrfToken, clear]);
  const [unread, setUnread] = useState<Unread>(empty);
  const [version, setVersion] = useState(0);
  const [live, setLive] = useState(0);
  const refresh = useCallback(() => setVersion((value) => value + 1), []);
  const load = useCallback(
    (signal: AbortSignal) =>
      api
        .request<Unread>('/unread', 'GET', undefined, signal)
        .then((value) => {
          // Une API simulée ou ancienne peut répondre autre chose : on garde zéro.
          if (typeof value?.messages === 'number') setUnread(value);
        })
        .catch(() => undefined),
    [api],
  );
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load, version]);
  useEffect(() => {
    const controller = new AbortController();
    let timer: number | undefined;
    let connected = false;
    // Premier signal d’une connexion : rattrapage des compteurs, pas un changement.
    let fresh = true;
    const schedule = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(
        () => {
          void load(controller.signal);
          schedule();
        },
        connected ? SAFETY_MS : FALLBACK_MS,
      );
    };
    schedule();
    const source = typeof EventSource === 'function' ? new EventSource(LIVE_URL) : null;
    if (source) {
      source.onopen = () => {
        connected = true;
        fresh = true;
        schedule();
      };
      // Le navigateur se reconnecte seul ; d’ici là, la relecture régulière prend le relais.
      source.onerror = () => {
        connected = false;
        schedule();
      };
      source.addEventListener('unread', () => {
        void load(controller.signal);
        if (fresh) fresh = false;
        else setLive((value) => value + 1);
      });
      // Session terminée : la relecture reçoit 401 et ramène à la connexion.
      source.addEventListener('session', () => {
        source.close();
        connected = false;
        void load(controller.signal);
      });
    }
    const back = () => {
      if (document.visibilityState === 'visible') void load(controller.signal);
    };
    document.addEventListener('visibilitychange', back);
    window.addEventListener('online', back);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
      source?.close();
      document.removeEventListener('visibilitychange', back);
      window.removeEventListener('online', back);
    };
  }, [load]);
  return (
    <UnreadContext.Provider value={{ ...unread, refresh, live }}>{children}</UnreadContext.Provider>
  );
}

/** Recharge une liste à chaque signal du serveur (nouvelle notification, message…). */
export function useLiveReload(reload: () => void) {
  const { live } = useUnread();
  const latest = useRef(reload);
  useEffect(() => {
    latest.current = reload;
  });
  useEffect(() => {
    if (live > 0) latest.current();
  }, [live]);
}

export function CountBadge({ count, label }: { count: number; label: [string, string] }) {
  if (!count) return null;
  return (
    <span className="nav-count" aria-label={`${count} ${label[count > 1 ? 1 : 0]}`}>
      {count > 99 ? '99+' : count}
    </span>
  );
}

/** Pastille sans nombre : au moins un point à traiter. */
export function PendingDot({ pending, label }: { pending: boolean; label: string }) {
  if (!pending) return null;
  return <span className="nav-count nav-pending" role="img" aria-label={label} />;
}
