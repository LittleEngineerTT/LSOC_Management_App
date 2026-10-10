import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AuthApp } from '../auth/AuthApp';
const admin = { id: 'a', first_name: 'Admin', roles: ['admin'], active: true };
let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;
function reply(body: unknown) { return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } }); }
beforeEach(() => {
  document.cookie = 'lsoc_csrf=csrf; path=/';
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value() { this.setAttribute('open', ''); } });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value() { this.removeAttribute('open'); } });
  fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
    const path = new URL(String(input), 'http://localhost').pathname;
    if (path.endsWith('/auth/me')) return reply(admin);
    if (path.endsWith('/users')) return reply([admin]);
    if (path.endsWith('/sources') || path.endsWith('/sync')) return reply(path.endsWith('/sync') ? { id: 'source-1', last_error: 'Page FFVB invalide', last_success_at: null } : [{ id: 'source-1', team_id: 't', season: '2026/2027', entity: 'PTIDF92', pool: 'BRC', team_name: 'LSO COLOMBES', team_number: '6', club_code: '0926620', enabled: true, interval_minutes: 15, last_error: null, last_success_at: null }]);
    if (path.endsWith('/conflicts')) return reply([{ id: 'conflict-1', match_id: 'match-1', field: 'kickoff_at', official_value: '2026-10-11T10:00:00Z', local_value: '2026-10-11T11:00:00Z', status: 'open', created_at: '2026-10-10T09:00:00Z' }]);
    if (path.endsWith('/matches')) return reply([{ id: 'match-1', match_code: 'BRC001', season: '2026/2027', official: { home_team: 'LSO COLOMBES', away_team: 'PARIS' }, protected: {} }]);
    if (init?.method === 'POST') return reply({});
    if (path.endsWith('/defaults')) return reply({ before_minutes: 75, after_minutes: 150, courts: 3 });
    return reply([]);
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal'); Reflect.deleteProperty(HTMLDialogElement.prototype, 'close'); document.cookie = 'lsoc_csrf=; Max-Age=0; path=/'; });
function open() { render(<MemoryRouter initialEntries={['/app/administration?tab=ffvb']}><AuthApp /></MemoryRouter>); }
it('affiche une erreur FFVB même quand la synchronisation répond 200', async () => {
  open();
  await userEvent.click(await screen.findByRole('button', { name: 'Synchroniser' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Page FFVB invalide');
  expect(screen.queryByText('Synchronisation réussie.')).not.toBeInTheDocument();
});
it('ne suspend un conflit qu’après confirmation explicite', async () => {
  open();
  await userEvent.click(await screen.findByRole('button', { name: 'Conflits' }));
  await userEvent.click(await screen.findByRole('button', { name: 'Suspendre 48 h' }));
  expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(0);
  await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Confirmer' }));
  expect(fetchMock).toHaveBeenCalledWith('/api/v1/ffvb/conflicts/conflict-1/resolve', expect.objectContaining({ method: 'POST', body: JSON.stringify({ action: 'suspend_48h' }) }));
});
