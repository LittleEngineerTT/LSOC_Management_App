import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { ApiError, authApi, csrfCookie, type Account, type LoginResult } from '../api/auth';

interface Session {
  account: Account | null;
  /** Visite sans compte : accueil et matchs FFVB uniquement. Ignoré une fois connecté. */
  guest: boolean;
  continueAsGuest: () => void;
  state: 'idle' | 'loading' | 'ready' | 'error';
  error: string;
  retry: () => void;
  connected: (result: LoginResult) => void;
  clear: () => void;
  csrfToken: () => string | undefined;
  logout: (signal: AbortSignal) => Promise<void>;
}
const SessionContext = createContext<Session | null>(null);

// Le choix « invité » vaut pour l’onglet : il survit à un rechargement, pas à la fermeture.
const GUEST_KEY = 'lsoc_guest';
function storedGuest() {
  try {
    return window.sessionStorage.getItem(GUEST_KEY) === '1';
  } catch {
    return false;
  }
}
function storeGuest(value: boolean) {
  try {
    if (value) window.sessionStorage.setItem(GUEST_KEY, '1');
    else window.sessionStorage.removeItem(GUEST_KEY);
  } catch {
    // Stockage indisponible (navigation privée…) : le mode invité dure jusqu’au rechargement.
  }
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const location = useLocation();
  const needsSession =
    location.pathname === '/' ||
    location.pathname === '/login' ||
    location.pathname.startsWith('/app');
  const [account, setAccount] = useState<Account | null>(null);
  const [guest, setGuest] = useState(storedGuest);
  const [csrf, setCsrf] = useState<string>();
  const [state, setState] = useState<Session['state']>('idle');
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!needsSession || state !== 'idle') return;
    const controller = new AbortController();
    // Keep the idle state while pending so StrictMode can cancel and retry the first effect.
    authApi
      .me(controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        setAccount(result);
        setState('ready');
      })
      .catch((failure: unknown) => {
        if (controller.signal.aborted) return;
        if (failure instanceof ApiError && failure.status === 401) {
          setAccount(null);
          setState('ready');
        } else {
          setError(
            failure instanceof Error ? failure.message : 'Impossible de vérifier votre session.',
          );
          setState('error');
        }
      });
    return () => controller.abort();
  }, [needsSession, state, attempt]);

  const clear = useCallback(() => {
    setAccount(null);
    setCsrf(undefined);
    setState('ready');
  }, []);
  const continueAsGuest = useCallback(() => {
    storeGuest(true);
    setGuest(true);
  }, []);
  const connected = useCallback((result: LoginResult) => {
    storeGuest(false);
    setGuest(false);
    setAccount(result.user);
    setCsrf(result.csrf_token);
    setState('ready');
  }, []);
  const csrfToken = useCallback(() => csrfCookie() ?? csrf, [csrf]);
  const retry = useCallback(() => {
    setError('');
    setState('idle');
    setAttempt((value) => value + 1);
  }, []);
  async function logout(signal: AbortSignal) {
    const value = csrfCookie() ?? csrf;
    if (!value)
      throw new Error('Le jeton de session est manquant. Rechargez la page puis réessayez.');
    try {
      await authApi.logout(value, signal);
      clear();
    } catch (failure) {
      if (failure instanceof ApiError && failure.status === 401) clear();
      else throw failure;
    }
  }
  return (
    <SessionContext.Provider
      value={{
        account,
        guest,
        continueAsGuest,
        state,
        error,
        retry,
        connected,
        clear,
        csrfToken,
        logout,
      }}
    >
      {children}
    </SessionContext.Provider>
  );
}

export function useSession(): Session {
  const session = useContext(SessionContext);
  if (!session) throw new Error('SessionProvider requis');
  return session;
}
