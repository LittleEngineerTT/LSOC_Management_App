import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { AuthApp } from '../auth/AuthApp';

const admin = { id: 'admin-1', first_name: 'Admin', category: 'adult', roles: ['admin'], active: true, email: 'admin@example.org', messaging_allowed: true };
const coach = { ...admin, id: 'coach-1', roles: ['member', 'coach'] };
const base = { kind: 'training', section_ids: [], location: '', courts: 2, referent_ids: ['admin-1'], cancelled: false, ffvb_match_id: null, starts_at: '2099-10-15T16:00:00Z', ends_at: '2099-10-15T18:00:00Z' };
const conflicts = [
  { event: { ...base, id: 'e1', title: 'Entraînement loisir', gymnasium_id: 'g1' }, problems: [{ code: 'capacity_exceeded', message: 'Capacité du gymnase dépassée de 1 terrain' }] },
  { event: { ...base, id: 'e2', title: 'LSO / Paris', kind: 'match', gymnasium_id: null, courts: 0, ffvb_match_id: 'm1' }, problems: [{ code: 'missing_gymnasium', message: 'Match à domicile sans gymnase associé : occupation des terrains inconnue' }, { code: 'ffvb_divergence', message: 'Divergence avec le calendrier officiel FFVB à traiter' }] },
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
  expect(within(excess).getByRole('link', { name: 'Ouvrir l’événement' })).toHaveAttribute('href', '/app/planning?semaine=2099-10-12&event=e1');
  expect(within(excess).queryByRole('link', { name: 'Voir la divergence' })).not.toBeInTheDocument();
  const match = screen.getByRole('heading', { name: 'LSO / Paris' }).closest('article')!;
  expect(within(match).getAllByRole('listitem').map((item) => item.textContent)).toEqual([
    'Match à domicile sans gymnase associé : occupation des terrains inconnue',
    'Divergence avec le calendrier officiel FFVB à traiter',
  ]);
  expect(within(match).getByRole('link', { name: 'Voir la divergence' })).toHaveAttribute('href', '/app/administration?tab=ffvb&vue=conflicts');
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
