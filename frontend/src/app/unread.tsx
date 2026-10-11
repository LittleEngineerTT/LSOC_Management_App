import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
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
}
interface UnreadContextValue extends Unread {
  refresh: () => void;
}
const empty: Unread = { messages: 0, notifications: 0, threads: [] };
const UnreadContext = createContext<UnreadContextValue>({ ...empty, refresh: () => undefined });
export const useUnread = () => useContext(UnreadContext);

const REFRESH_MS = 60_000;

/** Compteurs des pastilles du menu, rafraîchis périodiquement et après chaque lecture. */
export function UnreadProvider({ children }: { children: ReactNode }) {
  const { csrfToken, clear } = useSession();
  const api = useMemo(() => createAdminApi(csrfToken, clear), [csrfToken, clear]);
  const [unread, setUnread] = useState<Unread>(empty);
  const [version, setVersion] = useState(0);
  const refresh = useCallback(() => setVersion((value) => value + 1), []);
  useEffect(() => {
    const controller = new AbortController();
    const load = () =>
      api
        .request<Unread>('/unread', 'GET', undefined, controller.signal)
        .then((value) => {
          // Une API simulée ou ancienne peut répondre autre chose : on garde zéro.
          if (typeof value?.messages === 'number') setUnread(value);
        })
        .catch(() => undefined);
    void load();
    const timer = window.setInterval(() => void load(), REFRESH_MS);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [api, version]);
  return <UnreadContext.Provider value={{ ...unread, refresh }}>{children}</UnreadContext.Provider>;
}

export function CountBadge({ count, label }: { count: number; label: [string, string] }) {
  if (!count) return null;
  return (
    <span className="nav-count" aria-label={`${count} ${label[count > 1 ? 1 : 0]}`}>
      {count > 99 ? '99+' : count}
    </span>
  );
}
