import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { AuthApp } from './AuthApp';

const match = { id: 'ffvb', title: 'LSO Colombes – Paris', kind: 'match', section_ids: ['s1'], gymnasium_id: 'g1', location: '', starts_at: '2099-10-14T16:00:00Z', ends_at: '2099-10-14T18:00:00Z', cancelled: false, ffvb_match_id: 'm1', kickoff_at: '2099-10-14T16:30:00Z', team_ids: ['t1'] };

beforeAll(() => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value() { this.setAttribute('open', ''); } });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value() { this.removeAttribute('open'); } });
});
afterAll(() => { Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal'); Reflect.deleteProperty(HTMLDialogElement.prototype, 'close'); });
afterEach(() => {
  vi.unstubAllGlobals();
  window.sessionStorage.clear();
});

function open(path = '/login') {
  const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input) => {
    const url = new URL(String(input), 'http://localhost');
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
    if (url.pathname.endsWith('/auth/me')) return json({ detail: 'Connexion requise' }, 401);
    if (url.pathname.endsWith('/public/sections')) return json([{ id: 's1', name: 'Seniors' }]);
    if (url.pathname.endsWith('/public/teams')) return json([{ id: 't1', name: 'Seniors M1', section_id: 's1' }]);
    if (url.pathname.endsWith('/public/gymnasiums')) return json([{ id: 'g1', name: 'Ambroise Paré' }]);
    if (url.pathname.endsWith('/public/events/ffvb')) return json(match);
    if (url.pathname.endsWith('/public/events')) return json([match]);
    return json({ detail: 'Connexion requise' }, 401);
  });
  vi.stubGlobal('fetch', fetchMock);
  render(<MemoryRouter initialEntries={[path]}><AuthApp /></MemoryRouter>);
  return fetchMock;
}

it('continue en invité : accueil sans notifications, menu réduit et API publique seule', async () => {
  const fetchMock = open();
  await userEvent.click(await screen.findByRole('button', { name: 'Continuer en tant qu’invité' }));
  expect(await screen.findByRole('heading', { name: 'Bienvenue au LSO Colombes Volley' })).toBeInTheDocument();
  expect(await screen.findByRole('link', { name: 'LSO Colombes – Paris' })).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: /Notifications/ })).not.toBeInTheDocument();
  const menu = screen.getByRole('navigation', { name: 'Applications' });
  expect(within(menu).getAllByRole('link').map((link) => link.textContent)).toEqual(['Accueil', 'Planning']);
  expect(screen.queryByRole('link', { name: 'Mon planning' })).not.toBeInTheDocument();
  expect(screen.getAllByRole('link', { name: 'Se connecter' }).length).toBeGreaterThan(0);
  const paths = fetchMock.mock.calls.map(([input]) => new URL(String(input), 'http://localhost').pathname);
  expect(paths.filter((path) => !path.endsWith('/auth/me')).every((path) => path.startsWith('/api/v1/public/'))).toBe(true);
});

it('montre au planning les seuls matchs FFVB, en lecture seule', async () => {
  window.sessionStorage.setItem('lsoc_guest', '1');
  const fetchMock = open('/app/planning?semaine=2099-10-12');
  const calendar = await screen.findByRole('region', { name: 'Calendrier de la semaine' });
  await userEvent.click(await within(calendar).findByRole('link', { name: /LSO Colombes – Paris/ }));
  const dialog = await screen.findByRole('dialog', { name: 'LSO Colombes – Paris' });
  expect(await within(dialog).findByText('Ambroise Paré')).toBeInTheDocument();
  expect(within(dialog).getByText('Seniors')).toBeInTheDocument();
  expect(within(dialog).getByText('Seniors M1')).toBeInTheDocument();
  expect(within(dialog).queryByRole('button', { name: /Modifier|Suivre|Poser une question/ })).not.toBeInTheDocument();
  expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/public/events?starts_at='))).toBe(true);
});

it('renvoie un invité vers l’accueil pour les sections réservées', async () => {
  window.sessionStorage.setItem('lsoc_guest', '1');
  open('/app/messagerie');
  expect(await screen.findByRole('heading', { name: 'Bienvenue au LSO Colombes Volley' })).toBeInTheDocument();
});

it('sans choix invité, une page de l’application exige toujours la connexion', async () => {
  open('/app/planning');
  expect(await screen.findByRole('button', { name: 'Continuer en tant qu’invité' })).toBeInTheDocument();
});
