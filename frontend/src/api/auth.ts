export interface Account {
  id: string;
  username: string | null;
  first_name: string;
  category: string;
  roles: ('member' | 'coach' | 'admin')[];
  active: boolean;
  email: string | null;
  messaging_allowed: boolean;
  followed_email: boolean;
  referent_email: boolean;
  admin_email: boolean;
}

export interface LoginResult {
  user: Account;
  csrf_token: string;
}
interface Status {
  message: string;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

export function csrfCookie(): string | undefined {
  const value = document.cookie.split('; ').find((cookie) => cookie.startsWith('lsoc_csrf='));
  return value ? decodeURIComponent(value.slice('lsoc_csrf='.length)) : undefined;
}

async function request<T>(
  path: string,
  body?: object,
  signal?: AbortSignal,
  csrf?: string,
): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) controller.abort();
  let timedOut = false;
  const timer = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, 15_000);
  try {
    const headers = new Headers({ Accept: 'application/json' });
    if (body) headers.set('Content-Type', 'application/json');
    if (csrf) headers.set('X-CSRF-Token', csrf);
    const response = await fetch(`/api/v1/auth/${path}`, {
      method: body ? 'POST' : 'GET',
      credentials: 'include',
      headers,
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: controller.signal,
    });
    signal?.throwIfAborted();
    const payload: unknown =
      response.status === 204 ? undefined : await response.json().catch(() => undefined);
    signal?.throwIfAborted();
    controller.signal.throwIfAborted();
    if (!response.ok) {
      const detail =
        typeof payload === 'object' && payload !== null && 'detail' in payload
          ? payload.detail
          : undefined;
      const message =
        response.status === 429
          ? 'Trop de tentatives. Patientez quelques minutes avant de réessayer.'
          : typeof detail === 'string'
            ? detail
            : response.status === 422
              ? 'Vérifiez les informations saisies, puis réessayez.'
              : 'Le serveur ne peut pas traiter cette demande pour le moment. Réessayez.';
      throw new ApiError(message, response.status);
    }
    return payload as T;
  } catch (error) {
    if (signal?.aborted) throw error;
    if (error instanceof ApiError) throw error;
    throw new ApiError(
      timedOut
        ? 'Le serveur met trop de temps à répondre. Réessayez.'
        : 'Impossible de joindre le serveur. Vérifiez votre connexion et réessayez.',
      0,
    );
  } finally {
    window.clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

function parseAccount(value: unknown): Account {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('id' in value) ||
    typeof value.id !== 'string' ||
    !('first_name' in value) ||
    typeof value.first_name !== 'string' ||
    !('active' in value) ||
    typeof value.active !== 'boolean' ||
    !('roles' in value) ||
    !Array.isArray(value.roles) ||
    !value.roles.every((role: unknown) => role === 'member' || role === 'coach' || role === 'admin')
  ) {
    throw new ApiError('La réponse du serveur est invalide. Réessayez.', 0);
  }
  return value as Account;
}

export const authApi = {
  me: async (signal?: AbortSignal) => parseAccount(await request<unknown>('me', undefined, signal)),
  login: async (username: string, password: string, signal?: AbortSignal): Promise<LoginResult> => {
    const value = await request<LoginResult>('login', { username, password }, signal);
    const user = parseAccount(value?.user);
    if (!value || typeof value.csrf_token !== 'string' || !value.csrf_token)
      throw new ApiError('La réponse du serveur est invalide. Réessayez.', 0);
    return { user, csrf_token: value.csrf_token };
  },
  logout: (csrf: string, signal?: AbortSignal) => request<void>('logout', {}, signal, csrf),
  resetPassword: (token: string, password: string, signal?: AbortSignal) =>
    request<Status>('reset-password', { token, password }, signal),
  activate: (token: string, username: string, password: string, signal?: AbortSignal) =>
    request<Status>('activate', { token, username, password }, signal),
};
