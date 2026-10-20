import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { AuthApp } from '../auth/AuthApp';

const admin = { id: 'a', username: 'admin', first_name: 'Admin', category: 'adult', active: true, roles: ['admin'], email: null, messaging_allowed: true, followed_email: true, referent_email: true, admin_email: true };
const coach = { ...admin, id: 'c', username: 'carla', first_name: 'Carla', roles: ['member', 'coach'] };
const PDF_URL = 'https://lsoc-licences.s3.eu-west-3.amazonaws.com/licences/' + 'a'.repeat(64);
let account = admin;
let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;
let licenses: Record<string, unknown>[];
function reply(value: unknown) { return new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } }); }
function open(path: string) { render(<MemoryRouter initialEntries={[path]}><AuthApp /></MemoryRouter>); }
const calls = (path: string) => fetchMock.mock.calls.filter(([input]) => new URL(String(input), 'http://localhost').pathname === `/api/v1${path}`);

beforeAll(() => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value() { this.setAttribute('open', ''); } });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value() { this.removeAttribute('open'); } });
});
afterAll(() => { Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal'); Reflect.deleteProperty(HTMLDialogElement.prototype, 'close'); });
beforeEach(() => {
  account = admin;
  licenses = [
    { user_id: 'm', first_name: 'Alice', username: 'alice', number: 'A-1', status: 'active', coach_status: 'none', coach: false, updated_at: null, teams: [{ team_id: 't2', kind: 'player' }], missing: false, file_url: PDF_URL, file_uploaded_at: '2026-10-01T10:00:00Z' },
    { user_id: 'b', first_name: 'Bob', username: 'bob', number: null, status: 'none', coach_status: 'none', coach: false, updated_at: null, teams: [{ team_id: 't2', kind: 'player' }], missing: true, file_url: null },
  ];
  document.cookie = 'lsoc_csrf=csrf; path=/';
  fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
    const url = new URL(String(input), 'http://localhost');
    const path = url.pathname.replace('/api/v1', '');
    if (path === '/auth/me') return reply(account);
    if (path === '/sections') return reply([{ id: 's1', name: 'Loisir' }, { id: 's2', name: 'Compétition' }]);
    if (path === '/teams') return reply([{ id: 't1', name: 'Loisir 1', section_id: 's1', referent_ids: ['a'] }, { id: 't2', name: 'Régionale', section_id: 's2', referent_ids: [] }]);
    // Le serveur limite la liste d’un coach aux membres de ses équipes.
    if (path === '/users' && account === coach) return reply([{ ...admin, id: 'b', first_name: 'Bob', roles: ['member'] }, { ...coach }]);
    if (path === '/assignments' && account === coach) return reply([{ id: 'x2', user_id: 'b', team_id: 't2', kind: 'player' }, { id: 'x3', user_id: 'c', team_id: 't2', kind: 'coach' }]);
    if (path === '/users') return reply([admin, { ...admin, id: 'm', first_name: 'Alice', roles: ['member'] }, { ...admin, id: 'b', first_name: 'Bob', roles: ['member'] }, { ...admin, id: 'z', first_name: 'Zoé', roles: ['member'] }]);
    if (path === '/assignments') return reply([{ id: 'x1', user_id: 'm', team_id: 't1', kind: 'player' }, { id: 'x2', user_id: 'b', team_id: 't2', kind: 'player' }]);
    if (path === '/users/c/assignments') return reply([{ id: 'x3', user_id: 'c', team_id: 't2', kind: 'coach' }]);
    if (path === '/profiles/a') return reply({ id: 'a', first_name: 'Admin', category: 'adult' });
    if (path === '/licenses/b/file' && init?.method === 'PUT') {
      licenses = licenses.map((item) => (item.user_id === 'b' ? { ...item, file_url: PDF_URL } : item));
      return reply(licenses[1]);
    }
    if (path === '/licenses') return reply(licenses);
    return reply([]);
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { vi.unstubAllGlobals(); document.cookie = 'lsoc_csrf=; Max-Age=0; path=/'; });

it('affiche le PDF directement depuis le stockage S3', async () => {
  open('/app/administration?tab=licenses');
  const alice = (await screen.findByRole('heading', { name: /Alice/ })).closest('article')!;
  expect(within(alice).getByText(/PDF déposé le/)).toBeInTheDocument();
  await userEvent.click(within(alice).getByRole('button', { name: 'Voir la licence de Alice' }));
  const dialog = screen.getByRole('dialog', { name: 'Licence de Alice' });
  expect(within(dialog).getByTitle('Licence de Alice')).toHaveAttribute('src', PDF_URL);
  expect(within(dialog).getByRole('link', { name: 'Ouvrir dans un nouvel onglet' })).toHaveAttribute('href', PDF_URL);
  await userEvent.click(within(dialog).getByRole('button', { name: 'Fermer' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  // Bob n’a pas de PDF : pas de bouton « Voir licence ».
  const bob = screen.getByRole('heading', { name: /Bob/ }).closest('article')!;
  expect(within(bob).queryByRole('button', { name: /Voir la licence/ })).not.toBeInTheDocument();
});

it('dépose un PDF brut et refuse un autre type de fichier', async () => {
  open('/app/administration?tab=licenses');
  const bob = (await screen.findByRole('heading', { name: /Bob/ })).closest('article')!;
  const input = within(bob).getByLabelText('PDF de la licence de Bob');
  await userEvent.upload(input, new File(['image'], 'photo.png', { type: 'image/png' }), { applyAccept: false });
  expect(await screen.findByText('La licence doit être un fichier PDF.')).toBeInTheDocument();
  expect(calls('/licenses/b/file')).toHaveLength(0);
  await userEvent.upload(input, new File(['%PDF-1.7'], 'licence.pdf', { type: 'application/pdf' }));
  expect(await screen.findByText('PDF de la licence de Bob déposé.')).toBeInTheDocument();
  const init = calls('/licenses/b/file')[0]?.[1];
  expect(init?.method).toBe('PUT');
  expect(init?.body).toBeInstanceOf(Blob);
  expect(new Headers(init?.headers).get('Content-Type')).toBe('application/pdf');
  expect(new Headers(init?.headers).get('X-CSRF-Token')).toBe('csrf');
  await waitFor(() => expect(within(bob).getByRole('button', { name: 'Voir la licence de Bob' })).toBeInTheDocument());
});

it('donne au coach une administration limitée, en lecture seule', async () => {
  account = coach;
  open('/app/administration');
  // Utilisateurs par défaut, sans les onglets réservés aux administrateurs.
  expect(await screen.findByRole('heading', { name: 'Bob' })).toBeInTheDocument();
  const tabs = within(screen.getByRole('navigation', { name: 'Administration' })).getAllByRole('link');
  expect(tabs.map((tab) => tab.textContent)).toEqual(['Utilisateurs', 'Sections et équipes', 'Licences']);
  expect([...document.querySelectorAll('.admin-list .admin-row h3')].map((item) => item.textContent)).toEqual(['Bob', 'Carla']);
  expect(screen.queryByRole('button', { name: /Ajouter|Gérer|Supprimer/ })).not.toBeInTheDocument();
  expect(within(screen.getByLabelText('Équipe')).getAllByRole('option').map((option) => option.textContent)).toEqual(['Toutes les équipes', 'Sans équipe', 'Régionale']);
  await userEvent.click(screen.getByRole('link', { name: 'Licences' }));
  expect(await screen.findByRole('heading', { name: /Alice/ })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Voir la licence de Alice' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Gérer la licence' })).not.toBeInTheDocument();
  expect(screen.queryByLabelText(/PDF de la licence/)).not.toBeInTheDocument();
  // Filtres limités à ses équipes : il coache la Régionale.
  expect(within(screen.getByLabelText('Section')).getAllByRole('option').map((option) => option.textContent)).toEqual(['Toutes les sections', 'Compétition']);
  expect(within(screen.getByLabelText('Équipe')).getAllByRole('option').map((option) => option.textContent)).toEqual(['Toutes les équipes', 'Régionale']);
  await userEvent.click(screen.getByRole('link', { name: 'Sections et équipes' }));
  await userEvent.click(await screen.findByText('Loisir'));
  expect(screen.getByRole('heading', { name: 'Loisir 1' })).toBeVisible();
  expect(screen.getByText('Référents : Admin')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Ajouter|Modifier|Supprimer/ })).not.toBeInTheDocument();
});

it('filtre les utilisateurs par section et par équipe', async () => {
  open('/app/administration?tab=users');
  const names = () => [...document.querySelectorAll('.admin-list .admin-row h3')].map((item) => item.textContent);
  await screen.findByRole('heading', { name: 'Zoé' });
  await waitFor(() => expect(names()).toEqual(['Admin', 'Alice', 'Bob', 'Zoé']));
  await userEvent.selectOptions(screen.getByLabelText('Section'), 's2');
  await waitFor(() => expect(names()).toEqual(['Bob']));
  expect(within(screen.getByLabelText('Équipe')).getAllByRole('option').map((option) => option.textContent)).toEqual(['Toutes les équipes', 'Sans équipe', 'Régionale']);
  await userEvent.selectOptions(screen.getByLabelText('Section'), '');
  await userEvent.selectOptions(screen.getByLabelText('Équipe'), 't1');
  await waitFor(() => expect(names()).toEqual(['Alice']));
  await userEvent.selectOptions(screen.getByLabelText('Équipe'), 'none');
  await waitFor(() => expect(names()).toEqual(['Admin', 'Zoé']));
});
