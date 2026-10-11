import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeAll, afterAll, beforeEach, afterEach, expect, it, vi } from 'vitest';
import { AuthApp } from '../auth/AuthApp';

const admin = { id: 'admin-1', first_name: 'Admin', category: 'adult', roles: ['admin'], active: true, email: 'admin@example.org', messaging_allowed: true };
const invited = { id: 'new-1', first_name: 'Alex', category: 'adult', roles: ['member'], active: false, messaging_allowed: true };
let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;
let users: unknown[];
let gyms: unknown[];
let mutation: (path: string, init?: RequestInit) => Response;
function reply(body: unknown, status = 200) { return new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }); }
function open(tab = 'users') { render(<MemoryRouter initialEntries={[`/app/administration?tab=${tab}`]}><AuthApp /></MemoryRouter>); }
beforeAll(() => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value() { this.setAttribute('open', ''); } });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value() { this.removeAttribute('open'); } });
});
afterAll(() => { Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal'); Reflect.deleteProperty(HTMLDialogElement.prototype, 'close'); });
beforeEach(() => {
  users = [admin]; gyms = []; mutation = () => reply({}, 200);
  document.cookie = 'lsoc_csrf=admin-csrf; path=/';
  fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
    const path = new URL(String(input), 'http://localhost').pathname;
    if (init?.method && init.method !== 'GET') return mutation(path, init);
    if (path.endsWith('/auth/me')) return reply(admin);
    if (path.endsWith('/users')) return reply(users);
    if (path.endsWith('/gymnasiums')) return reply(gyms);
    if (path.endsWith('/ffvb/defaults')) return reply({ before_minutes: 75, after_minutes: 150, courts: 3 });
    return reply([]);
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { vi.unstubAllGlobals(); document.cookie = 'lsoc_csrf=; Max-Age=0; path=/'; });

it('crée un compte et présente son lien, sans stocker de secret', async () => {
  mutation = (path, init) => {
    expect(path).toBe('/api/v1/users');
    expect(new Headers(init?.headers).get('X-CSRF-Token')).toBe('admin-csrf');
    expect(JSON.parse(String(init?.body))).toEqual({ first_name: 'Alex', last_name: 'Durand', category: 'adult', roles: ['member'], messaging_allowed: true });
    users = [admin, invited];
    return reply({ user: invited, invitation_url: 'http://localhost:5173/activate?token=secret-invitation', invitation_token: 'secret-invitation' }, 201);
  };
  open();
  await userEvent.click(await screen.findByRole('button', { name: 'Ajouter un utilisateur' }));
  await userEvent.type(screen.getByLabelText('Prénom'), 'Alex');
  await userEvent.type(screen.getByLabelText('Nom'), 'Durand');
  await userEvent.click(screen.getByRole('button', { name: 'Créer et inviter' }));
  expect(await screen.findByLabelText('Lien d’invitation')).toHaveValue('http://localhost:5173/activate?token=secret-invitation');
  expect(localStorage.length).toBe(0); expect(sessionStorage.length).toBe(0);
});

it('affiche le refus de supprimer un gymnase utilisé et conserve le gymnase', async () => {
  gyms = [{ id: 'gym-1', name: 'Paré', capacity: 3 }];
  mutation = () => reply({ detail: 'Gymnase utilisé par des événements' }, 409);
  open('gymnasiums');
  await userEvent.click(await screen.findByRole('button', { name: 'Supprimer Paré' }));
  await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Confirmer la suppression' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Gymnase utilisé');
  expect(screen.getByText('Paré')).toBeInTheDocument();
});

it('revient à la connexion si la session expire pendant une création', async () => {
  mutation = () => reply({ detail: 'Connexion requise' }, 401);
  open('sections');
  await userEvent.click(await screen.findByRole('button', { name: 'Ajouter une section' }));
  await userEvent.type(screen.getByLabelText('Nom'), 'Loisir');
  await userEvent.click(screen.getByRole('button', { name: 'Créer' }));
  expect(await screen.findByRole('button', { name: 'Se connecter' })).toBeInTheDocument();
});

it('expose une invitation régénérée puis la retire lors de sa révocation', async () => {
  users = [admin, invited];
  mutation = (_path, init) => init?.method === 'DELETE' ? reply(null, 204) : reply({ user: invited, invitation_url: 'http://localhost:5173/activate?token=renewed', invitation_token: 'renewed' });
  open();
  await userEvent.click(await screen.findByRole('button', { name: 'Gérer Alex' }));
  await userEvent.click(screen.getByRole('button', { name: 'Régénérer l’invitation' }));
  await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Confirmer' }));
  expect(await screen.findByLabelText('Lien d’invitation')).toHaveValue('http://localhost:5173/activate?token=renewed');
  await userEvent.click(screen.getByRole('button', { name: 'Révoquer l’invitation' }));
  await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Confirmer' }));
  await waitFor(() => expect(screen.queryByLabelText('Lien d’invitation')).not.toBeInTheDocument());
});

it('relance un e-mail non livré sur action explicite', async () => {
  fetchMock.mockImplementation(async (input, init) => {
    const path = new URL(String(input), 'http://localhost').pathname;
    if (init?.method === 'POST') return reply({ id: 'job-1', user_id: admin.id, attempts: 0, due_at: '2026-10-10T10:00:00Z', sent_at: null });
    if (path.endsWith('/auth/me')) return reply(admin);
    if (path.endsWith('/admin/email-jobs')) return reply([{ id: 'job-1', user_id: admin.id, attempts: 8, due_at: '2026-10-10T10:00:00Z', sent_at: null }]);
    return reply(path.endsWith('/users') ? [admin] : []);
  });
  open('emails');
  await userEvent.click(await screen.findByRole('button', { name: 'Relancer l’envoi' }));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/v1/admin/email-jobs/job-1/retry', expect.objectContaining({ method: 'POST' })));
  expect(await screen.findByRole('status')).toHaveTextContent('relancé');
});
