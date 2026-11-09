import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { AuthApp } from '../auth/AuthApp';

const admin = { id: 'admin-1', first_name: 'Admin', category: 'adult', roles: ['admin'], active: true, email: 'admin@example.org', messaging_allowed: true };
const coach = { ...admin, id: 'coach-1', roles: ['member', 'coach'] };
const base = { kind: 'training', section_ids: [], location: '', courts: 2, referent_ids: ['admin-1'], cancelled: false, ffvb_match_id: null, starts_at: '2099-10-15T16:00:00Z', ends_at: '2099-10-15T18:00:00Z' };
const conflicts = [
  { event: { ...base, id: 'e1', title: 'Entraînement loisir', gymnasium_id: 'g1' }, problems: [{ code: 'capacity_exceeded', message: 'Capacité du gymnase dépassée de 1 terrain' }] },
  { event: { ...base, id: 'e3', title: 'Entraînement en conflit', gymnasium_id: 'g1', conflict: true, conflict_note: 'Travaux' }, problems: [{ code: 'unavailability_conflict', message: 'Conflit : gymnase indisponible (Travaux) : à déplacer, reporter ou annuler' }], signature: 'sig-e3' },
  { event: { ...base, id: 'e2', title: 'LSO / Paris', kind: 'match', gymnasium_id: null, courts: 0, ffvb_match_id: 'm1' }, problems: [{ code: 'missing_gymnasium', message: 'Match à domicile sans gymnase associé : occupation des terrains inconnue' }, { code: 'ffvb_divergence', message: 'Divergence avec le calendrier officiel FFVB à traiter' }], divergences: [{ id: 'd1', match_id: 'm1', field: 'location', official_value: 'PARÉ', local_value: 'Extérieur', author_id: null, status: 'open', created_at: '2099-10-10T10:00:00Z' }], signature: 'sig-e2' },
];
let account: typeof admin;
beforeAll(() => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value() { this.setAttribute('open', ''); } });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value() { this.removeAttribute('open'); } });
});
afterAll(() => { Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal'); Reflect.deleteProperty(HTMLDialogElement.prototype, 'close'); });
function reply(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }); }
beforeEach(() => {
  account = admin;
  document.cookie = 'lsoc_csrf=admin-csrf; path=/';
  vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockImplementation(async (input) => {
    const path = new URL(String(input), 'http://localhost').pathname;
    if (path.endsWith('/auth/me')) return reply(account);
    if (path.endsWith('/gymnasiums')) return reply([{ id: 'g1', name: 'Ambroise Paré', capacity: 3 }]);
    if (path.endsWith('/event-conflicts')) return reply(conflicts);
    if (path.endsWith('/ffvb/defaults')) return reply({ before_minutes: 75, after_minutes: 150, courts: 3 });
    return reply([]);
  }));
});
afterEach(() => { vi.unstubAllGlobals(); document.cookie = 'lsoc_csrf=; Max-Age=0; path=/'; });

it('liste les événements en conflit ou erronés avec leurs problèmes', async () => {
  render(<MemoryRouter initialEntries={['/app/administration?tab=conflicts']}><AuthApp /></MemoryRouter>);
  const excess = (await screen.findByRole('heading', { name: 'Entraînement loisir' })).closest('article')!;
  expect(excess).toHaveTextContent('Ambroise Paré');
  expect(within(excess).getByText('Capacité du gymnase dépassée de 1 terrain')).toBeInTheDocument();
  // Un événement en conflit avec une indisponibilité est à déplacer, reporter ou annuler.
  const cancelled = screen.getByRole('heading', { name: 'Entraînement en conflit' }).closest('article')!;
  expect(within(cancelled).getByText('Conflit : gymnase indisponible (Travaux) : à déplacer, reporter ou annuler')).toBeInTheDocument();
  expect(within(excess).getByRole('link', { name: 'Ouvrir l’événement' })).toHaveAttribute('href', '/app/planning?semaine=2099-10-12&event=e1');
  expect(within(excess).queryByRole('region', { name: /Divergence/ })).not.toBeInTheDocument();
  const match = screen.getByRole('heading', { name: 'LSO / Paris' }).closest('article')!;
  expect(within(within(match).getByRole('list', { name: 'Problèmes de LSO / Paris' })).getAllByRole('listitem').map((item) => item.textContent)).toEqual([
    'Match à domicile sans gymnase associé : occupation des terrains inconnue',
    'Divergence avec le calendrier officiel FFVB à traiter',
  ]);
  // La divergence FFVB se lit et se tranche dans l’onglet, sans passer par FFVB.
  const divergence = within(match).getByRole('region', { name: 'Divergence : Lieu' });
  expect(divergence).toHaveTextContent('Extérieur');
  expect(divergence).toHaveTextContent('PARÉ');
  expect(within(divergence).getByRole('button', { name: 'Accepter la FFVB' })).toBeInTheDocument();
});

it('ne tranche une divergence FFVB qu’après confirmation explicite', async () => {
  const posted: { path: string; body: unknown }[] = [];
  vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
    const path = new URL(String(input), 'http://localhost').pathname;
    if (init?.method === 'POST') { posted.push({ path, body: JSON.parse(String(init.body)) }); return reply({}); }
    if (path.endsWith('/auth/me')) return reply(admin);
    if (path.endsWith('/event-conflicts')) return reply(conflicts);
    return reply([]);
  }));
  render(<MemoryRouter initialEntries={['/app/administration?tab=conflicts']}><AuthApp /></MemoryRouter>);
  const divergence = await screen.findByRole('region', { name: 'Divergence : Lieu' });
  await userEvent.click(within(divergence).getByRole('button', { name: 'Suspendre 48 h' }));
  expect(posted).toEqual([]);
  await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Confirmer' }));
  await waitFor(() => expect(posted).toEqual([{ path: '/api/v1/ffvb/conflicts/d1/resolve', body: { action: 'suspend_48h' } }]));
});

it('ignore un conflit jusqu’à ce qu’il change, et le rétablit depuis les conflits ignorés', async () => {
  let ignored = false;
  const calls: { path: string; method: string; body?: unknown }[] = [];
  vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
    const url = new URL(String(input), 'http://localhost');
    const method = init?.method ?? 'GET';
    if (method !== 'GET') {
      calls.push({ path: url.pathname, method, ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}) });
      ignored = method === 'POST';
      return method === 'DELETE' ? new Response(null, { status: 204 }) : reply({});
    }
    if (url.pathname.endsWith('/auth/me')) return reply(admin);
    if (url.pathname.endsWith('/event-conflicts')) {
      const all = url.searchParams.get('include_ignored') === 'true';
      const first = { ...conflicts[0], signature: 'sig-e1', ...(ignored ? { ignored: true, ignorer_name: 'Admin', ignored_at: '2099-10-10T10:00:00Z' } : {}) };
      return reply(ignored && !all ? [] : [first]);
    }
    return reply([]);
  }));
  render(<MemoryRouter initialEntries={['/app/administration?tab=conflicts']}><AuthApp /></MemoryRouter>);
  const row = (await screen.findByRole('heading', { name: 'Entraînement loisir' })).closest('article')!;
  // Pastille rouge de l’onglet : les conflits ni résolus ni ignorés.
  const tab = within(screen.getByRole('navigation', { name: 'Administration' })).getByRole('link', { name: 'Conflits' });
  await waitFor(() => expect(tab).toHaveAccessibleDescription('1 conflit à traiter'));
  expect(within(tab).getByText('1')).toHaveClass('admin-tab-count', 'danger');
  await userEvent.click(within(row).getByRole('button', { name: 'Ignorer' }));
  expect(await screen.findByText('Aucun événement en conflit.')).toBeInTheDocument();
  await waitFor(() => expect(tab).not.toHaveAccessibleDescription());
  expect(screen.getByText('Conflit de Entraînement loisir ignoré ; il réapparaîtra s’il change.')).toBeInTheDocument();
  expect(calls).toEqual([{ path: '/api/v1/event-conflicts/e1/ignore', method: 'POST', body: { signature: 'sig-e1' } }]);
  await userEvent.click(screen.getByRole('checkbox', { name: 'Afficher les conflits ignorés' }));
  const shown = (await screen.findByRole('heading', { name: 'Entraînement loisir' })).closest('article')!;
  expect(within(shown).getByText(/Ignoré par Admin/)).toBeInTheDocument();
  await userEvent.click(within(shown).getByRole('button', { name: 'Ne plus ignorer' }));
  await waitFor(() => expect(calls.at(-1)).toEqual({ path: '/api/v1/event-conflicts/e1/ignore', method: 'DELETE' }));
  expect(await within(shown).findByRole('button', { name: 'Ignorer' })).toBeInTheDocument();
  await waitFor(() => expect(tab).toHaveAccessibleDescription('1 conflit à traiter'));
});

it('renvoie l’ancienne vue FFVB « Conflits » vers l’onglet Conflits', async () => {
  render(<MemoryRouter initialEntries={['/app/administration?tab=ffvb&vue=conflicts']}><AuthApp /></MemoryRouter>);
  expect(await screen.findByRole('heading', { name: 'Conflits', level: 2 })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Conflits' })).not.toBeInTheDocument();
});

it('réserve l’onglet Conflits aux administrateurs', async () => {
  account = coach;
  render(<MemoryRouter initialEntries={['/app/administration?tab=conflicts']}><AuthApp /></MemoryRouter>);
  const tabs = await screen.findByRole('navigation', { name: 'Administration' });
  expect(within(tabs).queryByRole('link', { name: 'Conflits' })).not.toBeInTheDocument();
});

it('réactive depuis les conflits la vérification d’un match FFVB désactivé', async () => {
  let disabled = true;
  const posted: string[] = [];
  vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
    const path = new URL(String(input), 'http://localhost').pathname;
    if (init?.method === 'POST') { posted.push(path); disabled = false; return reply({}); }
    if (path.endsWith('/auth/me')) return reply(admin);
    if (path.endsWith('/event-conflicts'))
      return reply(disabled ? [{ event: { ...base, id: 'e3', title: 'LSO / Meudon', kind: 'match', gymnasium_id: 'g1', ffvb_match_id: 'm3' }, problems: [{ code: 'ffvb_disabled', message: 'Vérification FFVB désactivée pour ce match' }] }] : []);
    return reply([]);
  }));
  render(<MemoryRouter initialEntries={['/app/administration?tab=conflicts']}><AuthApp /></MemoryRouter>);
  const row = (await screen.findByRole('heading', { name: 'LSO / Meudon' })).closest('article')!;
  await userEvent.click(within(row).getByRole('button', { name: 'Réactiver la vérification FFVB' }));
  await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Confirmer' }));
  expect(await screen.findByText('Aucun événement en conflit.')).toBeInTheDocument();
  expect(screen.getByText('Vérification FFVB réactivée pour LSO / Meudon.')).toBeInTheDocument();
  expect(posted).toEqual(['/api/v1/ffvb/matches/m3/reactivate']);
});

it('renvoie l’ancienne vue « Matchs importés » vers les conflits', async () => {
  render(<MemoryRouter initialEntries={['/app/administration?tab=ffvb&vue=matches']}><AuthApp /></MemoryRouter>);
  expect(await screen.findByRole('heading', { name: 'Conflits', level: 2 })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Matchs importés' })).not.toBeInTheDocument();
});
