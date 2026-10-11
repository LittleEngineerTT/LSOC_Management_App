import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { AuthApp } from '../auth/AuthApp';
import { today, dayLabel, addDays } from './calendar';

const account = { id: 'm', username: 'camille', first_name: 'Camille', active: true, roles: ['member'], email: null };
const base = { section_ids: [], gymnasium_id: null, location: 'Paré', courts: 1, referent_id: 'm', registration_section_ids: [], registration_limit: null, registration_count: 0, starts_at: '2026-10-14T16:00:00Z', ends_at: '2026-10-14T18:00:00Z', cancelled: false };
const events = [
  { ...base, id: 'local', title: 'Entraînement local', kind: 'training', ffvb_match_id: null },
  { ...base, id: 'ffvb', title: 'Match fédéral', kind: 'match', ffvb_match_id: 'match-1' },
  { ...base, id: 'friendly', title: 'Match amical local', kind: 'match', ffvb_match_id: null },
];
afterEach(() => vi.unstubAllGlobals());
function open(path = '/app/planning?semaine=2026-10-12', suppliedEvents = events) {
  const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input) => {
    const url = new URL(String(input), 'http://localhost');
    let body: unknown = [];
    if (url.pathname.endsWith('/auth/me')) body = account;
    if (url.pathname.endsWith('/events')) body = suppliedEvents;
    return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
  });
  vi.stubGlobal('fetch', fetchMock);
  render(<MemoryRouter initialEntries={[path]}><AuthApp /></MemoryRouter>);
  return fetchMock;
}

it('présente la semaine en calendrier et distingue la provenance du type de séance', async () => {
  open();
  const calendar = await screen.findByRole('region', { name: 'Calendrier de la semaine' });
  const local = await within(calendar).findByRole('link', { name: /Entraînement local/ });
  const ffvb = within(calendar).getByRole('link', { name: /Match fédéral/ });
  expect(local).toHaveClass('origin-local');
  expect(ffvb).toHaveClass('origin-ffvb');
  expect(within(calendar).getByRole('link', { name: /Match amical local/ })).toHaveClass('origin-local');
  expect(within(ffvb).getByText('FFVB')).toBeInTheDocument();
  expect(within(local).getByText('Local')).toBeInTheDocument();
  expect(within(calendar).getByRole('region', { name: 'Mercredi 14 octobre' })).toBeInTheDocument();
});

it('affiche une activité sur plusieurs jours dans le détail du jour sélectionné du mois', async () => {
  open('/app/planning?semaine=2026-10-12&vue=mois', [{ ...events[0]!, title: 'Stage sur deux jours', starts_at: '2026-10-13T16:00:00Z', ends_at: '2026-10-14T18:00:00Z' }]);
  await userEvent.click(await screen.findByRole('button', { name: 'Mercredi 14 octobre, 1 événement' }));
  const detail = screen.getByRole('region', { name: 'Événements du Mercredi 14 octobre' });
  expect(within(detail).getByRole('link', { name: /Stage sur deux jours/ })).toBeInTheDocument();
  expect(within(detail).getAllByRole('heading')).toHaveLength(1);
  expect(within(detail).queryByText('Aucun événement.')).not.toBeInTheDocument();
});

it('sélectionne la date ancrée et revient à aujourd’hui même dans le mois affiché', async () => {
  const current = today();
  const other = addDays(current, current.endsWith('-01') ? 1 : -1);
  open(`/app/planning?semaine=${current}&vue=mois`);
  await userEvent.click(await screen.findByRole('button', { name: new RegExp(`^${dayLabel(other)},`) }));
  expect(screen.getByRole('region', { name: `Événements du ${dayLabel(other)}` })).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Aujourd’hui' }));
  expect(screen.getByRole('region', { name: `Événements du ${dayLabel(current)}` })).toBeInTheDocument();
});

it('filtre par origine sans confondre un match local avec un événement FFVB', async () => {
  open();
  await screen.findByRole('link', { name: /Entraînement local/ });
  await userEvent.selectOptions(screen.getByLabelText('Origine des événements'), 'ffvb');
  expect(screen.queryByRole('link', { name: /Entraînement local/ })).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: /Match amical local/ })).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: /Match fédéral/ })).toBeInTheDocument();
  await userEvent.selectOptions(screen.getByLabelText('Origine des événements'), 'local');
  expect(screen.queryByRole('link', { name: /Match fédéral/ })).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: /Match amical local/ })).toBeInTheDocument();
});

it('passe au mois avec les bornes complètes du calendrier et navigue entre les mois', async () => {
  const fetchMock = open();
  await userEvent.click(await screen.findByRole('button', { name: 'Mois' }));
  await screen.findByRole('region', { name: 'Calendrier du mois' });
  await vi.waitFor(() => expect(fetchMock.mock.calls.some(([input]) => {
    const url = new URL(String(input), 'http://localhost');
    return url.pathname.endsWith('/events') && url.searchParams.get('starts_at') === '2026-09-27T22:00:00.000Z' && url.searchParams.get('ends_at') === '2026-11-08T23:00:00.000Z';
  })).toBe(true));
  await userEvent.click(screen.getByRole('button', { name: /Mois suivant/ }));
  expect(screen.getByText('Novembre 2026')).toBeInTheDocument();
});
