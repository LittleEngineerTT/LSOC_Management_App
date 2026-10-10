import { afterEach, expect, it, vi } from 'vitest';
import { createAdminApi } from './api';
afterEach(() => vi.unstubAllGlobals());
it('parcourt toutes les pages pour ne pas cacher les utilisateurs après le 500e', async () => {
  const first = Array.from({ length: 500 }, (_, id) => ({ id }));
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(new Response(JSON.stringify(first)))
    .mockResolvedValueOnce(new Response(JSON.stringify([{ id: 500 }])));
  vi.stubGlobal('fetch', fetchMock);
  const api = createAdminApi(
    () => 'csrf',
    () => undefined,
  );
  expect(await api.list('/users', true)).toHaveLength(501);
  expect(fetchMock).toHaveBeenLastCalledWith(
    '/api/v1/users?limit=500&offset=500',
    expect.objectContaining({ credentials: 'include' }),
  );
});
it('ne transmet pas de mutation sans CSRF', async () => {
  const fetchMock = vi.fn<typeof fetch>();
  vi.stubGlobal('fetch', fetchMock);
  const api = createAdminApi(
    () => undefined,
    () => undefined,
  );
  await expect(api.request('/sections', 'POST', { name: 'Loisir' })).rejects.toThrow(
    'jeton de session',
  );
  expect(fetchMock).not.toHaveBeenCalled();
});
it('ignore une lecture JSON qui termine après l’annulation', async () => {
  let resolveBody: (value: unknown) => void = () => undefined;
  const body = new Promise<unknown>((resolve) => {
    resolveBody = resolve;
  });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 401, ok: false, json: () => body }));
  const expired = vi.fn();
  const signal = new AbortController();
  const result = createAdminApi(() => 'csrf', expired).request(
    '/sections',
    'GET',
    undefined,
    signal.signal,
  );
  await Promise.resolve();
  signal.abort();
  resolveBody({ detail: 'Connexion requise' });
  await expect(result).rejects.toThrow();
  expect(expired).not.toHaveBeenCalled();
});
