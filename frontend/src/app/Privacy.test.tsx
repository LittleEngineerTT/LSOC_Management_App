import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { AuthApp } from '../auth/AuthApp';

const account = { id: 'm1', username: 'camille', first_name: 'Camille', category: 'adult', roles: ['member'], active: true, email: null, messaging_allowed: true, followed_email: true, referent_email: true, admin_email: false };
const json = (body: unknown, status = 200) => new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

beforeAll(() => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value() { this.setAttribute('open', ''); } });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value() { this.removeAttribute('open'); } });
});
afterAll(() => { Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal'); Reflect.deleteProperty(HTMLDialogElement.prototype, 'close'); });
afterEach(() => { vi.unstubAllGlobals(); document.cookie = 'lsoc_csrf=; Max-Age=0; path=/'; });

function open(path: string, signedIn = true) {
  document.cookie = 'lsoc_csrf=csrf; path=/';
  const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
    const path = new URL(String(input), 'http://localhost').pathname.replace('/api/v1', '');
    if (path === '/auth/me') return signedIn ? json(account) : json({ detail: 'Connexion requise' }, 401);
    if (path === '/me/export') return json({ compte: { id: 'm1' } });
    if (path === '/me/delete') return JSON.parse(String(init?.body)).password === 'secret' ? json(null, 204) : json({ detail: 'Mot de passe incorrect' }, 403);
    if (path === '/me/password') return JSON.parse(String(init?.body)).current_password === 'secret' ? json(null, 204) : json({ detail: 'Mot de passe actuel incorrect' }, 403);
    if (path === '/me/sessions/revoke') return json(null, 204);
    if (path === '/licenses/me') return json({ status: 'none' });
    return json([]);
  });
  vi.stubGlobal('fetch', fetchMock);
  render(<MemoryRouter initialEntries={[path]}><AuthApp /></MemoryRouter>);
  return fetchMock;
}

it('publie la politique de confidentialité sans connexion, liée depuis la page de connexion', async () => {
  open('/login', false);
  await userEvent.click(await screen.findByRole('link', { name: 'Confidentialité et données personnelles' }));
  expect(await screen.findByRole('heading', { name: 'Politique de confidentialité' })).toBeInTheDocument();
  expect(screen.getByText(/effacé automatiquement après 2 ans sans connexion/)).toBeInTheDocument();
  expect(screen.getByText(/repart de zéro chaque 1er août/)).toBeInTheDocument();
});

it('exporte ses données et supprime son compte après confirmation par mot de passe', async () => {
  const createObjectURL = vi.fn(() => 'blob:x');
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() }));
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
  const fetchMock = open('/app/profil');
  await userEvent.click(await screen.findByRole('button', { name: 'Télécharger mes données' }));
  await waitFor(() => expect(click).toHaveBeenCalled());
  expect(createObjectURL).toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: 'Supprimer mon compte' }));
  const dialog = screen.getByRole('dialog', { name: 'Supprimer définitivement votre compte ?' });
  await userEvent.type(within(dialog).getByLabelText('Mot de passe'), 'faux');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Supprimer mon compte' }));
  expect(await within(dialog).findByText('Mot de passe incorrect')).toBeInTheDocument();
  await userEvent.clear(within(dialog).getByLabelText('Mot de passe'));
  await userEvent.type(within(dialog).getByLabelText('Mot de passe'), 'secret');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Supprimer mon compte' }));
  expect(await screen.findByRole('button', { name: 'Continuer en tant qu’invité' })).toBeInTheDocument();
  expect(fetchMock.mock.calls.some(([input, init]) => String(input).endsWith('/me/delete') && init?.method === 'POST')).toBe(true);
  click.mockRestore();
});

it('change son mot de passe et déconnecte ses autres appareils', async () => {
  const fetchMock = open('/app/profil');
  const card = within(await screen.findByRole('region', { name: 'Sécurité du compte' }));
  await userEvent.type(card.getByLabelText('Mot de passe actuel'), 'wrong');
  await userEvent.type(card.getByLabelText(/^Nouveau mot de passe/), 'nouveau-mot-de-passe');
  await userEvent.type(card.getByLabelText('Confirmer le nouveau mot de passe'), 'autre-mot-de-passe');
  await userEvent.click(card.getByRole('button', { name: 'Changer le mot de passe' }));
  expect(card.getByText('Les deux nouveaux mots de passe ne correspondent pas.')).toBeInTheDocument();
  await userEvent.clear(card.getByLabelText('Confirmer le nouveau mot de passe'));
  await userEvent.type(card.getByLabelText('Confirmer le nouveau mot de passe'), 'nouveau-mot-de-passe');
  await userEvent.click(card.getByRole('button', { name: 'Changer le mot de passe' }));
  expect(await card.findByText('Mot de passe actuel incorrect')).toBeInTheDocument();
  await userEvent.clear(card.getByLabelText('Mot de passe actuel'));
  await userEvent.type(card.getByLabelText('Mot de passe actuel'), 'secret');
  await userEvent.click(card.getByRole('button', { name: 'Changer le mot de passe' }));
  expect(await card.findByText(/Mot de passe modifié/)).toBeInTheDocument();
  const call = fetchMock.mock.calls.filter(([input]) => String(input).endsWith('/me/password')).pop();
  expect(JSON.parse(String(call?.[1]?.body))).toEqual({ current_password: 'secret', new_password: 'nouveau-mot-de-passe' });
  await userEvent.click(card.getByRole('button', { name: 'Déconnecter mes autres appareils' }));
  expect(await card.findByText('Vos autres appareils ont été déconnectés.')).toBeInTheDocument();
});
