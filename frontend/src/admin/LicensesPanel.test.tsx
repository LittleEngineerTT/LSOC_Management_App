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
    if (path === '/teams') return reply([{ id: 't1', name: 'Loisir 1', section_id: 's1', referent_ids: [] }, { id: 't2', name: 'Régionale', section_id: 's2', referent_ids: [] }]);
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
  // Un clic sur l’adhérent ouvre sa fiche à la place de sa ligne.
  await userEvent.click(await screen.findByRole('button', { name: 'Alice' }));
  const card = screen.getByRole('region', { name: 'Licences de Alice' });
  expect(within(card).getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Licence joueur']);
  await userEvent.selectOptions(within(card).getByLabelText('Statut'), 'active');
  await userEvent.click(within(card).getByRole('button', { name: 'Enregistrer' }));
  expect(await screen.findByText('Licence de Alice : Active.')).toBeInTheDocument();
  const call = fetchMock.mock.calls.find(([input, init]) => String(input).endsWith('/licenses/m') && init?.method === 'PUT');
  expect(JSON.parse(String(call?.[1]?.body))).toEqual({ number: 'A-1', status: 'active' });
});

it('propose directement le statut actif, même sans étape préalable', async () => {
  open('/app/administration?tab=licenses');
  await userEvent.click(await screen.findByRole('button', { name: 'Carla' }));
  const card = screen.getByRole('region', { name: 'Licences de Carla' });
  // Un onglet par licence : Carla est aussi coach.
  expect(within(card).getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Licence joueur', 'Licence coach']);
  expect(within(card).getByRole('tab', { name: 'Licence joueur' })).toHaveAttribute('aria-selected', 'true');
  const options = within(within(card).getByLabelText('Statut')).getAllByRole('option').map((option) => option.textContent);
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

it('gère la licence coach sans étape de paiement, avec son propre numéro', async () => {
  open('/app/administration?tab=licenses');
  await screen.findByText('Loisir 1 (joueur)');
  await userEvent.click(screen.getByRole('button', { name: 'Coachs' }));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/v1/licenses?kind=coach', expect.anything()));
  const carla = (await screen.findByRole('heading', { name: /Carla/ })).closest('article')!;
  expect(within(carla).getByText('En cours')).toBeInTheDocument();
  // Le filtre Coachs ouvre la fiche sur l’onglet de la licence coach.
  await userEvent.click(within(carla).getByRole('button', { name: 'Carla' }));
  const card = screen.getByRole('region', { name: 'Licences de Carla' });
  expect(within(card).getByRole('tab', { name: 'Licence coach' })).toHaveAttribute('aria-selected', 'true');
  const options = within(within(card).getByLabelText('Statut')).getAllByRole('option').map((option) => option.textContent);
  expect(options).toEqual(['Pas de licence', 'En cours', 'Active']);
  await userEvent.type(within(card).getByLabelText('Numéro de licence'), 'C-1');
  await userEvent.selectOptions(within(card).getByLabelText('Statut'), 'active');
  await userEvent.click(within(card).getByRole('button', { name: 'Enregistrer' }));
  await screen.findByText('Licence de Carla : Active.');
  const call = fetchMock.mock.calls.find(([input, init]) => String(input).endsWith('/licenses/c') && init?.method === 'PUT');
  // La licence coach a son numéro ; Carla n’a pas de numéro joueur.
  expect(JSON.parse(String(call?.[1]?.body))).toEqual({ number: null, coach_number: 'C-1', coach_status: 'active' });
});

it('un coach voit les statuts de ses deux licences dans son profil', async () => {
  account = member;
  open('/app/profil');
  const card = (await screen.findByRole('heading', { name: 'Ma licence' })).closest('section')!;
  expect(await within(card).findByText(/Licence coach/)).toBeInTheDocument();
  expect(within(card).getByText('Active')).toBeInTheDocument();
});
