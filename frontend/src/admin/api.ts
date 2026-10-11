import { ApiError } from '../api/auth';

export class AdminError extends ApiError {
  constructor(
    message: string,
    status: number,
    public readonly detail: unknown,
  ) {
    super(message, status);
  }
}
function errorMessage(status: number, detail: unknown): string {
  if (typeof detail === 'string') return detail;
  if (typeof detail === 'object' && detail !== null && 'code' in detail) {
    if (detail.code === 'stale_version')
      return 'Cet événement a été modifié entre-temps. Rechargez-le avant de réexaminer votre modification.';
    if (detail.code === 'capacity_exceeded')
      return 'La capacité du gymnase serait dépassée. Vérifiez les disponibilités ou confirmez explicitement le forçage.';
    if (detail.code === 'registration_full')
      return 'La séance est complète : la limite d’inscrits est atteinte.';
    if (detail.code === 'no_courts' && 'message' in detail) return String(detail.message);
    if (detail.code === 'registration_closed' && 'message' in detail)
      return `Inscriptions fermées : ${String(detail.message).toLowerCase()}.`;
  }
  if (status === 401) return 'Votre session a expiré. Connectez-vous à nouveau.';
  if (status === 403) return 'Action refusée. Vérifiez vos droits ou rechargez votre session.';
  if (status === 404) return 'Cette ressource n’existe plus. Rechargez la liste.';
  if (status === 409)
    return 'Cette opération est incompatible avec les données actuelles. Rechargez la liste.';
  if (status === 422)
    return 'Vérifiez les informations saisies et les relations entre les éléments.';
  return 'Le serveur ne peut pas traiter cette demande. Réessayez.';
}

export function createAdminApi(csrfToken: () => string | undefined, expired: () => void) {
  async function request<T>(
    path: string,
    method = 'GET',
    body?: object,
    signal?: AbortSignal,
  ): Promise<T> {
    const csrf = method === 'GET' ? undefined : csrfToken();
    if (method !== 'GET' && !csrf)
      throw new AdminError('Le jeton de session est manquant. Rechargez la page.', 403, null);
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) controller.abort();
    let timedOut = false;
    // A manual FFVB synchronization may involve several remote requests.
    const timer = window.setTimeout(
      () => {
        timedOut = true;
        controller.abort();
      },
      path.endsWith('/sync') || path.endsWith('/preview') ? 90_000 : 20_000,
    );
    try {
      const headers = new Headers({ Accept: 'application/json' });
      if (body) headers.set('Content-Type', 'application/json');
      if (csrf) headers.set('X-CSRF-Token', csrf);
      const response = await fetch(`/api/v1${path}`, {
        method,
        credentials: 'include',
        headers,
        signal: controller.signal,
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      signal?.throwIfAborted();
      const payload: unknown =
        response.status === 204 ? undefined : await response.json().catch(() => undefined);
      signal?.throwIfAborted();
      controller.signal.throwIfAborted();
      if (!response.ok) {
        if (response.status === 401) expired();
        const detail =
          typeof payload === 'object' && payload !== null && 'detail' in payload
            ? payload.detail
            : undefined;
        throw new AdminError(errorMessage(response.status, detail), response.status, detail);
      }
      if (response.status !== 204 && payload === undefined)
        throw new AdminError('La réponse du serveur est invalide. Rechargez la liste.', 0, null);
      return payload as T;
    } catch (error) {
      if (signal?.aborted || error instanceof ApiError) throw error;
      throw new AdminError(
        timedOut
          ? 'Le serveur met trop de temps à répondre. Vérifiez la liste avant de réessayer une création.'
          : 'Impossible de joindre le serveur. Vérifiez votre connexion.',
        0,
        null,
      );
    } finally {
      window.clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    }
  }
  async function list<T>(path: string, paginated: boolean, signal?: AbortSignal): Promise<T[]> {
    if (!paginated) {
      const values = await request<T[]>(path, 'GET', undefined, signal);
      if (!Array.isArray(values)) throw new AdminError('La liste reçue est invalide.', 0, null);
      return values;
    }
    const result: T[] = [];
    for (let offset = 0; ; offset += 500) {
      const page = await request<T[]>(
        `${path}${path.includes('?') ? '&' : '?'}limit=500&offset=${offset}`,
        'GET',
        undefined,
        signal,
      );
      if (!Array.isArray(page)) throw new AdminError('La liste reçue est invalide.', 0, null);
      result.push(...page);
      if (page.length < 500) return result;
    }
  }
  return { request, list };
}
export type AdminApi = ReturnType<typeof createAdminApi>;
