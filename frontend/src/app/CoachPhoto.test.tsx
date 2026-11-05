import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { AuthApp } from '../auth/AuthApp';

const coach = { id: 'c1', username: 'alice', first_name: 'Alice', category: 'adult', roles: ['member', 'coach'], active: true, email: null, messaging_allowed: true, followed_email: true, referent_email: true, admin_email: false, photo_url: null as string | null };
const admin = { ...coach, id: 'admin-1', username: 'admin', first_name: 'Admin', roles: ['admin'] };
const json = (body: unknown, status = 200) => new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const image = (type = 'image/jpeg', name = 'alice.jpg') => new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], name, { type });

let account: typeof coach;
let calls: { path: string; method: string; body: unknown; type: string | null }[];

beforeAll(() => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value() { this.setAttribute('open', ''); } });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value() { this.removeAttribute('open'); } });
});
afterAll(() => { Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal'); Reflect.deleteProperty(HTMLDialogElement.prototype, 'close'); });
beforeEach(() => { account = { ...coach }; calls = []; });
afterEach(() => { vi.unstubAllGlobals(); document.cookie = 'lsoc_csrf=; Max-Age=0; path=/'; });

function open(path: string) {
  document.cookie = 'lsoc_csrf=csrf; path=/';
  vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
    const path = new URL(String(input), 'http://localhost').pathname.replace('/api/v1', '');
    const method = init?.method ?? 'GET';
    if (method !== 'GET') calls.push({ path, method, body: init?.body, type: new Headers(init?.headers).get('Content-Type') });
    if (path === '/auth/me') return json(account);
    if (path === '/licenses/me') return json({ status: 'none' });
    if (path === '/me/photo' && method === 'PUT') return json({ ...account, photo_url: 'https://s3.example/photos/abc' });
    if (path === '/me/photo' && method === 'DELETE') return json({ ...account, photo_url: null });
    if (path === '/users' && method === 'POST') {
      const user = { id: 'a-alice', first_name: 'Alice', category: 'adult', roles: JSON.parse(String(init?.body)).roles, active: false, messaging_allowed: true };
      return json({ user, invitation_url: 'http://localhost:5173/activate?token=t', invitation_token: 't' }, 201);
    }
    if (path === '/users/a-alice/photo') return json({ id: 'a-alice', photo_url: 'https://s3.example/photos/new' });
    return json([]);
  }));
  render(<MemoryRouter initialEntries={[path]}><AuthApp /></MemoryRouter>);
}

it('le coach ajoute, remplace et supprime sa photo depuis son profil', async () => {
  open('/app/profil');
  const section = await screen.findByRole('region', { name: 'Ma photo' });
  // Format refusé avant l’envoi.
  await userEvent.upload(within(section).getByLabelText('Ajouter une photo'), image('image/gif', 'alice.gif'), { applyAccept: false });
  expect(within(section).getByRole('alert')).toHaveTextContent('JPEG, PNG ou WebP');
  expect(calls).toEqual([]);
  await userEvent.upload(within(section).getByLabelText('Ajouter une photo'), image());
  expect(await within(section).findByText('Photo enregistrée.')).toBeInTheDocument();
  expect(calls[0]).toMatchObject({ path: '/me/photo', method: 'PUT', type: 'image/jpeg' });
  expect(calls[0]!.body).toBeInstanceOf(File);
  expect(within(section).getByRole('img', { name: 'Aperçu de la photo' })).toHaveAttribute('src', 'https://s3.example/photos/abc');
  expect(within(section).getByLabelText('Remplacer ma photo')).toBeInTheDocument();
  await userEvent.click(within(section).getByRole('button', { name: 'Supprimer ma photo' }));
  await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Supprimer' }));
  expect(await within(section).findByText('Photo supprimée.')).toBeInTheDocument();
  expect(calls[1]).toMatchObject({ path: '/me/photo', method: 'DELETE' });
  expect(within(section).queryByRole('img', { name: 'Aperçu de la photo' })).not.toBeInTheDocument();
});

it('un adhérent sans rôle coach n’a pas de photo dans son profil', async () => {
  account = { ...coach, roles: ['member'] };
  open('/app/profil');
  await screen.findByRole('heading', { name: 'Ma licence' });
  expect(screen.queryByRole('region', { name: 'Ma photo' })).not.toBeInTheDocument();
});

it('l’administrateur ajoute une photo facultative à la création d’un coach seulement', async () => {
  account = admin;
  open('/app/administration?tab=users');
  await userEvent.click(await screen.findByRole('button', { name: 'Ajouter un utilisateur' }));
  expect(screen.queryByText('Photo de l’entraîneur')).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('checkbox', { name: 'Coach' }));
  expect(screen.getByText('Photo de l’entraîneur')).toBeInTheDocument();
  await userEvent.upload(screen.getByLabelText('Choisir une photo'), image());
  expect(screen.getByText(/Photo choisie : alice\.jpg/)).toBeInTheDocument();
  await userEvent.type(screen.getByLabelText('Prénom'), 'Alice');
  await userEvent.type(screen.getByLabelText('Nom'), 'Durand');
  await userEvent.click(screen.getByRole('button', { name: 'Créer et inviter' }));
  await waitFor(() => expect(calls.map((call) => call.path)).toEqual(['/users', '/users/a-alice/photo']));
  expect(calls[1]).toMatchObject({ method: 'PUT', type: 'image/jpeg' });
  expect(await screen.findByText(/Compte créé/)).toBeInTheDocument();
});

it('sans le rôle coach, la photo choisie n’est pas envoyée', async () => {
  account = admin;
  open('/app/administration?tab=users');
  await userEvent.click(await screen.findByRole('button', { name: 'Ajouter un utilisateur' }));
  await userEvent.click(screen.getByRole('checkbox', { name: 'Coach' }));
  await userEvent.upload(screen.getByLabelText('Choisir une photo'), image());
  await userEvent.click(screen.getByRole('checkbox', { name: 'Coach' }));
  expect(screen.queryByText('Photo de l’entraîneur')).not.toBeInTheDocument();
  await userEvent.type(screen.getByLabelText('Prénom'), 'Alice');
  await userEvent.type(screen.getByLabelText('Nom'), 'Durand');
  await userEvent.click(screen.getByRole('button', { name: 'Créer et inviter' }));
  expect(await screen.findByText(/Compte créé/)).toBeInTheDocument();
  expect(calls.map((call) => call.path)).toEqual(['/users']);
});
