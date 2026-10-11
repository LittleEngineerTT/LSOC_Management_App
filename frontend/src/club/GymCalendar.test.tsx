import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { AuthApp } from '../auth/AuthApp';
import { splitGymIntervals } from './gymCalendar';

const account = { id: 'm', username: 'camille', first_name: 'Camille', active: true, roles: ['member'], email: null };
const base = { gymnasium_id: 'g1', kind: 'training', section_ids: [], location: '', courts: 2, referent_id: 'm', cancelled: false, registration_section_ids: [], registration_count: 0, registration_limit: null, starts_at: '2026-10-14T16:00:00Z', ends_at: '2026-10-14T18:00:00Z' };
const events = [{ ...base, id: 'e1', title: 'Séance locale', ffvb_match_id: null }, { ...base, id: 'e2', title: 'Match fédéral', ffvb_match_id: 'ffvb' }];
const blocks = [{ id: 'b1', gymnasium_id: 'g1', title: 'Travaux', courts: 1, starts_at: '2026-10-13T22:00:00Z', ends_at: '2026-10-15T22:00:00Z' }];
afterEach(() => vi.unstubAllGlobals());
beforeAll(() => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value() { this.setAttribute('open', ''); } });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value() { this.removeAttribute('open'); } });
});
afterAll(() => { Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal'); Reflect.deleteProperty(HTMLDialogElement.prototype, 'close'); });
function open(path = '/app/gymnases?semaine=2026-10-12', cancelled = false) {
  const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input) => {
    const url = new URL(String(input), 'http://localhost');
    const name = url.pathname.replace('/api/v1', '');
    let data: unknown = [];
    if (name === '/auth/me') data = account;
    if (name === '/gymnasiums') data = [{ id: 'g1', name: 'Paré', capacity: 3 }, { id: 'g2', name: 'Ladoumègue', capacity: 2 }];
    if (name === '/events') data = events.map((event) => ({ ...event, cancelled }));
    if (name === '/events/e1') data = events[0];
    if (name === '/events/e1/registrations') data = { event_id: 'e1', open: false, count: 0, limit: null, eligible: false, registered: false, participants: null };
    if (name === '/availability-blocks') data = blocks;
    if (name.endsWith('/availability')) data = { capacity: 3, segments: [
      { starts_at: url.searchParams.get('starts_at'), ends_at: '2026-10-13T21:00:00Z', occupied: 0, available: 3, excess: 0 },
      { starts_at: '2026-10-13T21:00:00Z', ends_at: '2026-10-15T22:00:00Z', occupied: 2, available: 1, excess: 0 },
      { starts_at: '2026-10-15T22:00:00Z', ends_at: url.searchParams.get('ends_at'), occupied: 4, available: 0, excess: 1 },
    ] };
    return new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
  });
  vi.stubGlobal('fetch', fetchMock);
  render(<MemoryRouter initialEntries={[path]}><AuthApp /></MemoryRouter>);
  return fetchMock;
}

it('présente les terrains libres dans des colonnes horaires et conserve les origines et liens', async () => {
  open();
  const week = await screen.findByRole('region', { name: 'Calendrier de disponibilité de la semaine' });
  expect(within(week).getByRole('region', { name: 'Lundi 12 octobre' })).toHaveTextContent('3 libres sur 3');
  const wednesday = within(week).getByRole('region', { name: 'Mercredi 14 octobre' });
  expect(wednesday).toHaveTextContent('1 libre sur 3');
  expect(within(wednesday).getByRole('link', { name: /Séance locale/ })).toHaveClass('origin-local');
  expect(within(wednesday).getByRole('link', { name: /Match fédéral/ })).toHaveClass('origin-ffvb');
  expect(within(wednesday).getByRole('link', { name: /Séance locale/ }).style.left).not.toBe(within(wednesday).getByRole('link', { name: /Match fédéral/ }).style.left);
  expect(within(wednesday).getByText('Travaux')).toBeInTheDocument();
  expect(within(wednesday).queryByRole('link', { name: /Travaux/ })).not.toBeInTheDocument();
  expect(within(week).getByRole('region', { name: 'Vendredi 16 octobre' })).toHaveTextContent('Complet · 1 terrain en excès');
});

it('découpe les changements d’heure de Paris et exclut le lendemain d’une fin à minuit', () => {
  const intervals = [{ starts_at: '2026-10-24T21:00:00Z', ends_at: '2026-10-25T23:00:00Z' }];
  expect(splitGymIntervals(intervals, ['2026-10-24', '2026-10-25', '2026-10-26']).map(({ day, startMinute, endMinute }) => ({ day, startMinute, endMinute }))).toEqual([
    { day: '2026-10-24', startMinute: 1380, endMinute: 1440 },
    { day: '2026-10-25', startMinute: 0, endMinute: 1440 },
  ]);
  expect(splitGymIntervals([{ starts_at: '2026-03-28T23:00:00Z', ends_at: '2026-03-29T22:00:00Z' }], ['2026-03-29', '2026-03-30']).map(({ day, startMinute, endMinute }) => ({ day, startMinute, endMinute }))).toEqual([{ day: '2026-03-29', startMinute: 0, endMinute: 1440 }]);
});

it('répartit la capacité et les indisponibilités sur chaque jour avec une fin exclusive', async () => {
  open();
  const week = await screen.findByRole('region', { name: 'Calendrier de disponibilité de la semaine' });
  expect(within(week).getByRole('region', { name: 'Jeudi 15 octobre' })).toHaveTextContent('1 libre sur 3');
  expect(within(week).getByRole('region', { name: 'Jeudi 15 octobre' })).toHaveTextContent('Travaux');
  expect(within(week).getByRole('region', { name: 'Vendredi 16 octobre' })).not.toHaveTextContent('Travaux');
});

it('charge 42 jours au mois et détaille les créneaux du jour choisi', async () => {
  const fetchMock = open('/app/gymnases?semaine=2026-10-12&vue=mois');
  const month = await screen.findByRole('region', { name: 'Calendrier de disponibilité du mois' });
  expect(within(month).getAllByRole('button', { name: /Voir les disponibilités/ })).toHaveLength(42);
  await userEvent.click(within(month).getByRole('button', { name: /Voir les disponibilités du Jeudi 15 octobre/ }));
  const details = screen.getByRole('region', { name: 'Disponibilités du Jeudi 15 octobre' });
  expect(details).toHaveTextContent('00:00 – 24:00');
  expect(details).toHaveTextContent('1 libre sur 3');
  expect(details).toHaveTextContent('Travaux');
  expect(fetchMock.mock.calls.some(([input]) => {
    const url = new URL(String(input), 'http://localhost');
    return url.pathname.endsWith('/availability') && url.searchParams.get('starts_at') === '2026-09-27T22:00:00.000Z' && url.searchParams.get('ends_at') === '2026-11-08T23:00:00.000Z';
  })).toBe(true);
});

it('conserve la vue, la date, le jour et les filtres en changeant de gymnase', async () => {
  open('/app/gymnases?gymnase=g1&semaine=2026-10-12&vue=mois&jour=2026-10-15&origine=local&event=e1');
  const picker = await screen.findByRole('navigation', { name: 'Gymnases' });
  const next = within(picker).getByRole('link', { name: /Ladoumègue/ });
  const params = new URLSearchParams(next.getAttribute('href')!.split('?')[1]);
  expect(Object.fromEntries(params)).toEqual({ gymnase: 'g2', semaine: '2026-10-12', vue: 'mois', jour: '2026-10-15', origine: 'local' });
});

it('signale une séance annulée sans recalculer l’occupation renvoyée par le serveur', async () => {
  open('/app/gymnases?semaine=2026-10-12&jour=2026-10-14', true);
  const week = await screen.findByRole('region', { name: 'Calendrier de disponibilité de la semaine' });
  const day = within(week).getByRole('region', { name: 'Mercredi 14 octobre' });
  expect(within(day).getByRole('link', { name: /Séance locale.*annulé, sans occupation/ })).toHaveClass('cancelled');
  expect(day).toHaveTextContent('1 libre sur 3');
  expect(day).not.toHaveTextContent('Complet');
});
