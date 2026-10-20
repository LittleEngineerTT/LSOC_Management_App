import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { AuthApp } from '../auth/AuthApp';

const admin = { id: 'a', username: 'admin', first_name: 'Admin', last_initial: '', category: 'adult', active: true, roles: ['admin'], email: null, messaging_allowed: true, followed_email: true, referent_email: true, admin_email: true };
const bob = { ...admin, id: 'b', username: 'bob', first_name: 'Bob', last_initial: 'M', sex: 'M', roles: ['member'] };
const ana = { ...admin, id: 'n', username: 'ana', first_name: 'Ana', last_initial: '', roles: ['member'] };
const cleo = { ...admin, id: 'c', username: 'cleo', first_name: 'Cléo', last_initial: '', roles: ['member'] };
let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;
function reply(value: unknown, status = 200) { return new Response(status === 204 ? null : JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } }); }
const mutations = () => fetchMock.mock.calls.filter(([, init]) => init?.method && init.method !== 'GET').map(([input, init]) => [new URL(String(input), 'http://localhost').pathname.replace('/api/v1', ''), init?.method, init?.body ? JSON.parse(String(init.body)) : null]);
const assignments = [
  { id: 'as1', user_id: 'b', team_id: 't1', kind: 'player', number: 7, position_id: 'p1' },
  { id: 'as2', user_id: 'n', team_id: 't1', kind: 'player', number: 3, position_id: null },
  { id: 'as3', user_id: 'c', team_id: 't1', kind: 'player', number: 1, position_id: 'p2' },
  { id: 'as4', user_id: 'b', team_id: 't1', kind: 'coach', number: null, position_id: null },
];

beforeAll(() => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value() { this.setAttribute('open', ''); } });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value() { this.removeAttribute('open'); } });
});
afterAll(() => { Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal'); Reflect.deleteProperty(HTMLDialogElement.prototype, 'close'); });
beforeEach(() => {
  document.cookie = 'lsoc_csrf=csrf; path=/';
  fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
    const path = new URL(String(input), 'http://localhost').pathname.replace('/api/v1', '');
    if (init?.method === 'DELETE') return reply(null, 204);
    if (init?.method === 'POST' || init?.method === 'PUT') return reply({ id: 'new', ...JSON.parse(String(init.body)) });
    if (path === '/auth/me') return reply(admin);
    if (path === '/users') return reply([admin, bob, ana, cleo]);
    if (path === '/sections') return reply([{ id: 's1', name: 'Compétition' }]);
    if (path === '/teams') return reply([{ id: 't1', name: 'Régionale', section_id: 's1', referent_ids: ['a'] }]);
    if (path === '/positions') return reply([{ id: 'p1', name: 'Passeur' }, { id: 'p2', name: 'Libéro' }]);
    if (path === '/assignments') return reply(assignments);
    if (path === '/users/b/assignments') return reply([assignments[0]]);
    return reply([]);
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { vi.unstubAllGlobals(); document.cookie = 'lsoc_csrf=; Max-Age=0; path=/'; });

function open(tab: string) { render(<MemoryRouter initialEntries={[`/app/administration?tab=${tab}`]}><AuthApp /></MemoryRouter>); }

it('affiche l’effectif de chaque équipe par poste, puis les joueurs sans poste', async () => {
  open('sections');
  const roster = await screen.findByLabelText('Joueurs de Régionale');
  expect([...roster.querySelectorAll('h5')].map((item) => item.textContent)).toEqual(['Passeur', 'Libéro', 'Sans poste']);
  const players = (name: string) => within(screen.getByRole('list', { name })).getAllByRole('listitem').map((item) => item.textContent);
  expect(players('Passeur de Régionale')).toEqual(['Bob M. · n° 7']);
  expect(players('Libéro de Régionale')).toEqual(['Cléo · n° 1']);
  expect(players('Sans poste de Régionale')).toEqual(['Ana · n° 3']);
});

it('définit les postes dans l’administration', async () => {
  open('positions');
  expect(await screen.findByRole('heading', { name: 'Postes des joueurs' })).toBeInTheDocument();
  expect(screen.getByText('Libéro', { selector: 'h3' })).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Ajouter un poste' }));
  await userEvent.type(screen.getByLabelText('Nom'), 'Pointu');
  await userEvent.click(screen.getByRole('button', { name: 'Créer' }));
  await waitFor(() => expect(mutations()).toEqual([['/positions', 'POST', { name: 'Pointu' }]]));
});

it('attribue un numéro et un poste à un joueur', async () => {
  open('users');
  await userEvent.click(await screen.findByRole('button', { name: 'Gérer Bob' }));
  expect(await screen.findByText('Régionale · Joueur · n° 7 · Passeur')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Numéro et poste dans Régionale' }));
  expect(screen.getByLabelText('Numéro de maillot')).toHaveValue(7);
  await userEvent.clear(screen.getByLabelText('Numéro de maillot'));
  await userEvent.type(screen.getByLabelText('Numéro de maillot'), '12');
  await userEvent.selectOptions(screen.getByLabelText('Poste'), 'p2');
  await userEvent.click(within(screen.getByLabelText('Poste').closest('form') as HTMLElement).getByRole('button', { name: 'Enregistrer' }));
  await waitFor(() => expect(mutations()).toEqual([['/users/b/assignments/as1', 'PUT', { number: 12, position_id: 'p2' }]]));
});

it('renseigne facultativement le sexe d’un compte', async () => {
  open('users');
  const row = (await screen.findByText('Bob M.', { selector: 'h3' })).closest('article') as HTMLElement;
  expect(within(row).getByText(/Sénior · M · Adhérent/)).toBeInTheDocument();
  await userEvent.click(within(row).getByRole('button', { name: 'Gérer Bob' }));
  expect(screen.getByLabelText('Sexe')).toHaveValue('M');
  await userEvent.selectOptions(screen.getByLabelText('Sexe'), '');
  await userEvent.click(within(screen.getByLabelText('Sexe').closest('form') as HTMLElement).getByRole('button', { name: 'Enregistrer' }));
  await waitFor(() => expect(mutations()).toEqual([['/users/b', 'PUT', { first_name: 'Bob', category: 'adult', sex: null, roles: ['member'], messaging_allowed: true }]]));
});
