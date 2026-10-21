import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { AuthApp } from '../auth/AuthApp';

const admin = { id: 'a', username: 'admin', first_name: 'Admin', category: 'adult', active: true, roles: ['admin'], email: null, messaging_allowed: true, followed_email: true, referent_email: true, admin_email: true };
let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;
function reply(value: unknown, status = 200) { return new Response(status === 204 ? null : JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } }); }
const mutations = () => fetchMock.mock.calls.filter(([, init]) => init?.method && init.method !== 'GET').map(([input, init]) => [new URL(String(input), 'http://localhost').pathname.replace('/api/v1', ''), init?.method, init?.body ? JSON.parse(String(init.body)) : null]);

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
    if (path === '/users') return reply([admin, { ...admin, id: 'c', first_name: 'Carla', roles: ['coach'] }, { ...admin, id: 'b', first_name: 'Bruno', roles: ['member'] }]);
    if (path === '/sections') return reply([{ id: 's3', name: 'Jeunes' }, { id: 's1', name: 'Loisir' }, { id: 's2', name: 'Compétition' }]);
    if (path === '/teams') return reply([{ id: 't1', name: 'Loisir 1', section_id: 's1', referent_ids: ['c'] }, { id: 't2', name: 'Loisir 2', section_id: 's1', referent_ids: [] }, { id: 't3', name: 'Régionale', section_id: 's2', referent_ids: ['a'] }]);
    if (path === '/ffvb/sources') return reply([{ id: 'x', team_id: 't1' }, { id: 'y', team_id: 't2' }, { id: 'z', team_id: 't3' }]);
    return reply([]);
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { vi.unstubAllGlobals(); document.cookie = 'lsoc_csrf=; Max-Age=0; path=/'; });

function open(tab = 'sections') { render(<MemoryRouter initialEntries={[`/app/administration?tab=${tab}`]}><AuthApp /></MemoryRouter>); }
const section = (name: string) => screen.getByText(name, { selector: '.admin-section h3' }).closest('.admin-section') as HTMLElement;

it('regroupe les équipes dans des sections dépliables', async () => {
  open();
  await screen.findByText('Loisir', { selector: 'summary h3' });
  expect(within(screen.getByRole('navigation', { name: 'Administration' })).getAllByRole('link').map((tab) => tab.textContent)).not.toContain('Équipes');
  expect(section('Loisir')).not.toHaveAttribute('open');
  expect(within(section('Loisir')).getByText('2 équipe(s)')).toBeInTheDocument();
  await userEvent.click(within(section('Loisir')).getByText('Loisir', { selector: 'h3' }));
  expect(section('Loisir')).toHaveAttribute('open');
  expect(within(section('Loisir')).getByText('Référents : Carla')).toBeInTheDocument();
  expect(within(section('Loisir')).getByText('Référents : À attribuer')).toBeInTheDocument();
  // Section sans équipe : en bas, sans dépliage.
  expect([...document.querySelectorAll('.admin-section h3')].map((item) => item.textContent)).toEqual(['Loisir', 'Compétition', 'Jeunes']);
  expect(section('Jeunes').tagName).toBe('ARTICLE');
  expect(section('Jeunes').querySelector('summary')).toBeNull();
  expect(within(section('Jeunes')).getByText('0 équipe')).toBeInTheDocument();
  expect(within(section('Jeunes')).getByRole('button', { name: 'Modifier Jeunes' })).toBeVisible();
});

it('garde la création, la modification et la suppression des sections et des équipes', async () => {
  open();
  await screen.findByText('Loisir', { selector: 'summary h3' });
  // Équipe ajoutée depuis sa section : la section est présélectionnée.
  await userEvent.click(within(section('Compétition')).getByRole('button', { name: 'Ajouter une équipe dans Compétition' }));
  expect(screen.getByLabelText('Section')).toHaveValue('s2');
  await userEvent.type(screen.getByLabelText('Nom'), 'Nationale');
  // Seuls les coachs et les administrateurs sont proposés comme référents.
  const referents = within(screen.getByRole('group', { name: 'Référents' }));
  expect(referents.getAllByRole('checkbox').map((box) => box.closest('label')!.textContent)).toEqual(['Admin', 'Carla']);
  await userEvent.click(referents.getByLabelText('Carla'));
  await userEvent.click(screen.getByRole('button', { name: 'Créer' }));
  expect(await screen.findByText('Création enregistrée.')).toBeInTheDocument();
  // Modification d’une équipe, dont le changement de section.
  await userEvent.click(within(section('Loisir')).getByRole('button', { name: 'Modifier Loisir 2' }));
  expect(screen.getByLabelText('Nom')).toHaveValue('Loisir 2');
  await userEvent.selectOptions(screen.getByLabelText('Section'), 's3');
  await userEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
  expect(await screen.findByText('Modification enregistrée.')).toBeInTheDocument();
  // Section : création, renommage et suppression confirmée.
  await userEvent.click(screen.getByRole('button', { name: 'Ajouter une section' }));
  await userEvent.type(screen.getByLabelText('Nom'), 'Beach');
  await userEvent.click(screen.getByRole('button', { name: 'Créer' }));
  await waitFor(() => expect(mutations()).toHaveLength(3));
  await userEvent.click(within(section('Jeunes')).getByRole('button', { name: 'Modifier Jeunes' }));
  await userEvent.clear(screen.getByLabelText('Nom'));
  await userEvent.type(screen.getByLabelText('Nom'), 'Jeunes M15');
  await userEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
  await waitFor(() => expect(mutations()).toHaveLength(4));
  await userEvent.click(within(section('Jeunes')).getByRole('button', { name: 'Supprimer Jeunes' }));
  await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Confirmer la suppression' }));
  await userEvent.click(within(section('Compétition')).getByRole('button', { name: 'Supprimer Régionale' }));
  await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Confirmer la suppression' }));
  await waitFor(() => expect(mutations()).toEqual([
    ['/teams', 'POST', { name: 'Nationale', section_id: 's2', referent_ids: ['c'] }],
    ['/teams/t2', 'PUT', { name: 'Loisir 2', section_id: 's3', referent_ids: [] }],
    ['/sections', 'POST', { name: 'Beach' }],
    ['/sections/s3', 'PUT', { name: 'Jeunes M15' }],
    ['/sections/s3', 'DELETE', null],
    ['/teams/t3', 'DELETE', null],
  ]));
});

it('ouvre les anciens liens vers l’onglet Équipes sur Sections et équipes', async () => {
  open('teams');
  expect(await screen.findByRole('heading', { name: 'Sections et équipes' })).toBeInTheDocument();
});
