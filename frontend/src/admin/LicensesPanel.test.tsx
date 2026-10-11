import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AuthApp } from '../auth/AuthApp';

const admin = { id: 'a', username: 'admin', first_name: 'Admin', category: 'adult', active: true, roles: ['admin'], email: null, messaging_allowed: true, followed_email: true, referent_email: true, admin_email: true };
const member = { ...admin, id: 'm', username: 'alice', first_name: 'Alice', roles: ['member'] };
let account = admin;
let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;
let licenses: Record<string, unknown>[];
function reply(value: unknown) { return new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } }); }
function open(path: string) { render(<MemoryRouter initialEntries={[path]}><AuthApp /></MemoryRouter>); }
beforeEach(() => {
  account = admin;
  licenses = [
    { user_id: 'm', first_name: 'Alice', username: 'alice', number: 'A-1', status: 'payment_pending', coach_status: 'none', coach: false, updated_at: null, teams: [{ team_id: 't1', kind: 'player' }], missing: true },
    { user_id: 'c', first_name: 'Carla', username: 'carla', number: null, status: 'none', coach_status: 'in_progress', coach: true, updated_at: null, teams: [{ team_id: 't2', kind: 'coach' }], missing: false },
  ];
  document.cookie = 'lsoc_csrf=csrf; path=/';
  fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
    const url = new URL(String(input), 'http://localhost');
    const path = url.pathname.replace('/api/v1', '');
    if (path === '/auth/me') return reply(account);
    if (path === '/sections') return reply([{ id: 's1', name: 'Loisir' }, { id: 's2', name: 'Compétition' }]);
    if (path === '/teams') return reply([{ id: 't1', name: 'Loisir 1', section_id: 's1', referent_id: null }, { id: 't2', name: 'Régionale', section_id: 's2', referent_id: null }]);
    if (path === '/users') return reply([admin]);
    if (path === '/licenses/me') return reply({ status: 'payment_pending', coach_status: 'active', coach: account.id === 'm' });
    if (path === '/licenses/c' && init?.method === 'PUT') return reply(licenses[1]);
    if (path === '/licenses/m' && init?.method === 'PUT') {
      const body = JSON.parse(String(init.body));
      licenses = licenses.map((item) => (item.user_id === 'm' ? { ...item, ...body, missing: body.status !== 'active' } : item));
      return reply(licenses[0]);
    }
    if (path === '/licenses') {
      const rows = url.searchParams.get('kind') === 'coach' ? licenses.filter((item) => item.coach) : licenses;
      return reply(url.searchParams.get('missing') ? rows.filter((item) => item.missing) : rows);
    }
    return reply([]);
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { vi.unstubAllGlobals(); document.cookie = 'lsoc_csrf=; Max-Age=0; path=/'; });

it('liste les licences, filtre les manquantes et active une licence après paiement', async () => {
  open('/app/administration?tab=licenses');
  expect(await screen.findByText('Loisir 1 (joueur)')).toBeInTheDocument();
  expect(document.querySelector('.admin-license-summary')).toHaveTextContent(
    '1 licence manquante · 1 pas de licence · 1 paiement en attente',
  );
  await userEvent.click(screen.getByLabelText('Licences manquantes uniquement'));
  await waitFor(() => expect(screen.queryByText('Régionale (coach)')).not.toBeInTheDocument());
  expect(fetchMock).toHaveBeenCalledWith('/api/v1/licenses?missing=true', expect.anything());
  await userEvent.selectOptions(screen.getByLabelText('Section'), 's2');
  expect(within(screen.getByLabelText('Équipe')).getAllByRole('option').map((option) => option.textContent)).toEqual(['Toutes les équipes', 'Régionale']);
  expect(fetchMock).toHaveBeenCalledWith('/api/v1/licenses?section_id=s2&missing=true', expect.anything());
  await userEvent.selectOptions(screen.getByLabelText('Section'), '');
  await userEvent.click(await screen.findByRole('button', { name: 'Gérer la licence' }));
  await userEvent.selectOptions(screen.getByLabelText('Statut'), 'active');
  await userEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
  expect(await screen.findByText('Licence de Alice : Active.')).toBeInTheDocument();
  const call = fetchMock.mock.calls.find(([input, init]) => String(input).endsWith('/licenses/m') && init?.method === 'PUT');
  expect(JSON.parse(String(call?.[1]?.body))).toEqual({ number: 'A-1', status: 'active' });
});

it('propose directement le statut actif, même sans étape préalable', async () => {
  open('/app/administration?tab=licenses');
  const carla = (await screen.findByRole('heading', { name: /Carla/ })).closest('article')!;
  await userEvent.click(within(carla).getByRole('button', { name: 'Gérer la licence' }));
  const options = within(screen.getByLabelText('Statut')).getAllByRole('option').map((option) => option.textContent);
  // Directive du 11 octobre : « Active » se choisit dès la création.
  expect(options).toContain('Active');
  expect(options).toContain('Paiement en attente');
});

it('l’adhérent voit seulement le statut de sa licence dans son profil', async () => {
  account = member;
  open('/app/profil');
  const card = (await screen.findByRole('heading', { name: 'Ma licence' })).closest('section')!;
  expect(await within(card).findByText('Paiement en attente')).toBeInTheDocument();
  expect(card).not.toHaveTextContent('A-1');
  expect(fetchMock).not.toHaveBeenCalledWith('/api/v1/licenses', expect.anything());
});

it('gère la licence coach sans étape de paiement, avec le numéro commun', async () => {
  open('/app/administration?tab=licenses');
  await screen.findByText('Loisir 1 (joueur)');
  await userEvent.click(screen.getByRole('button', { name: 'Coachs' }));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/v1/licenses?kind=coach', expect.anything()));
  const carla = (await screen.findByRole('heading', { name: /Carla/ })).closest('article')!;
  expect(within(carla).getByText('En cours')).toBeInTheDocument();
  await userEvent.click(within(carla).getByRole('button', { name: 'Gérer la licence' }));
  expect(screen.getByRole('heading', { name: 'Licence coach de Carla' })).toBeInTheDocument();
  const options = within(screen.getByLabelText('Statut')).getAllByRole('option').map((option) => option.textContent);
  expect(options).toEqual(['Choisir…', 'Pas de licence', 'En cours', 'Active']);
  await userEvent.type(screen.getByLabelText('Numéro de licence'), 'C-1');
  await userEvent.selectOptions(screen.getByLabelText('Statut'), 'active');
  await userEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
  await screen.findByText('Licence de Carla : Active.');
  const call = fetchMock.mock.calls.find(([input, init]) => String(input).endsWith('/licenses/c') && init?.method === 'PUT');
  expect(JSON.parse(String(call?.[1]?.body))).toEqual({ number: 'C-1', coach_status: 'active' });
});

it('un coach voit les statuts de ses deux licences dans son profil', async () => {
  account = member;
  open('/app/profil');
  const card = (await screen.findByRole('heading', { name: 'Ma licence' })).closest('section')!;
  expect(await within(card).findByText(/Licence coach/)).toBeInTheDocument();
  expect(within(card).getByText('Active')).toBeInTheDocument();
});
