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
  const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
    const url = new URL(String(input), 'http://localhost');
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
    if (init?.method === 'POST' && url.pathname.endsWith('/contact')) return json({ message: 'Demande envoyée' }, 201);
    if (url.pathname.endsWith('/auth/me')) return json({ detail: 'Connexion requise' }, 401);
    if (url.pathname.endsWith('/public/sections')) return json([{ id: 's1', name: 'Seniors' }]);
    if (url.pathname.endsWith('/public/teams')) return json([{ id: 't1', name: 'Seniors M1', section_id: 's1' }]);
    if (url.pathname.endsWith('/public/gymnasiums')) return json([{ id: 'g1', name: 'Ambroise Paré' }]);
    if (url.pathname.endsWith('/public/events/ffvb')) return json(match);
    if (url.pathname.endsWith('/public/events')) return json([match]);
    if (url.pathname.endsWith('/public/ffvb/results')) return json([{ source_id: 'src1', season: '2026/2027', pool: 'BRC', club_team: 'LSO COLOMBES', team_id: 't1', team_name: 'Seniors M1', section_id: 's1', section_name: 'Seniors', results: [{ match_code: 'BRC005', kickoff_at: '2026-10-15T18:50:00Z', home_team: 'MEUDON 2', away_team: 'LSO COLOMBES', home_sets: 3, away_sets: 1, set_scores: ['23:21', '21:8', '18:21', '21:9'], points: '83-59' }] }]);
    return json({ detail: 'Connexion requise' }, 401);
  });
  vi.stubGlobal('fetch', fetchMock);
  render(<MemoryRouter initialEntries={[path]}><AuthApp /></MemoryRouter>);
  return fetchMock;
}

it('arrive en invité : accueil sans notifications, menu réduit et API publique seule', async () => {
  // Sans session, le site s’ouvre directement en invité.
  const fetchMock = open('/');
  expect(await screen.findByRole('heading', { name: 'Bienvenue au LSO Colombes Volley' })).toBeInTheDocument();
  expect(await screen.findByRole('link', { name: 'LSO Colombes – Paris' })).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: /Notifications/ })).not.toBeInTheDocument();
  expect(screen.getByRole('region', { name: 'Quoi de neuf ?' })).toBeInTheDocument();
  // Les résultats récents, publics, s’affichent aussi aux invités.
  const results = await screen.findByRole('region', { name: 'Résultats des matchs' });
  // Prochains matchs à la une, à côté des informations ; les résultats en dessous.
  const upcoming = screen.getByRole('heading', { name: 'Prochains matchs FFVB' });
  expect(upcoming.closest('.club-highlights')).not.toBeNull();
  expect(results.closest('.club-home')).not.toBeNull();
  expect(await within(results).findByRole('heading', { name: /Toutes les sections/ })).toBeInTheDocument();
  await userEvent.click(within(results).getByRole('button', { name: 'Information suivante' }));
  expect(within(results).getByRole('heading', { name: /Seniors/ })).toBeInTheDocument();
  expect(within(results).getByLabelText('3 sets à 1')).toHaveTextContent('3 – 1');
  expect(within(results).getByRole('link', { name: 'Voir le tableau' })).toHaveAttribute('href', '/app/notre-club?onglet=resultats&equipe=t1');
  const menu = screen.getByRole('navigation', { name: 'Applications' });
  expect(within(menu).getAllByRole('link').map((link) => link.textContent)).toEqual(['Accueil', 'Planning', 'Notre club', 'Contact']);
  expect(screen.queryByRole('link', { name: 'Mon planning' })).not.toBeInTheDocument();
  expect(screen.getAllByRole('link', { name: 'Se connecter' }).length).toBeGreaterThan(0);
  const paths = fetchMock.mock.calls.map(([input]) => new URL(String(input), 'http://localhost').pathname);
  expect(paths.filter((path) => !path.endsWith('/auth/me')).every((path) => path.startsWith('/api/v1/public/'))).toBe(true);
});

it('montre au planning les seuls matchs FFVB, en lecture seule', async () => {
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

it('permet à un invité de filtrer les matchs par section puis par équipe', async () => {
  open('/app/planning?semaine=2099-10-12');
  const calendar = await screen.findByRole('region', { name: 'Calendrier de la semaine' });
  await within(calendar).findByRole('link', { name: /LSO Colombes – Paris/ });
  await userEvent.selectOptions(await screen.findByLabelText('Équipe'), 't1');
  expect(within(calendar).getByRole('link', { name: /LSO Colombes – Paris/ })).toBeInTheDocument();
  await userEvent.selectOptions(screen.getByLabelText('Gymnase'), 'g1');
  expect(within(calendar).getByRole('link', { name: /LSO Colombes – Paris/ })).toBeInTheDocument();
  expect(screen.getByLabelText('Légende du calendrier')).toBeInTheDocument();
  await userEvent.selectOptions(screen.getByLabelText('Section'), '');
  await userEvent.selectOptions(screen.getByLabelText('Section'), 's1');
  expect(screen.getByLabelText('Équipe')).toHaveValue('');
  expect(within(calendar).getByRole('link', { name: /LSO Colombes – Paris/ })).toBeInTheDocument();
});

it('envoie un invité vers la connexion pour les sections réservées, puis peut revenir au site', async () => {
  open('/app/messagerie');
  expect(await screen.findByRole('button', { name: 'Se connecter' })).toBeInTheDocument();
  await userEvent.click(screen.getByRole('link', { name: 'Retour au site du club' }));
  expect(await screen.findByRole('heading', { name: 'Bienvenue au LSO Colombes Volley' })).toBeInTheDocument();
});

it('ouvre directement le planning des matchs en invité', async () => {
  open('/app/planning');
  expect(await screen.findByRole('region', { name: 'Calendrier de la semaine' })).toBeInTheDocument();
});

it('montre à un invité le planning des gymnases avec les seuls matchs FFVB', async () => {
  // L’ancienne adresse de l’application Gymnases ouvre l’onglet du Planning.
  const fetchMock = open('/app/gymnases?semaine=2099-10-12');
  expect(await screen.findByRole('heading', { name: 'Planning des gymnases' })).toBeInTheDocument();
  const tabs = screen.getByRole('navigation', { name: 'Planning' });
  expect(within(tabs).getByRole('link', { name: 'Planning des gymnases' })).toHaveAttribute('aria-current', 'page');
  const picker = screen.getByRole('navigation', { name: 'Gymnases' });
  expect(within(picker).getByRole('link', { name: 'Ambroise Paré' })).toHaveAttribute('aria-current', 'page');
  const calendar = await screen.findByRole('region', { name: 'Calendrier de la semaine' });
  expect(await within(calendar).findByRole('link', { name: /LSO Colombes – Paris/ })).toBeInTheDocument();
  const paths = fetchMock.mock.calls.map(([input]) => new URL(String(input), 'http://localhost').pathname);
  expect(paths.filter((path) => !path.endsWith('/auth/me')).every((path) => path.startsWith('/api/v1/public/'))).toBe(true);
  // Retour au planning du club, sur la même semaine.
  expect(within(tabs).getByRole('link', { name: 'Planning du club' })).toHaveAttribute('href', '/app/planning?semaine=2099-10-12&onglet=club');
});

it('laisse un invité envoyer une demande de contact aux administrateurs', async () => {
  const fetchMock = open('/app/contact');
  const form = await screen.findByRole('form', { name: 'Formulaire de contact' });
  // Le formulaire vérifie un moyen de réponse, une équipe et la question avant tout envoi.
  await userEvent.click(within(form).getByRole('button', { name: 'Envoyer' }));
  expect(await within(form).findByText('Indiquez une adresse e-mail ou un téléphone pour notre réponse.')).toBeInTheDocument();
  await userEvent.type(within(form).getByLabelText('Téléphone'), '06 12 34 56 78');
  await userEvent.click(within(form).getByRole('button', { name: 'Envoyer' }));
  expect(await within(form).findByText('Choisissez au moins une équipe concernée.')).toBeInTheDocument();
  expect(within(form).getByText('Seniors')).toBeInTheDocument();
  await userEvent.click(within(form).getByRole('checkbox', { name: 'Seniors M1' }));
  await userEvent.click(within(form).getByRole('button', { name: 'Envoyer' }));
  expect(await within(form).findByText('Écrivez votre question.')).toBeInTheDocument();
  await userEvent.type(within(form).getByLabelText('Votre question'), 'Peut-on faire un essai ?');
  await userEvent.click(within(form).getByRole('button', { name: 'Envoyer' }));
  expect(await screen.findByText('Merci, votre demande a été envoyée. Le club vous répondra dès que possible.')).toBeInTheDocument();
  const posted = fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST');
  expect(posted).toHaveLength(1);
  const [url, init] = posted[0]!;
  expect(String(url)).toContain('/api/v1/contact');
  expect(JSON.parse(String(init?.body))).toEqual({ email: null, phone: '06 12 34 56 78', message: 'Peut-on faire un essai ?', team_ids: ['t1'] });
  // Un invité ne voit pas la liste des demandes reçues.
  expect(screen.queryByRole('region', { name: 'Demandes de contact' })).not.toBeInTheDocument();
});
