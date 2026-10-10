import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Link, MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { authApi } from '../api/auth';
import { AuthApp } from './AuthApp';

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

it('annule aussi quand la réponse JSON arrive après le départ de la page', async () => {
  let complete: ((value: unknown) => void) | undefined;
  const response = new Response('{}', { status: 200 });
  const read = vi.fn(() => new Promise<unknown>((resolve) => { complete = resolve; }));
  Object.defineProperty(response, 'json', { value: read });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));
  const controller = new AbortController();
  const pending = authApi.resetPassword('valid-token-with-at-least-twenty-characters', 'nouveau-password-123', controller.signal);
  await vi.waitFor(() => expect(read).toHaveBeenCalled());
  controller.abort();
  complete?.({ message: 'Compte activé' });
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
});

it('un timeout pendant la lecture du corps ne devient pas un succès', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('fetch', vi.fn(async (_input: unknown, init: RequestInit) => {
    const response = new Response('{}', { status: 200 });
    Object.defineProperty(response, 'json', { value: () => new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    }) });
    return response;
  }));
  const result = authApi.resetPassword('valid-token-with-at-least-twenty-characters', 'nouveau-password-123');
  const assertion = expect(result).rejects.toThrow('Le serveur met trop de temps à répondre. Réessayez.');
  await vi.advanceTimersByTimeAsync(15_000);
  await assertion;
});

it('un nouveau jeton sur la même page efface le formulaire et remplace l’ancien', async () => {
  const oldToken = 'old-token-with-at-least-twenty-characters';
  const nextToken = 'new-token-with-at-least-twenty-characters';
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: 'Mot de passe modifié' }), { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
  render(<MemoryRouter initialEntries={[`/reset-password?token=${oldToken}`]}>
    <Link to={`/reset-password?token=${nextToken}`}>Ouvrir le nouveau lien</Link><AuthApp />
  </MemoryRouter>);
  await userEvent.type(screen.getByLabelText('Nouveau mot de passe'), 'premier-password-123');
  await userEvent.click(screen.getByRole('link', { name: 'Ouvrir le nouveau lien' }));
  expect(screen.getByLabelText('Nouveau mot de passe')).toHaveValue('');
  await userEvent.type(screen.getByLabelText('Nouveau mot de passe'), 'nouveau-password-123');
  await userEvent.type(screen.getByLabelText('Confirmer le mot de passe'), 'nouveau-password-123');
  await userEvent.click(screen.getByRole('button', { name: 'Enregistrer le mot de passe' }));
  await screen.findByRole('heading', { name: 'Votre mot de passe est modifié.' });
  expect(fetchMock).toHaveBeenCalledWith('/api/v1/auth/reset-password', expect.objectContaining({ body: JSON.stringify({ token: nextToken, password: 'nouveau-password-123' }) }));
});
