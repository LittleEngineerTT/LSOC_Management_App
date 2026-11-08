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
    // Comme l’API : la mise à jour d’un compte renvoie le compte, avec son identifiant.
    if (init?.method === 'PUT' && path === '/users/b') return reply({ ...bob, ...JSON.parse(String(init.body)) });
    if (init?.method === 'PUT' && path === '/users/n') return reply({ ...ana, ...JSON.parse(String(init.body)) });
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
  // Le titre du panneau précède le chargement des postes : on attend la liste.
  expect(await screen.findByText('Libéro', { selector: 'h3' })).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Ajouter un poste' }));
  await userEvent.type(screen.getByLabelText('Nom'), 'Pointu');
  await userEvent.click(screen.getByRole('button', { name: 'Créer' }));
  await waitFor(() => expect(mutations()).toEqual([['/positions', 'POST', { name: 'Pointu' }]]));
});

it('attribue un numéro et un poste à un joueur depuis l’onglet de son rattachement', async () => {
  open('users');
  const row = (await screen.findByText('Bob M.', { selector: 'button' })).closest('article') as HTMLElement;
  expect(await within(row).findByText('Régionale · Joueur · n° 7 · Passeur — Régionale · Coach')).toBeInTheDocument();
  await userEvent.click(within(row).getByRole('button', { name: 'Ouvrir la fiche de Bob' }));
  const card = await screen.findByRole('region', { name: 'Fiche de Bob' });
  await userEvent.click(await within(card).findByRole('tab', { name: 'Joueur · Régionale' }));
  expect(within(card).getByLabelText('Numéro de maillot')).toHaveValue(7);
  await userEvent.clear(within(card).getByLabelText('Numéro de maillot'));
  await userEvent.type(within(card).getByLabelText('Numéro de maillot'), '12');
  await userEvent.selectOptions(within(card).getByLabelText('Poste'), 'p2');
  await userEvent.click(within(card).getByRole('button', { name: 'Enregistrer' }));
  await waitFor(() => expect(mutations()).toEqual([
    ['/users/b', 'PUT', { first_name: 'Bob', category: 'adult', sex: 'M', roles: ['member'], messaging_allowed: true }],
    ['/users/b/assignments/as1', 'PUT', { number: 12, position_id: 'p2' }],
  ]));
});

it('ajoute des onglets joueur et un rattachement coach sans onglet, puis les enregistre', async () => {
  open('users');
  await userEvent.click(await screen.findByRole('button', { name: 'Ouvrir la fiche de Ana' }));
  const card = await screen.findByRole('region', { name: 'Fiche de Ana' });
  await within(card).findByRole('tab', { name: 'Informations' });
  // Coach : pas d’onglet, une ligne dans les informations, et le rôle coché d’office.
  await userEvent.click(within(card).getByRole('button', { name: 'Ajouter un rattachement' }));
  await userEvent.click(within(card).getByRole('button', { name: 'Coach' }));
  expect(within(card).getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Informations']);
  expect(within(card).getByRole('checkbox', { name: 'Coach' })).toBeChecked();
  await userEvent.selectOptions(within(card).getByLabelText('Équipe à coacher'), 't1');
  // L’équipe choisie devient un badge, retirable ; plus de liste « Équipe coachée N ».
  const coached = within(card).getByRole('list', { name: 'Équipes coachées' });
  expect(within(coached).getAllByRole('listitem').map((item) => item.firstChild?.textContent)).toEqual(['Régionale']);
  // Retirer le coaching demande confirmation ; « Annuler » le garde.
  await userEvent.click(within(coached).getByRole('button', { name: 'Retirer Régionale' }));
  const dialog = await screen.findByRole('dialog', { name: 'Retirer le coaching de Régionale ?' });
  await userEvent.click(within(dialog).getByRole('button', { name: 'Annuler' }));
  expect(within(coached).getByRole('button', { name: 'Retirer Régionale' })).toBeInTheDocument();
  expect(within(card).queryByLabelText('Équipe à coacher')).not.toBeInTheDocument();
  expect(within(card).queryByText(/Équipe coachée/)).not.toBeInTheDocument();
  // Joueur : un nouvel onglet par rattachement, ouvert d’emblée.
  for (let index = 0; index < 2; index++) {
    await userEvent.click(within(card).getByRole('button', { name: 'Ajouter un rattachement' }));
    await userEvent.click(within(card).getByRole('button', { name: 'Joueur' }));
    await userEvent.selectOptions(within(card).getByLabelText('Équipe'), 't1');
  }
  expect(within(card).getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Informations', 'Joueur · Régionale', 'Joueur · Régionale']);
  expect(within(card).getAllByRole('tab')[2]).toHaveAttribute('aria-selected', 'true');
  // Même équipe deux fois comme joueur : refusé avant tout envoi.
  await userEvent.click(within(card).getByRole('button', { name: 'Enregistrer' }));
  expect(await within(card).findByText('Une même équipe ne peut être choisie qu’une fois par type de rattachement.')).toBeInTheDocument();
  expect(mutations()).toEqual([]);
  await userEvent.click(within(card).getByRole('button', { name: 'Retirer ce rattachement' }));
  expect(within(card).getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Informations', 'Joueur · Régionale']);
  await userEvent.click(within(card).getByRole('tab', { name: 'Joueur · Régionale' }));
  await userEvent.type(within(card).getByLabelText('Numéro de maillot'), '9');
  await userEvent.click(within(card).getByRole('button', { name: 'Enregistrer' }));
  await waitFor(() => expect(mutations()).toEqual([
    ['/users/n', 'PUT', { first_name: 'Ana', category: 'adult', sex: null, roles: ['member', 'coach'], messaging_allowed: true }],
    ['/users/n/assignments', 'POST', { team_id: 't1', kind: 'player', number: 9, position_id: null }],
    ['/users/n/assignments', 'POST', { team_id: 't1', kind: 'coach' }],
  ]));
});

it('renseigne facultativement le sexe d’un compte', async () => {
  open('users');
  const row = (await screen.findByText('Bob M.', { selector: 'button' })).closest('article') as HTMLElement;
  expect(within(row).getByText(/Sénior · M · Adhérent/)).toBeInTheDocument();
  await userEvent.click(within(row).getByRole('button', { name: 'Ouvrir la fiche de Bob' }));
  const card = await screen.findByRole('region', { name: 'Fiche de Bob' });
  expect(within(card).getByLabelText('Sexe')).toHaveValue('M');
  await userEvent.selectOptions(within(card).getByLabelText('Sexe'), '');
  await userEvent.click(await within(card).findByRole('button', { name: 'Enregistrer' }));
  await waitFor(() => expect(mutations()).toEqual([['/users/b', 'PUT', { first_name: 'Bob', category: 'adult', sex: null, roles: ['member'], messaging_allowed: true }]]));
});

it('garde la gestion du compte hors de la fiche : elle s’ouvre par Gérer, à côté de Supprimer', async () => {
  open('users');
  const row = (await screen.findByText('Bob M.', { selector: 'button' })).closest('article') as HTMLElement;
  expect(within(row).getAllByRole('button').map((button) => button.textContent)).toEqual(['Bob M.', 'Gérer', 'Supprimer']);
  await userEvent.click(within(row).getByRole('button', { name: 'Ouvrir la fiche de Bob' }));
  const card = await screen.findByRole('region', { name: 'Fiche de Bob' });
  expect(within(card).queryByText(/Identifiant de connexion|Lien d’invitation|Régénérer/)).not.toBeInTheDocument();
  expect(screen.queryByRole('region', { name: 'Compte de Bob' })).not.toBeInTheDocument();
  await userEvent.click(within(card).getByRole('button', { name: 'Fermer' }));
  await userEvent.click(await screen.findByRole('button', { name: 'Gérer Bob' }));
  expect(await screen.findByRole('region', { name: 'Compte de Bob' })).toBeInTheDocument();
});

it('ouvre la fiche à la place de la ligne du compte, jusqu’à sa fermeture', async () => {
  open('users');
  await userEvent.click(await screen.findByRole('button', { name: 'Ouvrir la fiche de Bob' }));
  const card = await screen.findByRole('region', { name: 'Fiche de Bob' });
  // La ligne de Bob est remplacée par sa fiche, entre les autres comptes.
  expect(screen.queryByRole('button', { name: 'Ouvrir la fiche de Bob' })).not.toBeInTheDocument();
  const list = card.closest('.admin-list') as HTMLElement;
  expect(list).not.toBeNull();
  expect(within(list).getByRole('button', { name: 'Ouvrir la fiche de Ana' })).toBeInTheDocument();
  // Bob n’est pas coach : pas de section « Coach des équipes ».
  expect(within(card).queryByRole('region', { name: 'Rattachements coach' })).not.toBeInTheDocument();
  await userEvent.click(within(card).getByRole('button', { name: 'Fermer' }));
  expect(screen.queryByRole('region', { name: 'Fiche de Bob' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Ouvrir la fiche de Bob' })).toBeInTheDocument();
});

it('confirme le retrait du coaching d’une équipe avant de l’enregistrer', async () => {
  const coach = { ...admin, id: 'k', username: 'kim', first_name: 'Kim', last_initial: '', roles: ['member', 'coach'] };
  fetchMock.mockImplementation(async (input, init) => {
    const path = new URL(String(input), 'http://localhost').pathname.replace('/api/v1', '');
    if (init?.method === 'DELETE') return reply({ ...coach });
    if (init?.method === 'PUT') return reply({ ...coach, ...JSON.parse(String(init.body)) });
    if (path === '/auth/me') return reply(admin);
    if (path === '/users') return reply([admin, coach]);
    if (path === '/teams') return reply([{ id: 't1', name: 'Régionale', section_id: 's1', referent_ids: ['k'] }]);
    if (path === '/users/k/assignments') return reply([{ id: 'ak', user_id: 'k', team_id: 't1', kind: 'coach', number: null, position_id: null }]);
    return reply([]);
  });
  open('users');
  await userEvent.click(await screen.findByRole('button', { name: 'Ouvrir la fiche de Kim' }));
  const card = await screen.findByRole('region', { name: 'Fiche de Kim' });
  const coached = await within(card).findByRole('list', { name: 'Équipes coachées' });
  await userEvent.click(within(coached).getByRole('button', { name: 'Retirer Régionale' }));
  const dialog = await screen.findByRole('dialog', { name: 'Retirer le coaching de Régionale ?' });
  expect(dialog).toHaveTextContent('Kim ne sera plus coach de cette équipe');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Retirer le coaching' }));
  await waitFor(() => expect(within(card).queryByRole('region', { name: 'Rattachements coach' })).not.toBeInTheDocument());
  expect(mutations()).toEqual([]);
  await userEvent.click(within(card).getByRole('button', { name: 'Enregistrer' }));
  await waitFor(() => expect(mutations().map(([path, method]) => [path, method])).toEqual([['/users/k', 'PUT'], ['/users/k/assignments/ak', 'DELETE']]));
});
