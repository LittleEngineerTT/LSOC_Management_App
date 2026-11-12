import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { AuthApp } from '../auth/AuthApp';
import { addDays, mondayOf, nextJuly31, today } from './calendar';

const member = { id: 'm1', username: 'camille', first_name: 'Camille', category: 'adult', roles: ['member'], active: true, email: null, messaging_allowed: true, followed_email: true, referent_email: true, admin_email: true };
const admin = { ...member, id: 'a1', username: 'admin', first_name: 'Alix', roles: ['admin'] };
const day = addDays(mondayOf(today()), 2);
function at(time: string) { return new Date(`${day}T${time}:00+02:00`).toISOString(); }
const training = { id: 'e1', title: 'Entraînement loisir', kind: 'training', section_ids: ['s1'], gymnasium_id: 'g1', location: '', starts_at: at('18:00'), ends_at: at('20:00'), courts: 2, referent_ids: ['m1'], direct_edit: false, cancelled: false, version: 3, series_id: null, exception: false, ffvb_match_id: null, kickoff_at: null, before_minutes: 75, after_minutes: 150, match_courts: 3, occupancy_unknown: false, registration_section_ids: [] as string[], registration_limit: null as number | null, registration_count: 0 };
let account: typeof member;
let routes: Record<string, unknown>;
let mutations: { path: string; method: string; body: unknown }[];
let mutation: (path: string, method: string, body: unknown) => Response;
function reply(body: unknown, status = 200) { return new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }); }
function open(path: string) { render(<MemoryRouter initialEntries={[path]}><AuthApp /></MemoryRouter>); }
beforeAll(() => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value() { this.setAttribute('open', ''); } });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value() { this.removeAttribute('open'); } });
});
afterAll(() => { Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal'); Reflect.deleteProperty(HTMLDialogElement.prototype, 'close'); });
beforeEach(() => {
  account = member;
  mutations = [];
  mutation = () => reply({}, 201);
  routes = {
    '/sections': [{ id: 's1', name: 'Loisir' }],
    '/teams': [{ id: 't1', name: 'Loisir 1', section_id: 's1', referent_ids: ['a1'] }],
    '/gymnasiums': [{ id: 'g1', name: 'Gymnase Ambroise Paré', capacity: 3 }],
    '/follows': [],
    '/users/m1/assignments': [{ id: 'as1', user_id: 'm1', team_id: 't1', kind: 'player' }],
    '/users/a1/assignments': [],
    '/users': [admin, member],
    '/events': [training],
    '/events/e1': { ...training, team_ids: ['t1'] },
    '/profiles/a1': { id: 'a1', first_name: 'Alix', category: 'adult' },
  };
  document.cookie = 'lsoc_csrf=csrf; path=/';
  vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
    const path = new URL(String(input), 'http://localhost').pathname.replace('/api/v1', '');
    const method = init?.method ?? 'GET';
    if (method !== 'GET') {
      // Un fichier déposé est gardé tel quel, avec son nom transmis en en-tête.
      const body: unknown = init?.body instanceof Blob ? { file: init.body, name: new Headers(init.headers).get('X-File-Name') } : init?.body ? JSON.parse(String(init.body)) : undefined;
      mutations.push({ path, method, body });
      return mutation(path, method, body);
    }
    if (path === '/auth/me') return reply(account);
    return reply(path in routes ? routes[path] : []);
  }));
});
afterEach(() => { vi.unstubAllGlobals(); document.cookie = 'lsoc_csrf=; Max-Age=0; path=/'; });

it('affiche la semaine, ouvre le détail, suit l’événement et pose une question privée', async () => {
  mutation = (path) => reply(path.endsWith('/follow') ? { id: 'f1', user_id: 'm1', event_id: 'e1', series_id: null } : { id: 'q1', user_id: 'm1', event_id: 'e1' }, 201);
  open('/app/planning');
  await userEvent.click(await screen.findByRole('link', { name: /Entraînement loisir/ }));
  const dialog = await screen.findByRole('dialog', { name: 'Entraînement loisir' });
  expect(within(dialog).getByText('Gymnase Ambroise Paré')).toBeInTheDocument();
  expect(within(dialog).getByText('Équipes organisatrices').nextElementSibling).toHaveTextContent('Loisir 1');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Ajouter aux favoris' }));
  expect(await within(dialog).findByRole('button', { name: 'Retirer des favoris' })).toHaveAttribute('aria-pressed', 'true');
  await userEvent.type(within(dialog).getByLabelText('Poser une question aux administrateurs'), 'Faut-il apporter un ballon ?');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Envoyer la question' }));
  expect(await within(dialog).findByText('Question envoyée.')).toBeInTheDocument();
  expect(mutations).toEqual([
    { path: '/events/e1/follow', method: 'POST', body: {} },
    { path: '/events/e1/questions', method: 'POST', body: { body: 'Faut-il apporter un ballon ?' } },
  ]);
});

it('un référent sans droit direct envoie une demande avec les seuls champs modifiés', async () => {
  open('/app/planning?event=e1');
  const dialog = await screen.findByRole('dialog', { name: 'Entraînement loisir' });
  await userEvent.click(within(dialog).getByRole('button', { name: 'Proposer une modification' }));
  expect(within(dialog).queryByRole('group', { name: 'Référents' })).not.toBeInTheDocument();
  const courts = within(dialog).getByLabelText('Terrains occupés');
  await userEvent.clear(courts);
  await userEvent.type(courts, '1');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Envoyer la demande' }));
  expect(await within(dialog).findByText(/Demande envoyée aux administrateurs/)).toBeInTheDocument();
  expect(mutations).toEqual([{ path: '/events/e1/change-requests', method: 'POST', body: { base_version: 3, changes: { courts: 1 }, force: false, acknowledge_ffvb: false, description: '' } }]);
});

it('un administrateur crée une série et peut forcer explicitement un dépassement de capacité', async () => {
  account = admin;
  let attempts = 0;
  mutation = (_path, _method, body) => {
    attempts += 1;
    if (!(body as { force: boolean }).force) return reply({ detail: { code: 'capacity_exceeded', events: [{ event_id: 'x', segments: [{ starts_at: at('18:00'), ends_at: at('19:00'), occupied: 4, available: 0, excess: 1 }] }] } }, 409);
    return reply([training, { ...training, id: 'e2' }], 201);
  };
  open('/app/planning');
  await userEvent.click(await screen.findByRole('button', { name: 'Nouvel événement' }));
  await userEvent.type(screen.getByLabelText('Titre'), 'Entraînement compétition');
  await userEvent.click(within(screen.getByRole('group', { name: 'Sections et équipes organisatrices' })).getByLabelText('Loisir'));
  await userEvent.selectOptions(screen.getByLabelText('Gymnase du club'), 'g1');
  expect(screen.queryByLabelText('Fin de la récurrence')).not.toBeInTheDocument();
  await userEvent.click(screen.getByLabelText('Répéter chaque semaine'));
  // Récurrence cochée : les dates laissent place aux jours et aux heures.
  expect(screen.queryByLabelText('Début', { exact: true })).not.toBeInTheDocument();
  expect(screen.getByLabelText('Fin de la récurrence')).toHaveValue(nextJuly31().split('-').reverse().join('/'));
  const weekday = (new Date(`${today()}T12:00:00Z`).getUTCDay() + 6) % 7;
  await userEvent.click(within(screen.getByRole('group', { name: 'Jours de répétition' })).getAllByRole('checkbox')[weekday]!);
  await userEvent.clear(screen.getByLabelText('Fin de la récurrence'));
  await userEvent.type(screen.getByLabelText('Fin de la récurrence'), addDays(today(), 7));
  await userEvent.click(screen.getByRole('button', { name: 'Créer' }));
  expect(await screen.findByText('Capacité dépassée')).toBeInTheDocument();
  await userEvent.click(screen.getByLabelText(/Forcer le dépassement/));
  await userEvent.click(screen.getByRole('button', { name: 'Créer' }));
  expect(await screen.findByText('Série créée : 2 occurrences.')).toBeInTheDocument();
  expect(attempts).toBe(2);
  expect(mutations[1]).toMatchObject({ path: '/series', body: { until: addDays(today(), 7), weekdays: [weekday], force: true, event: { title: 'Entraînement compétition', section_ids: ['s1'], gymnasium_id: 'g1', courts: 1, referent_ids: ['a1'] } } });
});

it('la messagerie affiche les pastilles, marque le fil comme lu sur demande et envoie une réponse', async () => {
  let unreadCount = 1;
  routes['/questions'] = [{ id: 'q1', user_id: 'm1', event_id: 'e1' }];
  routes['/questions/q1/messages'] = [
    { id: 'x1', thread_id: 'q1', author_id: 'm1', body: 'Faut-il un ballon ?', created_at: at('10:00'), read_at: null },
    { id: 'x2', thread_id: 'q1', author_id: 'a1', body: 'Non, merci !', created_at: at('11:00'), read_at: null },
  ];
  Object.defineProperty(routes, '/unread', { enumerable: true, get: () => ({ messages: unreadCount, notifications: 0, threads: unreadCount ? ['q1'] : [], thread_counts: unreadCount ? { q1: unreadCount } : {} }) });
  mutation = (path) => {
    if (path === '/questions/q1/read') unreadCount = 0;
    return reply({}, path.endsWith('/read') ? 204 : 201);
  };
  open('/app/messagerie?thread=q1');
  expect(await screen.findByText('Non, merci !')).toBeInTheDocument();
  const list = screen.getByRole('navigation', { name: 'Conversations' });
  expect(await within(list).findByLabelText('1 réponse non lue')).toBeInTheDocument();
  const menu = screen.getByRole('navigation', { name: 'Applications' });
  expect(within(menu).getByLabelText('1 réponse non lue')).toBeInTheDocument();
  // Ouvrir le fil ne suffit plus : la lecture est explicite.
  expect(mutations).toEqual([]);
  expect(screen.getByText('Non, merci !').closest('li')).toHaveClass('unread');
  await userEvent.click(screen.getByRole('button', { name: 'Marquer comme lu' }));
  await waitFor(() => expect(within(list).queryByLabelText('1 réponse non lue')).not.toBeInTheDocument());
  expect(within(menu).queryByLabelText('1 réponse non lue')).not.toBeInTheDocument();
  await userEvent.type(screen.getByLabelText('Votre message'), 'Parfait');
  await userEvent.click(screen.getByRole('button', { name: 'Envoyer' }));
  await waitFor(() => expect(mutations).toContainEqual({ path: '/questions/q1/messages', method: 'POST', body: { body: 'Parfait' } }));
  expect(mutations[0]).toEqual({ path: '/questions/q1/read', method: 'POST', body: {} });
});

it('la messagerie marque toutes les questions comme lues', async () => {
  account = admin;
  let unreadCount = 2;
  routes['/questions'] = [{ id: 'q1', user_id: 'm1', event_id: 'e1' }];
  routes['/questions/q1/messages'] = [];
  Object.defineProperty(routes, '/unread', { enumerable: true, get: () => ({ messages: unreadCount, notifications: 0, threads: unreadCount ? ['q1'] : [], thread_counts: unreadCount ? { q1: unreadCount } : {} }) });
  mutation = () => {
    unreadCount = 0;
    return reply({}, 204);
  };
  open('/app/messagerie');
  const list = await screen.findByRole('navigation', { name: 'Conversations' });
  expect(await within(list).findByLabelText('2 questions non lues')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Tout marquer comme lu' }));
  await waitFor(() => expect(within(list).queryByLabelText('2 questions non lues')).not.toBeInTheDocument());
  expect(mutations).toEqual([{ path: '/questions/read', method: 'POST', body: {} }]);
  expect(screen.queryByRole('button', { name: 'Tout marquer comme lu' })).not.toBeInTheDocument();
});

it('les gymnases signalent un dépassement et mes équipes présentent mon rôle', async () => {
  routes['/gymnasiums/g1/availability'] = { gymnasium_id: 'g1', capacity: 3, segments: [{ starts_at: at('18:00'), ends_at: at('19:00'), occupied: 4, available: 0, excess: 1 }] };
  // L’ancienne adresse de l’application Gymnases ouvre l’onglet du Planning.
  open('/app/gymnases');
  // Le jour du créneau est parfois aujourd’hui : il paraît alors aussi dans la journée sélectionnée.
  expect((await screen.findAllByText('Complet · 1 terrain en excès')).length).toBeGreaterThan(0);
  const tabs = screen.getByRole('navigation', { name: 'Planning' });
  expect(within(tabs).getByRole('link', { name: 'Planning des gymnases' })).toHaveAttribute('aria-current', 'page');
  expect(within(screen.getByRole('navigation', { name: 'Applications' })).queryByRole('link', { name: 'Gymnases' })).not.toBeInTheDocument();
  await userEvent.click(within(tabs).getByRole('link', { name: 'Planning du club' }));
  expect(await screen.findByRole('heading', { name: 'Planning du club' })).toBeInTheDocument();
  await userEvent.click(within(tabs).getByRole('link', { name: 'Planning des gymnases' }));
  expect((await screen.findAllByText('Complet · 1 terrain en excès')).length).toBeGreaterThan(0);
  await userEvent.click(screen.getByRole('link', { name: 'Mes équipes' }));
  const card = (await screen.findByRole('heading', { name: 'Loisir 1' })).closest('section')!;
  expect(within(card).getByText('Joueur')).toBeInTheDocument();
  await waitFor(() => expect(card).toHaveTextContent('Référents de l’équipe : Alix'));
  expect(await within(card).findByRole('link', { name: 'Entraînement loisir' })).toBeInTheDocument();
  expect(within(card).getByRole('link', { name: 'Planning de l’équipe' })).toHaveAttribute('href', '/app/planning?equipe=t1');
});

it('un adhérent demande à s’inscrire avec son poste présélectionné et un message', async () => {
  const later = new Date(Date.now() + 14 * 86_400_000).toISOString();
  const openSession = { ...training, id: 'e2', title: 'Séance ouverte', referent_ids: ['a1'], starts_at: later, ends_at: new Date(Date.parse(later) + 7_200_000).toISOString(), registration_section_ids: ['s1'], registration_limit: 2, registration_count: 1 };
  routes['/positions'] = [{ id: 'p1', name: 'Libéro' }, { id: 'p2', name: 'Passeur' }];
  routes['/users/m1/assignments'] = [{ id: 'as1', user_id: 'm1', team_id: 't1', kind: 'player', position_id: 'p2' }];
  routes['/events/e2'] = openSession;
  routes['/events/e2/registrations'] = { event_id: 'e2', open: true, limit: 2, count: 1, pending: 0, registered: false, status: null, decision: '', eligible: true, participants: null };
  mutation = (path) => {
    routes['/events/e2/registrations'] = { event_id: 'e2', open: true, limit: 2, count: 1, pending: 1, registered: false, status: 'pending', decision: '', eligible: true, participants: null };
    return reply({ id: 'r1', user_id: 'm1', event_id: 'e2', status: 'pending', position_id: 'p2', message: 'Première fois', decision: '', decided_at: null, created_at: later }, path.endsWith('/registration') ? 201 : 404);
  };
  open('/app/planning?event=e2');
  const dialog = await screen.findByRole('dialog', { name: 'Séance ouverte' });
  expect(await within(dialog).findByText('1 inscrit sur 2')).toBeInTheDocument();
  await userEvent.click(within(dialog).getByRole('button', { name: 'Demander l’inscription' }));
  expect(within(dialog).getByLabelText(/Poste pour lequel vous voulez vous entraîner/)).toHaveValue('p2');
  await userEvent.type(within(dialog).getByLabelText(/Message/), 'Première fois');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Envoyer la demande' }));
  expect(await within(dialog).findByText('Demande en attente')).toBeInTheDocument();
  expect(within(dialog).getByText(/1 demande en attente/)).toBeInTheDocument();
  expect(within(dialog).getByRole('button', { name: 'Annuler la demande' })).toBeEnabled();
  expect(mutations).toEqual([{ path: '/events/e2/registration', method: 'POST', body: { position_id: 'p2', message: 'Première fois' } }]);
});

it('le référent accepte une demande en attente en voyant le poste et le message', async () => {
  account = admin;
  const later = new Date(Date.now() + 14 * 86_400_000).toISOString();
  routes['/positions'] = [{ id: 'p2', name: 'Passeur' }];
  routes['/events/e2'] = { ...training, id: 'e2', title: 'Séance ouverte', referent_ids: ['a1'], starts_at: later, ends_at: new Date(Date.parse(later) + 7_200_000).toISOString(), registration_section_ids: ['s1'], registration_limit: 2, registration_count: 0 };
  routes['/events/e2/registrations'] = { event_id: 'e2', open: true, limit: 2, count: 0, pending: 1, registered: false, status: null, decision: '', eligible: false, participants: [{ user_id: 'm1', first_name: 'Morgan', created_at: later, status: 'pending', position_id: 'p2', message: 'Première fois' }] };
  mutation = () => reply({}, 200);
  open('/app/planning?event=e2');
  const dialog = await screen.findByRole('dialog', { name: 'Séance ouverte' });
  expect(await within(dialog).findByText(/Morgan · Passeur/)).toBeInTheDocument();
  expect(within(dialog).getByText('« Première fois »')).toBeInTheDocument();
  await userEvent.click(within(dialog).getByRole('button', { name: 'Traiter' }));
  await userEvent.selectOptions(within(dialog).getByLabelText('Décision'), 'yes');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Enregistrer la décision' }));
  await waitFor(() => expect(mutations).toEqual([{ path: '/events/e2/registrations/m1/decision', method: 'POST', body: { accept: true, reason: '' } }]));
});

it('une séance complète ou réservée à une autre section n’accepte pas d’inscription', async () => {
  const later = new Date(Date.now() + 14 * 86_400_000).toISOString();
  routes['/events/e2'] = { ...training, id: 'e2', title: 'Séance ouverte', starts_at: later, ends_at: new Date(Date.parse(later) + 7_200_000).toISOString(), registration_section_ids: ['s1'], registration_limit: 1, registration_count: 1 };
  routes['/events/e2/registrations'] = { event_id: 'e2', open: true, limit: 1, count: 1, registered: false, eligible: true, participants: [] };
  open('/app/planning?event=e2');
  const dialog = await screen.findByRole('dialog', { name: 'Séance ouverte' });
  expect(await within(dialog).findByRole('button', { name: 'Séance complète' })).toBeDisabled();
  routes['/events/e2/registrations'] = { event_id: 'e2', open: true, limit: 1, count: 0, registered: false, eligible: false, participants: null };
  await userEvent.click(within(dialog).getByRole('button', { name: 'Fermer' }));
  open('/app/planning?event=e2');
  const other = (await screen.findAllByRole('dialog', { name: 'Séance ouverte' })).at(-1)!;
  expect(await within(other).findByText(/réservées aux adhérents des sections indiquées/)).toBeInTheDocument();
  expect(within(other).queryByRole('button', { name: 'Demander l’inscription' })).not.toBeInTheDocument();
});

it('un administrateur ouvre une séance en fixant obligatoirement une limite', async () => {
  account = admin;
  mutation = () => reply(training, 201);
  open('/app/planning');
  await userEvent.click(await screen.findByRole('button', { name: 'Nouvel événement' }));
  await userEvent.type(screen.getByLabelText('Titre'), 'Séance découverte');
  await userEvent.click(within(screen.getByRole('group', { name: 'Sections et équipes organisatrices' })).getByLabelText('Loisir'));
  await userEvent.click(within(screen.getByRole('group', { name: 'Ouvert aux inscriptions' })).getByLabelText('Loisir'));
  await userEvent.click(screen.getByRole('button', { name: 'Créer' }));
  expect(await screen.findByText(/Indiquez le nombre maximal d’inscrits/)).toBeInTheDocument();
  expect(mutations).toEqual([]);
  await userEvent.type(screen.getByLabelText('Nombre maximal d’inscrits'), '12');
  await userEvent.click(screen.getByRole('button', { name: 'Créer' }));
  await waitFor(() => expect(mutations).toHaveLength(1));
  expect(mutations[0]).toMatchObject({ path: '/events', body: { registration_section_ids: ['s1'], registration_limit: 12 } });
});

it('la cloche du bandeau porte la pastille des notifications et retire une notification lue', async () => {
  let notifications = 2;
  routes['/notifications'] = [
    { id: 'n1', kind: 'question', title: 'Question sur : Entraînement loisir', event_id: 'e1', read_at: null, created_at: at('10:00') },
    { id: 'n2', kind: 'event_changed', title: 'Événement modifié : Entraînement loisir', event_id: 'e1', read_at: null, created_at: at('11:00') },
  ];
  Object.defineProperty(routes, '/unread', { enumerable: true, get: () => ({ messages: 3, notifications, threads: ['q1'] }) });
  mutation = (path) => {
    notifications -= 1;
    routes['/notifications'] = (routes['/notifications'] as { id: string }[]).filter((item) => !path.includes(item.id));
    return reply({}, 200);
  };
  open('/app');
  const menu = await screen.findByRole('navigation', { name: 'Applications' });
  expect(await within(menu).findByLabelText('3 réponses non lues')).toBeInTheDocument();
  // Les notifications ne sont plus dans le menu ni sur l’accueil, mais sous la cloche.
  expect(within(menu).queryByLabelText(/notifications? non lues?/)).not.toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: /Notifications/ })).not.toBeInTheDocument();
  const bell = screen.getByRole('button', { name: 'Notifications' });
  expect(await within(bell).findByLabelText('2 notifications non lues')).toBeInTheDocument();
  await userEvent.click(bell);
  const panel = screen.getByRole('region', { name: 'Notifications' });
  const item = await within(panel).findByText('Événement modifié : Entraînement loisir');
  await userEvent.click(within(item.closest('li')!).getByRole('button', { name: 'Marquer comme lu' }));
  await waitFor(() => expect(within(panel).queryByText('Événement modifié : Entraînement loisir')).not.toBeInTheDocument());
  expect(await within(bell).findByLabelText('1 notification non lue')).toBeInTheDocument();
  expect(mutations).toEqual([{ path: '/notifications/n2/read', method: 'POST', body: {} }]);
  await userEvent.keyboard('{Escape}');
  expect(screen.queryByRole('region', { name: 'Notifications' })).not.toBeInTheDocument();
  expect(bell).toHaveFocus();
});

it('une notification lue se remet en non lue depuis la cloche', async () => {
  let notifications = 0;
  routes['/notifications'] = [
    { id: 'n1', kind: 'event_changed', title: 'Événement modifié : Entraînement loisir', event_id: 'e1', read_at: at('10:30'), created_at: at('10:00') },
  ];
  Object.defineProperty(routes, '/unread', { enumerable: true, configurable: true, get: () => ({ messages: 0, notifications, threads: [] }) });
  mutation = () => {
    notifications += 1;
    routes['/notifications'] = [{ ...(routes['/notifications'] as object[])[0], read_at: null }];
    return reply({}, 200);
  };
  open('/app');
  await userEvent.click(await screen.findByRole('button', { name: 'Notifications' }));
  const panel = screen.getByRole('region', { name: 'Notifications' });
  await userEvent.click(await within(panel).findByLabelText('Tout afficher'));
  const item = within(panel).getByText('Événement modifié : Entraînement loisir').closest('li')!;
  await userEvent.click(within(item).getByRole('button', { name: 'Marquer comme non lu' }));
  expect(await within(panel).findByRole('button', { name: 'Marquer comme lu' })).toBeInTheDocument();
  expect(within(panel).queryByText('Déjà lues')).not.toBeInTheDocument();
  expect(mutations).toEqual([{ path: '/notifications/n1/read', method: 'DELETE', body: undefined }]);
  expect(await within(screen.getByRole('button', { name: 'Notifications' })).findByLabelText('1 notification non lue')).toBeInTheDocument();
});

it('un administrateur crée un entraînement les mardis et jeudis jusqu’à la date choisie', async () => {
  account = admin;
  mutation = () => reply([training], 201);
  open('/app/planning');
  await userEvent.click(await screen.findByRole('button', { name: 'Nouvel événement' }));
  await userEvent.type(screen.getByLabelText('Titre'), 'Entraînement loisir');
  await userEvent.click(within(screen.getByRole('group', { name: 'Sections et équipes organisatrices' })).getByLabelText('Loisir'));
  await userEvent.click(screen.getByLabelText('Répéter chaque semaine'));
  const days = screen.getByRole('group', { name: 'Jours de répétition' });
  await userEvent.click(within(days).getByLabelText('Jeudi'));
  await userEvent.click(within(days).getByLabelText('Mardi'));
  await userEvent.click(screen.getByRole('button', { name: 'Créer' }));
  await waitFor(() => expect(mutations).toHaveLength(1));
  expect(mutations[0]).toMatchObject({ path: '/series', body: { weekdays: [1, 3], until: nextJuly31(day > today() ? day : today()) } });
});

it('un administrateur supprime une occurrence et les suivantes de la série', async () => {
  account = admin;
  routes['/events/e1'] = { ...training, series_id: 'serie' };
  mutation = () => reply({}, 204);
  open('/app/planning?event=e1');
  const dialog = await screen.findByRole('dialog', { name: 'Entraînement loisir' });
  await userEvent.click(within(dialog).getByRole('button', { name: 'Supprimer' }));
  const confirm = await screen.findByRole('dialog', { name: /Supprimer « Entraînement loisir »/ });
  await userEvent.click(within(confirm).getByLabelText('Cet événement et tous les suivants de la série'));
  await userEvent.click(within(confirm).getByRole('button', { name: 'Supprimer' }));
  await waitFor(() => expect(mutations).toEqual([{ path: '/events/e1', method: 'DELETE', body: undefined }]));
  expect(vi.mocked(fetch).mock.calls.some(([input]) => String(input).includes('/events/e1?scope=following'))).toBe(true);
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Entraînement loisir' })).not.toBeInTheDocument());
});

it('un administrateur annule un événement avec un motif affiché tout en haut de la fiche', async () => {
  account = admin;
  routes['/events/e1'] = { ...training, cancelled: true, cancel_reason: 'unavailability', cancel_note: 'Travaux' };
  open('/app/planning?event=e1');
  const dialog = await screen.findByRole('dialog', { name: 'Entraînement loisir' });
  const reason = await within(dialog).findByText(/Gymnase indisponible : Travaux/);
  const badge = within(dialog).getByText('Annulé');
  expect(reason.compareDocumentPosition(badge) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(within(dialog).getByRole('button', { name: 'Rétablir' })).toBeInTheDocument();
});

it('un administrateur annule un événement actif en choisissant la capacité comme motif', async () => {
  account = admin;
  mutation = () => reply({ ...training, cancelled: true, cancel_reason: 'capacity' });
  open('/app/planning?event=e1');
  const dialog = await screen.findByRole('dialog', { name: 'Entraînement loisir' });
  await userEvent.click(await within(dialog).findByRole('button', { name: 'Annuler l’événement' }));
  const confirm = await screen.findByRole('dialog', { name: /Annuler « Entraînement loisir »/ });
  await userEvent.click(within(confirm).getByLabelText('Motif : capacité du gymnase dépassée'));
  await userEvent.click(within(confirm).getByRole('button', { name: 'Annuler l’événement' }));
  await waitFor(() => expect(mutations).toEqual([{ path: '/events/e1/cancellation', method: 'POST', body: { base_version: 3, reason: 'capacity' } }]));
});

it('le panneau présente les 20 dernières notifications, non lues d’abord, les lues masquées', async () => {
  const requested: string[] = [];
  routes['/notifications'] = [
    { id: 'n1', kind: 'event_changed', title: 'Non lue récente', event_id: null, read_at: null, created_at: at('12:00') },
    { id: 'n2', kind: 'event_changed', title: 'Non lue ancienne', event_id: null, read_at: null, created_at: at('08:00') },
    { id: 'n3', kind: 'license', title: 'Lue ancienne', event_id: null, read_at: at('09:00'), created_at: at('07:00') },
    { id: 'n4', kind: 'license', title: 'Lue récente', event_id: null, read_at: at('11:00'), created_at: at('10:00') },
  ];
  let notifications = 2;
  Object.defineProperty(routes, '/unread', { enumerable: true, get: () => ({ messages: 0, notifications, threads: [] }) });
  const fetcher = fetch;
  vi.stubGlobal('fetch', vi.fn<typeof fetch>((input, init) => { requested.push(String(input)); return fetcher(input, init); }));
  mutation = (path) => {
    notifications -= 1;
    for (const item of routes['/notifications'] as { id: string; read_at: string | null }[]) if (path.includes(item.id)) item.read_at = at('13:00');
    return reply({}, 200);
  };
  open('/app');
  await userEvent.click(await screen.findByRole('button', { name: 'Notifications' }));
  const panel = screen.getByRole('region', { name: 'Notifications' });
  await within(panel).findByText('Non lue récente');
  expect(requested.some((url) => url.includes('/notifications?unread_first=true&limit=20'))).toBe(true);
  // Les lues sont masquées par défaut.
  expect(within(panel).getAllByRole('listitem').map((item) => item.querySelector('.notifications-title')?.textContent)).toEqual(['Non lue récente', 'Non lue ancienne']);
  expect(within(panel).getByText('2 déjà lues')).toBeInTheDocument();
  await userEvent.click(within(panel).getByRole('checkbox', { name: 'Tout afficher' }));
  expect(within(panel).getAllByRole('listitem').map((item) => item.querySelector('.notifications-title')?.textContent)).toEqual(['Non lue récente', 'Non lue ancienne', 'Lue récente', 'Lue ancienne']);
  expect(within(panel).getAllByRole('button', { name: 'Marquer comme lu' })).toHaveLength(2);
  await userEvent.click(within(panel).getByRole('checkbox', { name: 'Tout afficher' }));
  await userEvent.click(within(panel).getByRole('button', { name: 'Tout marquer comme lu' }));
  expect(await within(panel).findByText('Aucune nouvelle notification.')).toBeInTheDocument();
  expect(within(panel).queryAllByRole('listitem')).toHaveLength(0);
  expect(within(panel).getByText('4 déjà lues')).toBeInTheDocument();
});

it('chaque notification mène à son action : examen d’une demande ou message de l’admin', async () => {
  routes['/notifications'] = [
    { id: 'n1', kind: 'decision', title: 'Modification refusée : Entraînement loisir', body: 'Gymnase indisponible.', link: '/app/messagerie?thread=q9', event_id: 'e1', read_at: null, created_at: at('10:00') },
    { id: 'n2', kind: 'license', title: 'Licence : Active', body: '', link: '/app/profil', event_id: null, read_at: null, created_at: at('11:00') },
  ];
  open('/app/notre-club');
  await userEvent.click(await screen.findByRole('button', { name: 'Notifications' }));
  const panel = screen.getByRole('region', { name: 'Notifications' });
  expect(await within(panel).findByText('Gymnase indisponible.')).toBeInTheDocument();
  expect(within(panel).getByRole('link', { name: 'Voir le message' })).toHaveAttribute('href', '/app/messagerie?thread=q9');
  expect(within(panel).getByRole('link', { name: 'Licence : Active' })).toHaveAttribute('href', '/app/profil');
  // Suivre une notification referme le panneau sans la marquer comme lue.
  await userEvent.click(within(panel).getByRole('link', { name: 'Licence : Active' }));
  expect(screen.queryByRole('region', { name: 'Notifications' })).not.toBeInTheDocument();
  expect(mutations).toEqual([]);
});

it('la messagerie supprime une conversation après confirmation', async () => {
  routes['/questions'] = [{ id: 'q9', user_id: 'm1', event_id: null, subject: 'Demande d’événement : Stage' }];
  routes['/questions/q9/messages'] = [{ id: 'x9', thread_id: 'q9', author_id: 'a1', body: 'Créneau déjà pris.', created_at: at('10:00'), read_at: null }];
  mutation = (path, method) => {
    if (path === '/questions/q9' && method === 'DELETE') routes['/questions'] = [];
    return reply({}, 204);
  };
  open('/app/messagerie?thread=q9');
  await userEvent.click(await screen.findByRole('button', { name: 'Supprimer' }));
  const dialog = await screen.findByRole('dialog', { name: 'Supprimer la conversation « Demande d’événement : Stage » ?' });
  expect(within(dialog).getByText(/Elle reste visible pour les administrateurs/)).toBeInTheDocument();
  await userEvent.click(within(dialog).getByRole('button', { name: 'Supprimer la conversation' }));
  await waitFor(() => expect(mutations).toContainEqual({ path: '/questions/q9', method: 'DELETE', body: undefined }));
  expect(await screen.findByText(/Aucune question pour le moment/)).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Demande d’événement : Stage' })).not.toBeInTheDocument();
});

it('la messagerie affiche une conversation sans événement par son sujet', async () => {
  routes['/questions'] = [{ id: 'q9', user_id: 'm1', event_id: null, subject: 'Demande d’événement : Stage' }];
  routes['/questions/q9/messages'] = [{ id: 'x9', thread_id: 'q9', author_id: 'a1', body: 'Demande refusée : Stage\n\nCréneau déjà pris.', created_at: at('10:00'), read_at: null }];
  open('/app/messagerie?thread=q9');
  expect(await screen.findByRole('heading', { name: 'Demande d’événement : Stage' })).toBeInTheDocument();
  expect(await screen.findByText(/Créneau déjà pris/)).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Voir l’événement' })).not.toBeInTheDocument();
});

it('le coach référent supprime son événement ; un simple adhérent ne voit pas le bouton', async () => {
  routes['/events/e1'] = { ...training, referent_ids: ['m1'] };
  open('/app/planning?event=e1');
  let dialog = await screen.findByRole('dialog', { name: 'Entraînement loisir' });
  expect(within(dialog).queryByRole('button', { name: 'Supprimer' })).not.toBeInTheDocument();
  cleanup();
  account = { ...member, roles: ['member', 'coach'] };
  mutation = () => new Response(null, { status: 204 });
  open('/app/planning?event=e1');
  dialog = await screen.findByRole('dialog', { name: 'Entraînement loisir' });
  await userEvent.click(within(dialog).getByRole('button', { name: 'Supprimer' }));
  await userEvent.click(within(screen.getByRole('dialog', { name: /Supprimer « Entraînement loisir »/ })).getByRole('button', { name: 'Supprimer' }));
  await waitFor(() => expect(mutations).toContainEqual(expect.objectContaining({ path: '/events/e1', method: 'DELETE' })));
});

const license = (user_id: string, first_name: string, status: string, team_id: string) => ({ user_id, first_name, username: user_id, number: status === 'active' ? `L-${user_id}` : null, status, coach_status: 'none', updated_at: null, teams: [{ team_id, kind: 'player' }], coach: false, missing: status !== 'active' });

it('l’onglet Demandes montre d’abord les joueurs non inscrits, par équipe, section et étape', async () => {
  account = admin;
  routes['/sections'] = [{ id: 's1', name: 'Loisir' }, { id: 's2', name: 'Compétition' }, { id: 's3', name: 'Jeunes' }];
  routes['/teams'] = [{ id: 't1', name: 'Loisir 1', section_id: 's1', referent_ids: [] }, { id: 't2', name: 'Régionale', section_id: 's2', referent_ids: [] }];
  routes['/licenses'] = [license('u1', 'Andréa', 'none', 't1'), license('u2', 'Bao', 'payment_pending', 't2'), license('u3', 'Chloé', 'active', 't1'), { ...license('u4', 'Dominique', 'none', 't1'), teams: [{ team_id: 't1', kind: 'coach' }] }];
  open('/app/inscriptions');
  expect(await screen.findByRole('heading', { name: 'Demandes' })).toBeInTheDocument();
  const loisir = await screen.findByRole('region', { name: 'Loisir 1' });
  expect(within(loisir).getByText('Andréa')).toBeInTheDocument();
  expect(within(loisir).getByText('Pas de licence · étape 1/4')).toBeInTheDocument();
  expect(screen.getByRole('region', { name: 'Régionale' })).toHaveTextContent('Paiement en attente · étape 3/4');
  // Un coach rattaché n’est pas un joueur ; un joueur actif est inscrit.
  expect(screen.queryByText('Dominique')).not.toBeInTheDocument();
  expect(screen.queryByText('Chloé')).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Inscrits (1)' }));
  expect(within(await screen.findByRole('region', { name: 'Loisir 1' })).getByText('Chloé')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Paiement en attente (1)' }));
  expect(screen.getByRole('region', { name: 'Régionale' })).toHaveTextContent('Bao');
  await userEvent.click(screen.getByRole('button', { name: 'Tous (3)' }));
  await userEvent.selectOptions(screen.getByLabelText('Regrouper par'), 'section');
  expect(screen.getByRole('region', { name: 'Loisir' })).toHaveTextContent(/Andréa.*Chloé/);
  await userEvent.selectOptions(screen.getByLabelText('Section'), 's2');
  expect(screen.queryByRole('region', { name: 'Loisir' })).not.toBeInTheDocument();
  expect(screen.getByRole('region', { name: 'Compétition' })).toHaveTextContent('Bao · Régionale');
});

it('un adhérent sans rôle coach n’accède pas à l’onglet Demandes', async () => {
  open('/app/inscriptions');
  expect(await screen.findByRole('heading', { name: 'Accueil' })).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Demandes' })).not.toBeInTheDocument();
});

const dossier = { id: 'd1', user_id: 'u1', first_name: 'Andréa', opened_by: 'a1', note: 'Avant la reprise', payment_requested: true, payment_validated_at: null, created_at: at('10:00'), closed_at: null, documents: [{ id: 'doc-med', kind: 'medical_certificate', label: '', status: 'submitted', file_name: 'certificat.pdf', uploaded_at: at('11:00'), decision: '', has_file: true }, { id: 'doc-id', kind: 'identity', label: '', status: 'requested', file_name: null, uploaded_at: null, decision: '', has_file: false }] };

it('l’encadrement demande des pièces à un joueur puis traite son dossier', async () => {
  account = admin;
  routes['/licenses'] = [license('u1', 'Andréa', 'none', 't1'), license('u2', 'Bao', 'in_progress', 't1')];
  routes['/dossiers'] = [dossier];
  mutation = () => reply(dossier, 201);
  open('/app/inscriptions');
  const team = await screen.findByRole('region', { name: 'Loisir 1' });
  expect(within(team).getByText('Dossier · 0/3')).toBeInTheDocument();
  await userEvent.click(within(team).getByRole('button', { name: 'Demander des pièces' }));
  await userEvent.click(within(team).getByLabelText('Certificat médical'));
  await userEvent.click(within(team).getByLabelText('Justificatif de réduction'));
  await userEvent.type(within(team).getByLabelText(/Message au joueur/), 'Merci');
  await userEvent.click(within(team).getByRole('button', { name: 'Envoyer la demande' }));
  expect(await screen.findByText('Demande envoyée à Bao.')).toBeInTheDocument();
  expect(mutations).toEqual([{ path: '/dossiers', method: 'POST', body: { user_id: 'u2', documents: [{ kind: 'medical_certificate' }, { kind: 'reduction_proof' }], payment: false, note: 'Merci' } }]);
  // La liste rechargée remplace la région affichée.
  const reloaded = await screen.findByRole('region', { name: 'Loisir 1' });
  await userEvent.click(within(reloaded).getByRole('button', { name: 'Dossier' }));
  expect(within(reloaded).getByRole('link', { name: 'Ouvrir' })).toHaveAttribute('href', '/api/v1/dossiers/d1/documents/doc-med/file');
  await userEvent.click(within(reloaded).getByRole('button', { name: 'Valider' }));
  await userEvent.click(await within(await screen.findByRole('region', { name: 'Loisir 1' })).findByRole('button', { name: 'Valider le paiement' }));
  await waitFor(() => expect(mutations.slice(1)).toEqual([
    { path: '/dossiers/d1/documents/doc-med/decision', method: 'POST', body: { accept: true, reason: '' } },
    { path: '/dossiers/d1/payment', method: 'POST', body: {} },
  ]));
});

it('un coach suit le dossier sans ouvrir ni valider les pièces', async () => {
  account = { ...member, roles: ['member', 'coach'] };
  routes['/licenses'] = [license('u1', 'Andréa', 'none', 't1')];
  routes['/dossiers'] = [dossier];
  open('/app/inscriptions');
  const team = await screen.findByRole('region', { name: 'Loisir 1' });
  await userEvent.click(within(team).getByRole('button', { name: 'Dossier' }));
  expect(within(team).getByText('Déposée, en vérification')).toBeInTheDocument();
  expect(within(team).queryByRole('link', { name: 'Ouvrir' })).not.toBeInTheDocument();
  expect(within(team).queryByRole('button', { name: 'Valider' })).not.toBeInTheDocument();
  expect(within(team).queryByRole('button', { name: 'Clore le dossier' })).not.toBeInTheDocument();
  // Sa demande de pièces part aux administrateurs, pièce « Autre » nommée comprise.
  mutation = () => reply({}, 201);
  await userEvent.click(within(team).getByRole('button', { name: 'Compléter' }));
  await userEvent.click(within(team).getByLabelText('Justificatif de réduction'));
  await userEvent.click(within(team).getByLabelText('Autre pièce'));
  await userEvent.type(within(team).getByLabelText('Nom de la pièce'), 'Autorisation parentale');
  await userEvent.type(within(team).getByLabelText(/Description/), 'Nouveau joueur');
  await userEvent.click(within(team).getByRole('button', { name: 'Envoyer aux administrateurs' }));
  expect(await screen.findByText('Demande transmise aux administrateurs pour Andréa.')).toBeInTheDocument();
  expect(mutations).toEqual([{ path: '/requests', method: 'POST', body: { kind: 'document', player_id: 'u1', documents: [{ kind: 'reduction_proof' }, { kind: 'other', label: 'Autorisation parentale' }], description: 'Nouveau joueur' } }]);
});

it('un joueur avec un dossier en cours accède à l’application et dépose une pièce', async () => {
  routes['/dossiers/me'] = { ...dossier, user_id: 'm1', first_name: 'Camille', documents: [{ ...dossier.documents[1] }, { id: 'doc-qr', kind: 'reduction_proof', label: '', status: 'rejected', file_name: 'qr.png', uploaded_at: at('11:00'), decision: 'Code expiré', has_file: true }] };
  mutation = () => reply(routes['/dossiers/me']);
  open('/app');
  await userEvent.click(await screen.findByRole('link', { name: 'Demandes 2 pièces à déposer' }));
  expect(await screen.findByRole('heading', { name: 'Mon inscription' })).toBeInTheDocument();
  // Le titre de la page précède le chargement du dossier : on attend son contenu.
  expect(await screen.findByRole('heading', { name: 'Étapes terminées : 0/3' })).toBeInTheDocument();
  expect(screen.getByText('Message du club : Avant la reprise')).toBeInTheDocument();
  expect(screen.getByText('Motif : Code expiré')).toBeInTheDocument();
  expect(screen.getByText('En attente')).toBeInTheDocument();
  const file = new File(['%PDF-1.7'], 'carte d’identité.pdf', { type: 'application/pdf' });
  await userEvent.upload(screen.getByLabelText('Fichier : Carte d’identité ou passeport'), file);
  expect(await screen.findByText('Carte d’identité ou passeport déposé.')).toBeInTheDocument();
  expect(mutations).toEqual([{ path: '/dossiers/d1/documents/doc-id/file', method: 'PUT', body: { file, name: 'carte%20d%E2%80%99identit%C3%A9.pdf' } }]);
});

it('un événement à plusieurs référents les présente tous et reconnaît chacun', async () => {
  routes['/events/e1'] = { ...training, team_ids: ['t1'], referent_ids: ['a1', 'm1'] };
  open('/app/planning?event=e1');
  const dialog = await screen.findByRole('dialog', { name: 'Entraînement loisir' });
  const referents = within(dialog).getByText('Référents').nextElementSibling!;
  await waitFor(() => expect(referents).toHaveTextContent('Alix, Camille'));
  expect(within(dialog).getByRole('button', { name: /Modifier|Proposer une modification/ })).toBeInTheDocument();
});

const coach = { ...member, roles: ['member', 'coach'] };
const staffRequest = { id: 'r1', kind: 'document', title: 'Pièces à demander à Andréa', description: 'Nouveau joueur', event_id: null, actor_id: 'm1', actor_name: 'Camille', status: 'pending', decision: '', decider_name: null, decided_at: null, created_at: at('09:00'), thread_id: 'th1', player_id: 'u1', documents: [{ kind: 'medical_certificate', label: '' }, { kind: 'other', label: 'Autorisation parentale' }], link: '/app/messagerie?thread=th1' };

it('un coach suit ses demandes et en ouvre une nouvelle depuis la messagerie', async () => {
  account = coach;
  routes['/requests'] = [staffRequest, { ...staffRequest, id: 'c1', kind: 'event_change', title: 'Modification : Entraînement loisir', thread_id: null, player_id: null, documents: [], description: 'Gymnase fermé plus tôt', link: '/app/administration?tab=requests&demande=c1' }];
  mutation = () => reply({ ...staffRequest, kind: 'other' }, 201);
  open('/app/messagerie');
  await userEvent.click(await screen.findByRole('button', { name: 'Demandes' }));
  const list = await screen.findByRole('region', { name: 'Demandes' });
  expect(await within(list).findByText('Pièces à demander à Andréa')).toBeInTheDocument();
  expect(within(list).getByText(/Pièces : Certificat médical, Autorisation parentale\. Nouveau joueur/)).toBeInTheDocument();
  expect(within(list).getByText('Modification d’événement')).toBeInTheDocument();
  expect(within(list).getByRole('link', { name: 'Conversation' })).toHaveAttribute('href', '/app/messagerie?thread=th1');
  expect(within(list).queryByRole('button', { name: 'Décider' })).not.toBeInTheDocument();
  await userEvent.click(within(list).getByRole('button', { name: 'Nouvelle demande' }));
  await userEvent.type(within(list).getByLabelText(/Titre/), 'Ballons neufs');
  await userEvent.type(within(list).getByLabelText('Description'), 'Pour la reprise');
  await userEvent.click(within(list).getByRole('button', { name: 'Envoyer aux administrateurs' }));
  expect(await within(list).findByText(/la conversation est ouverte dans la messagerie/)).toBeInTheDocument();
  expect(mutations).toEqual([{ path: '/requests', method: 'POST', body: { kind: 'other', title: 'Ballons neufs', description: 'Pour la reprise', event_id: null } }]);
});

it('une nouvelle demande porte une pastille sur la messagerie, levée seulement en la marquant comme lue', async () => {
  account = coach;
  let requests = 2;
  routes['/requests'] = [staffRequest];
  routes['/notifications'] = [{ id: 'nr1', kind: 'event_request', title: 'Demande enregistrée : Stage', link: '/app/administration?tab=requests&type=events&demande=c1', event_id: null, read_at: null, created_at: at('10:00') }];
  Object.defineProperty(routes, '/unread', { enumerable: true, get: () => ({ messages: 1, notifications: requests + 1, threads: ['q1'], thread_counts: { q1: 1 }, requests }) });
  mutation = (path) => {
    if (path === '/notifications/nr1/read') requests -= 1;
    return reply({}, 200);
  };
  open('/app/messagerie');
  const menu = await screen.findByRole('navigation', { name: 'Applications' });
  // Messages non lus et notifications de demandes s’additionnent sur l’application.
  expect(await within(menu).findByLabelText('3 nouveautés dans la messagerie')).toBeInTheDocument();
  const tabs = screen.getByRole('group', { name: 'Vue de la messagerie' });
  expect(within(tabs).getByLabelText('1 message non lu')).toBeInTheDocument();
  expect(within(tabs).getByLabelText('2 nouvelles demandes')).toBeInTheDocument();
  expect(mutations).toEqual([]);
  // Ouvrir les demandes, ou suivre la notification, ne vaut pas lecture.
  await userEvent.click(within(tabs).getByRole('button', { name: /^Demandes/ }));
  expect(await screen.findByRole('region', { name: 'Demandes' })).toBeInTheDocument();
  expect(within(tabs).getByLabelText('2 nouvelles demandes')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Notifications' }));
  const panel = screen.getByRole('region', { name: 'Notifications' });
  await userEvent.click(await within(panel).findByRole('link', { name: 'Examiner la demande' }));
  expect(mutations).toEqual([]);
  const after = await screen.findByRole('navigation', { name: 'Applications' });
  expect(await within(after).findByLabelText('3 nouveautés dans la messagerie')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Notifications' }));
  await userEvent.click(await within(screen.getByRole('region', { name: 'Notifications' })).findByRole('button', { name: 'Marquer comme lu' }));
  await waitFor(() => expect(mutations).toEqual([{ path: '/notifications/nr1/read', method: 'POST', body: {} }]));
  expect(await within(screen.getByRole('navigation', { name: 'Applications' })).findByLabelText('2 nouveautés dans la messagerie')).toBeInTheDocument();
});

it('un administrateur décide d’une demande de pièces depuis la liste unique', async () => {
  account = admin;
  routes['/requests'] = [staffRequest];
  mutation = () => reply({ ...staffRequest, status: 'accepted' });
  open('/app/messagerie?vue=demandes');
  const list = await screen.findByRole('region', { name: 'Demandes' });
  await userEvent.click(await within(list).findByRole('button', { name: 'Décider' }));
  expect(within(list).getByText(/ouvre ou complète le dossier du joueur/)).toBeInTheDocument();
  await userEvent.selectOptions(within(list).getByLabelText('Décision'), 'yes');
  await userEvent.click(within(list).getByRole('button', { name: 'Enregistrer la décision' }));
  await waitFor(() => expect(mutations).toEqual([{ path: '/requests/r1/decision', method: 'POST', body: { accept: true, reason: '' } }]));
});

it('un coach fait une demande depuis un événement', async () => {
  account = coach;
  mutation = () => reply({ ...staffRequest, kind: 'other', event_id: 'e1' }, 201);
  open('/app/planning?event=e1');
  const dialog = await screen.findByRole('dialog', { name: 'Entraînement loisir' });
  await userEvent.click(within(dialog).getByRole('button', { name: 'Faire une demande' }));
  expect(within(dialog).getByRole('heading', { name: 'Demande sur « Entraînement loisir »' })).toBeInTheDocument();
  await userEvent.type(within(dialog).getByLabelText(/Titre/), 'Arbitre');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Envoyer aux administrateurs' }));
  expect(await within(dialog).findByText(/la conversation est ouverte/)).toBeInTheDocument();
  expect(mutations).toEqual([{ path: '/requests', method: 'POST', body: { kind: 'other', title: 'Arbitre', description: '', event_id: 'e1' } }]);
});

it('un administrateur qui a son propre dossier passe du suivi des joueurs à son inscription', async () => {
  account = admin;
  routes['/licenses'] = [license('u1', 'Andréa', 'none', 't1')];
  routes['/dossiers/me'] = { ...dossier, user_id: 'a1', first_name: 'Alix' };
  open('/app/inscriptions');
  expect(await screen.findByRole('region', { name: 'Loisir 1' })).toBeInTheDocument();
  await userEvent.click(await screen.findByRole('button', { name: 'Mon inscription' }));
  expect(await screen.findByRole('heading', { name: 'Mon inscription' })).toBeInTheDocument();
  expect(screen.getByLabelText('Fichier : Carte d’identité ou passeport')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Suivi des joueurs' }));
  expect(await screen.findByRole('region', { name: 'Loisir 1' })).toBeInTheDocument();
});

it('une demande de pièces en attente se suit sur la ligne du joueur et l’admin l’accepte sur place', async () => {
  account = admin;
  routes['/licenses'] = [license('u1', 'Andréa', 'none', 't1')];
  routes['/requests'] = [staffRequest];
  mutation = () => reply({ ...staffRequest, status: 'accepted' });
  open('/app/inscriptions');
  const team = await screen.findByRole('region', { name: 'Loisir 1' });
  expect(within(team).getByText('Pièces demandées par Camille · en attente de validation')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Dossier ou demande en cours (1)' })).toBeInTheDocument();
  await userEvent.click(within(team).getByRole('button', { name: 'Accepter la demande' }));
  expect(await screen.findByText(/le dossier du joueur est ouvert/)).toBeInTheDocument();
  expect(mutations).toEqual([{ path: '/requests/r1/decision', method: 'POST', body: { accept: true, reason: '' } }]);
});

it('l’application Demandes apparaît chez le joueur avec le nombre de pièces à déposer', async () => {
  routes['/unread'] = { messages: 0, notifications: 1, threads: [] };
  routes['/dossiers/me'] = { ...dossier, user_id: 'm1', first_name: 'Camille' };
  open('/app');
  const link = await screen.findByRole('link', { name: /Demandes/ });
  expect(within(link).getByLabelText('1 pièce à déposer')).toBeInTheDocument();
});

it('la clôture d’un dossier avertit de la suppression et exige d’avoir téléchargé les fichiers', async () => {
  account = admin;
  routes['/licenses'] = [license('u1', 'Andréa', 'none', 't1')];
  routes['/dossiers'] = [dossier];
  mutation = () => reply({ ...dossier, closed_at: at('12:00') });
  open('/app/inscriptions');
  const team = await screen.findByRole('region', { name: 'Loisir 1' });
  await userEvent.click(within(team).getByRole('button', { name: 'Dossier' }));
  expect(within(team).getByRole('note')).toHaveTextContent('Les fichiers déposés seront supprimés définitivement à la clôture du dossier.');
  await userEvent.click(within(team).getByRole('button', { name: 'Clore le dossier' }));
  const dialog = await screen.findByRole('dialog', { name: 'Clore le dossier de Andréa ?' });
  expect(within(dialog).getByRole('alert')).toHaveTextContent('Le fichier déposé sera supprimé définitivement.');
  expect(within(dialog).getByRole('link', { name: 'Télécharger' })).toHaveAttribute('href', '/api/v1/dossiers/d1/documents/doc-med/file');
  const close = within(dialog).getByRole('button', { name: 'Clore et supprimer les fichiers' });
  expect(close).toBeDisabled();
  await userEvent.click(within(dialog).getByLabelText('J’ai téléchargé les fichiers à conserver'));
  expect(close).toBeEnabled();
  await userEvent.click(close);
  await waitFor(() => expect(mutations).toEqual([{ path: '/dossiers/d1/close', method: 'POST', body: {} }]));
});

it('l’encart des résultats montre toutes les sections sur deux semaines, puis une carte par section', async () => {
  const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();
  const played = (code: string, kickoff: string, home: string, away: string, homeSets: number, awaySets: number) => ({ match_code: code, kickoff_at: kickoff, home_team: home, away_team: away, home_sets: homeSets, away_sets: awaySets, set_scores: ['23:21', '21:8', '18:21', '21:9'], points: '83-59' });
  routes['/ffvb/results'] = [
    { source_id: 'src1', season: '2026/2027', pool: 'BRC', club_team: 'LSO COLOMBES', team_id: 't1', team_name: 'Loisir 1', section_id: 's1', section_name: 'Loisir', results: [played('BRC005', daysAgo(6), 'MEUDON CHAVILLE SEVRES VOLLEY 2', 'LSO COLOMBES', 3, 1), played('BRC001', daysAgo(40), 'LSO COLOMBES', 'RUEIL 2', 3, 0)] },
    { source_id: 'src2', season: '2026/2027', pool: '2MC', club_team: 'LSO COLOMBES 1', team_id: 't2', team_name: 'Régionale', section_id: 's2', section_name: 'Compétition', results: [played('2MCA002', daysAgo(3), 'LSO COLOMBES 1', 'PARIS UC', 3, 2)] },
  ];
  open('/app');
  const results = await screen.findByRole('region', { name: 'Résultats des matchs' });
  // Première carte : toutes les sections, deux dernières semaines, du plus récent au plus ancien.
  expect(await within(results).findByRole('heading', { name: /Toutes les sections/ })).toBeInTheDocument();
  expect(within(results).queryByRole('button', { name: 'Mettre en pause' })).not.toBeInTheDocument();
  // Toutes les sections : le tableau s’ouvre en haut de page.
  expect(within(results).getByRole('link', { name: 'Voir le tableau' })).toHaveAttribute('href', '/app/notre-club?onglet=resultats');
  const recent = within(results).getAllByRole('listitem');
  expect(recent.map((item) => item.textContent)).toEqual([expect.stringContaining('PARIS UC'), expect.stringContaining('MEUDON CHAVILLE SEVRES VOLLEY 2')]);
  expect(within(results).queryByText('RUEIL 2')).not.toBeInTheDocument();
  expect(within(recent[1]!).getByLabelText('3 sets à 1')).toHaveTextContent('3 – 1');
  expect(within(recent[1]!).getByText('Défaite')).toBeInTheDocument();
  expect(within(recent[1]!).getByText('Sets : 23:21 · 21:8 · 18:21 · 21:9 · points 83 – 59')).toBeInTheDocument();
  expect(within(recent[0]!).getByText('Victoire')).toBeInTheDocument();
  // L’équipe du club en tête de chaque résultat.
  expect(recent.map((item) => item.firstElementChild?.textContent)).toEqual(['Régionale', 'Loisir 1']);
  // Carte d’une section : tous ses résultats passés.
  await userEvent.click(within(results).getByRole('button', { name: 'Information suivante' }));
  expect(within(results).getByRole('heading', { name: /Compétition/ })).toBeInTheDocument();
  // Carte d’une section : le tableau de l’équipe de son dernier match.
  expect(within(results).getByRole('link', { name: 'Voir le tableau' })).toHaveAttribute('href', '/app/notre-club?onglet=resultats&equipe=t2');
  await userEvent.click(within(results).getByRole('button', { name: 'Information suivante' }));
  expect(within(results).getByRole('heading', { name: /Loisir/ })).toBeInTheDocument();
  expect(within(results).getByRole('link', { name: 'Voir le tableau' })).toHaveAttribute('href', '/app/notre-club?onglet=resultats&equipe=t1');
  expect(within(results).getAllByRole('listitem').map((item) => item.textContent)).toEqual([expect.stringContaining('MEUDON'), expect.stringContaining('RUEIL 2')]);
});

it('Notre club passe d’une section à l’autre par les onglets et ouvre les équipes d’une section', async () => {
  routes['/sections'] = [{ id: 's1', name: 'Loisir' }, { id: 's2', name: 'Séniors masculins' }, { id: 's3', name: 'Séniors féminins' }, { id: 's4', name: 'Jeunes' }];
  routes['/teams'] = [{ id: 't1', name: 'Loisir 1', section_id: 's1', referent_ids: ['a1'] }, { id: 't2', name: 'M18 F1', section_id: 's4', referent_ids: [] }];
  open('/app/notre-club?onglet=equipes');
  const tabs = await screen.findByRole('navigation', { name: 'Sections du club' });
  // Les sections écrites dans clubPages.ts, dans leur ordre, puis celle créée sans présentation ;
  // une équipe présentée rejoint sa section plutôt que d’avoir son onglet.
  expect(within(tabs).getAllByRole('link').map((link) => link.textContent)).toEqual(['Séniors féminins', 'Séniors masculins', 'Jeunes féminins', 'Jeunes masculins', 'Loisir', 'Jeunes']);
  expect(within(tabs).getByRole('link', { name: 'Séniors féminins' })).toHaveAttribute('aria-current', 'page');
  await userEvent.click(within(tabs).getByRole('link', { name: 'Loisir' }));
  const section = screen.getByRole('article', { name: /Loisir/ });
  expect(within(section).getByRole('img', { name: 'Photo : Loisir' })).toHaveAttribute('src', '/notre-club/placeholder.svg');
  // Les équipes s’affichent directement ; une équipe créée sans présentation écrite a la sienne,
  // en cours de rédaction.
  const teams = within(section).getByRole('region', { name: 'Nos équipes' });
  expect(within(teams).getByRole('link', { name: /Loisir 1.*Présentation de l’équipe/ })).toBeInTheDocument();
  await userEvent.click(within(teams).getByRole('link', { name: /Loisirs compétition.*Présentation de l’équipe/ }));
  const team = await screen.findByRole('article', { name: /Loisirs compétition/ });
  expect(within(tabs).getByRole('link', { name: 'Loisir' })).toHaveAttribute('aria-current', 'page');
  const crumbs = within(team).getByRole('navigation', { name: 'Fil d’Ariane' });
  expect(crumbs).toHaveTextContent('Loisir › Loisirs compétition');
  const schedule = within(team).getByRole('heading', { name: 'Entraînements' }).parentElement!;
  expect(schedule).toHaveTextContent('Lundi : 20 h 30 – 22 h 30Jeudi : 21 h 00 – 22 h 30Samedi : 12 h 00 – 14 h 00');
  expect(schedule).toHaveTextContent('Au gymnase Ambroise Paré, Colombes.');
  await userEvent.click(within(tabs).getByRole('link', { name: 'Séniors masculins' }));
  const seniors = await screen.findByRole('article', { name: /Séniors masculins/ });
  expect(within(seniors).getByText(/engagées en championnat/)).toBeInTheDocument();
  await userEvent.click(within(within(seniors).getByRole('region', { name: 'Nos équipes' })).getByRole('link', { name: /SM1/ }));
  const sm1 = await screen.findByRole('article', { name: /SM1/ });
  const sm1Schedule = within(sm1).getByRole('heading', { name: 'Entraînements' }).parentElement!;
  expect(sm1Schedule).toHaveTextContent('Mercredi : 19 h 30 – 22 h 30, au gymnase Ambroise ParéVendredi : 20 h 30 – 22 h 30, à la salle polyvalente Henri Dunant');
  await userEvent.click(within(tabs).getByRole('link', { name: 'Jeunes' }));
  await userEvent.click(within(await screen.findByRole('region', { name: 'Nos équipes' })).getByRole('link', { name: /M18 F1/ }));
  const m18 = await screen.findByRole('article', { name: /M18 F1/ });
  expect(within(m18).getByRole('img', { name: 'Photo : M18 F1' })).toHaveAttribute('src', '/notre-club/m18f1_team_photo.jpeg');
  expect(within(m18).getByRole('heading', { name: 'Entraînements' }).parentElement).toHaveTextContent('Mardi : 19 h 30 – 21 h 15Vendredi : 19 h – 20 h 45');
});

it('un administrateur réserve des places à des postes d’une section, en plusieurs lignes', async () => {
  account = admin;
  routes['/positions'] = [{ id: 'p1', name: 'Libéro' }, { id: 'p2', name: 'Passeur' }, { id: 'p3', name: 'Attaquant' }];
  mutation = () => reply(training, 201);
  open('/app/planning');
  await userEvent.click(await screen.findByRole('button', { name: 'Nouvel événement' }));
  await userEvent.type(screen.getByLabelText('Titre'), 'Séance passeurs');
  await userEvent.click(within(screen.getByRole('group', { name: 'Sections et équipes organisatrices' })).getByLabelText('Loisir'));
  await userEvent.click(screen.getByRole('button', { name: 'Ajouter des places réservées' }));
  await userEvent.click(screen.getByRole('button', { name: 'Créer' }));
  expect(await screen.findByText(/Choisissez la section des places réservées/)).toBeInTheDocument();
  await userEvent.selectOptions(screen.getByLabelText('Section des places réservées'), 's1');
  const first = screen.getByRole('group', { name: 'Postes des places réservées' });
  await userEvent.click(within(first).getByLabelText('Passeur'));
  await userEvent.click(within(first).getByLabelText('Libéro'));
  await userEvent.clear(screen.getByLabelText('Nombre de places réservées'));
  await userEvent.type(screen.getByLabelText('Nombre de places réservées'), '2');
  // Une seconde ligne se cumule à la première.
  await userEvent.click(screen.getByRole('button', { name: 'Ajouter des places réservées' }));
  await userEvent.selectOptions(screen.getByLabelText('Section des places réservées 2'), 's1');
  await userEvent.click(within(screen.getByRole('group', { name: 'Postes des places réservées 2' })).getByLabelText('Attaquant'));
  await userEvent.click(screen.getByRole('button', { name: 'Créer' }));
  await waitFor(() => expect(mutations).toHaveLength(1));
  // Sans ouverture classique, aucune limite globale n’est exigée.
  expect(mutations[0]).toMatchObject({ path: '/events', body: { registration_section_ids: [], registration_limit: null, registration_quotas: [{ section_id: 's1', position_ids: ['p2', 'p1'], limit: 2 }, { section_id: 's1', position_ids: ['p3'], limit: 1 }] } });
});

it('un joueur ne voit que les postes réservés à sa section et est averti d’un poste inhabituel', async () => {
  const later = new Date(Date.now() + 14 * 86_400_000).toISOString();
  const quota = { id: 'q1', section_id: 's1', position_ids: ['p1', 'p3'], limit: 2 };
  routes['/positions'] = [{ id: 'p1', name: 'Libéro' }, { id: 'p2', name: 'Passeur' }, { id: 'p3', name: 'Attaquant' }];
  routes['/users/m1/assignments'] = [{ id: 'as1', user_id: 'm1', team_id: 't1', kind: 'player', position_id: 'p2' }];
  routes['/events/e2'] = { ...training, id: 'e2', title: 'Séance réservée', referent_ids: ['a1'], starts_at: later, ends_at: new Date(Date.parse(later) + 7_200_000).toISOString(), registration_quotas: [quota], registration_count: 1 };
  routes['/events/e2/registrations'] = { event_id: 'e2', open: true, limit: null, count: 1, pending: 0, registered: false, status: null, decision: '', eligible: true, quotas: [{ ...quota, count: 1 }], allowed_position_ids: ['p1', 'p3'], participants: null };
  mutation = () => reply({}, 201);
  open('/app/planning?event=e2');
  const dialog = await screen.findByRole('dialog', { name: 'Séance réservée' });
  expect(await within(dialog).findByText('1 inscrit sur 2')).toBeInTheDocument();
  expect(within(dialog).getByRole('list', { name: 'Places réservées' })).toHaveTextContent('2 places réservées · Loisir · Libéro ou Attaquant · 1/2');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Demander l’inscription' }));
  const select = within(dialog).getByLabelText(/Poste pour lequel vous voulez vous entraîner/);
  // Son poste en équipe (Passeur) n’est pas réservé : rien n’est présélectionné.
  expect(select).toHaveValue('');
  expect(within(select).queryByRole('option', { name: 'Passeur' })).not.toBeInTheDocument();
  await userEvent.selectOptions(select, 'p1');
  expect(within(dialog).getByText(/diffère de votre poste en équipe \(Passeur\) : le coach en sera averti/)).toBeInTheDocument();
  await userEvent.click(within(dialog).getByRole('button', { name: 'Envoyer la demande' }));
  await waitFor(() => expect(mutations).toEqual([{ path: '/events/e2/registration', method: 'POST', body: { position_id: 'p1', message: '' } }]));
});

it('le coach voit qu’une demande vise un autre poste que celui du joueur en équipe', async () => {
  account = admin;
  const later = new Date(Date.now() + 14 * 86_400_000).toISOString();
  routes['/positions'] = [{ id: 'p1', name: 'Libéro' }, { id: 'p2', name: 'Passeur' }];
  routes['/events/e2'] = { ...training, id: 'e2', title: 'Séance réservée', referent_ids: ['a1'], starts_at: later, ends_at: new Date(Date.parse(later) + 7_200_000).toISOString(), registration_quotas: [{ id: 'q1', section_id: 's1', position_ids: ['p1'], limit: 2 }] };
  routes['/events/e2/registrations'] = { event_id: 'e2', open: true, limit: null, count: 0, pending: 1, registered: false, status: null, decision: '', eligible: false, quotas: [{ id: 'q1', section_id: 's1', position_ids: ['p1'], limit: 2, count: 0 }], participants: [{ user_id: 'm1', first_name: 'Morgan', created_at: later, status: 'pending', position_id: 'p1', message: '', quota_id: 'q1', team_position_ids: ['p2'], position_warning: true }] };
  open('/app/planning?event=e2');
  const dialog = await screen.findByRole('dialog', { name: 'Séance réservée' });
  expect(await within(dialog).findByText('Poste habituel : Passeur')).toBeInTheDocument();
  expect(within(dialog).getByText('Place réservée')).toBeInTheDocument();
  await userEvent.click(within(dialog).getByRole('button', { name: 'Traiter' }));
  expect(within(dialog).getByText(/Morgan demande un poste différent de son poste en équipe \(Passeur\)/)).toBeInTheDocument();
});

it('le coach référent décide d’une demande d’inscription depuis la messagerie, comme sur l’événement', async () => {
  account = { ...member, id: 'c1', first_name: 'Coach', roles: ['member', 'coach'] };
  routes['/users/c1/assignments'] = [];
  const registration = { id: 'reg1', kind: 'registration', title: 'Inscription : Séance ouverte du 15/10/2099', description: 'Poste : Passeur. Poste habituel en équipe : Libéro.', event_id: 'e2', actor_id: 'm1', actor_name: 'Morgan', status: 'pending', decision: '', decider_name: null, decided_at: null, created_at: at('10:00'), thread_id: null, player_id: null, documents: [], link: '/app/planning?event=e2', position_warning: true };
  routes['/requests'] = [registration];
  mutation = () => reply({}, 200);
  open('/app/messagerie?vue=demandes');
  const list = await screen.findByRole('region', { name: 'Demandes' });
  expect(await within(list).findByText('Demande d’inscription')).toBeInTheDocument();
  expect(within(list).getByText('Autre poste qu’en équipe')).toBeInTheDocument();
  expect(within(list).getByRole('link', { name: 'Événement' })).toHaveAttribute('href', '/app/planning?event=e2');
  expect(within(list).queryByRole('button', { name: 'Retirer' })).not.toBeInTheDocument();
  await userEvent.click(within(list).getByRole('button', { name: 'Décider' }));
  await userEvent.selectOptions(within(list).getByLabelText('Décision'), 'no');
  await userEvent.type(within(list).getByLabelText('Message au joueur (facultatif)'), 'Complet côté passeurs');
  await userEvent.click(within(list).getByRole('button', { name: 'Enregistrer la décision' }));
  await waitFor(() => expect(mutations).toEqual([{ path: '/events/e2/registrations/m1/decision', method: 'POST', body: { accept: false, reason: 'Complet côté passeurs' } }]));
  expect(await within(list).findByText('Décision enregistrée ; le joueur est notifié.')).toBeInTheDocument();
});

it('un signal du serveur met aussitôt à jour la pastille et la liste des notifications', async () => {
  class FakeSource {
    static last: FakeSource | undefined;
    readonly listeners = new Map<string, () => void>();
    onopen: (() => void) | null = null;
    onerror: (() => void) | null = null;
    closed = false;
    constructor(readonly url: string) { FakeSource.last = this; }
    addEventListener(name: string, listener: () => void) { this.listeners.set(name, listener); }
    close() { this.closed = true; }
    emit(name: string) { this.listeners.get(name)?.(); }
  }
  vi.stubGlobal('EventSource', FakeSource);
  let notifications = 0;
  routes['/notifications'] = [];
  Object.defineProperty(routes, '/unread', { enumerable: true, get: () => ({ messages: 0, notifications, threads: [] }) });
  open('/app');
  const bell = await screen.findByRole('button', { name: 'Notifications' });
  await userEvent.click(bell);
  const card = screen.getByRole('region', { name: 'Notifications' });
  expect(await within(card).findByText('Aucune nouvelle notification.')).toBeInTheDocument();
  await waitFor(() => expect(FakeSource.last?.url).toBe('/api/v1/live'));
  const source = FakeSource.last!;
  // Premier signal d’une connexion : simple rattrapage des compteurs.
  act(() => { source.onopen?.(); source.emit('unread'); });
  notifications = 1;
  routes['/notifications'] = [{ id: 'n1', kind: 'registration_request', title: 'Demande d’inscription de Morgan', event_id: 'e1', read_at: null, created_at: at('10:00') }];
  act(() => source.emit('unread'));
  expect(await within(bell).findByLabelText('1 notification non lue')).toBeInTheDocument();
  expect(await within(card).findByText('Demande d’inscription de Morgan')).toBeInTheDocument();
  // Session terminée côté serveur : le flux se ferme.
  act(() => source.emit('session'));
  expect(source.closed).toBe(true);
});

it('les onglets de la messagerie portent une pastille sans nombre quand une opération attend', async () => {
  account = admin;
  Object.defineProperty(routes, '/unread', { enumerable: true, configurable: true, get: () => ({ messages: 0, notifications: 0, threads: [], requests: 0, messaging_pending: true, questions_pending: true, requests_pending: false }) });
  open('/app/messagerie');
  const tabs = await screen.findByRole('group', { name: 'Vue de la messagerie' });
  const conversations = within(tabs).getByRole('button', { name: /^Conversations/ });
  expect(await within(conversations).findByLabelText('Questions sans réponse')).toBeInTheDocument();
  const requests = within(tabs).getByRole('button', { name: /^Demandes/ });
  expect(within(requests).queryByLabelText('Demandes à décider')).not.toBeInTheDocument();
});

it('pastilles sans nombre : points à traiter dans l’administration et la messagerie', async () => {
  account = admin;
  let unread = { messages: 0, notifications: 0, threads: [] as string[], administration: true, messaging_pending: true };
  Object.defineProperty(routes, '/unread', { enumerable: true, configurable: true, get: () => unread });
  open('/app');
  const menu = await screen.findByRole('navigation', { name: 'Applications' });
  const administration = within(menu).getByRole('link', { name: /Administration/ });
  expect(await within(administration).findByLabelText('Conflits ou points FFVB à traiter')).toBeInTheDocument();
  const messaging = within(menu).getByRole('link', { name: /Messagerie/ });
  expect(within(messaging).getByLabelText('Questions ou demandes en attente')).toBeInTheDocument();
  // Des messages non lus : la messagerie montre leur nombre, sans la pastille seule.
  unread = { ...unread, messages: 2, threads: ['q1'] };
  await userEvent.click(within(menu).getByRole('link', { name: /Planning/ }));
  const after = await screen.findByRole('navigation', { name: 'Applications' });
  const counted = within(after).getByRole('link', { name: /Messagerie/ });
  expect(await within(counted).findByLabelText('2 questions non lues')).toBeInTheDocument();
  expect(within(counted).queryByLabelText('Questions ou demandes en attente')).not.toBeInTheDocument();
});

it('un administrateur suit les demandes de contact : pastille, prise en charge, résolution et filtre', async () => {
  account = admin;
  const requested: string[] = [];
  const contact = { id: 'c1', email: 'parent@example.org', phone: '06 12 34 56 78', message: 'Mon fils peut-il faire un essai ?', team_ids: ['t1'], status: 'open', handler_id: null as string | null, handler_name: null as string | null, handled_at: null as string | null, resolved_at: null as string | null, created_at: at('09:00') };
  const done = { ...contact, id: 'c2', message: 'Horaires des M15 ?', status: 'resolved', handler_id: 'x9', handler_name: 'Sam', handled_at: at('08:00'), resolved_at: at('08:30'), created_at: at('07:00') };
  const open_ = () => [contact].filter((item) => item.status === 'open').length;
  Object.defineProperty(routes, '/unread', { enumerable: true, get: () => ({ messages: 0, notifications: 0, threads: [], contacts: open_() }) });
  Object.defineProperty(routes, '/contact-requests', { enumerable: true, get: () => (requested.at(-1)?.includes('status=open') ? [contact].filter((item) => item.status === 'open') : [contact, done]) });
  const fetcher = fetch;
  vi.stubGlobal('fetch', vi.fn<typeof fetch>((input, init) => { if (String(input).includes('/contact-requests') && (init?.method ?? 'GET') === 'GET') requested.push(String(input)); return fetcher(input, init); }));
  mutation = (path) => {
    if (path.endsWith('/take')) Object.assign(contact, { handler_id: 'a1', handler_name: 'Alix', handled_at: at('10:00') });
    if (path.endsWith('/resolve')) Object.assign(contact, { status: 'resolved', resolved_at: at('11:00') });
    return reply(contact);
  };
  open('/app/contact');
  const menu = await screen.findByRole('navigation', { name: 'Applications' });
  expect(await within(menu).findByLabelText('1 demande de contact non résolue')).toBeInTheDocument();
  const tabs = screen.getByRole('group', { name: 'Vue du contact' });
  expect(within(tabs).getByLabelText('1 demande non résolue')).toBeInTheDocument();
  const list = await screen.findByRole('region', { name: 'Demandes de contact' });
  // Par défaut, seules les demandes non résolues.
  expect(within(list).getByRole('checkbox', { name: 'Non résolues uniquement' })).toBeChecked();
  const item = (await within(list).findByText('Mon fils peut-il faire un essai ?')).closest('li')!;
  expect(requested[0]).toContain('/contact-requests?status=open');
  expect(within(list).queryByText('Horaires des M15 ?')).not.toBeInTheDocument();
  expect(within(item).getByText('Loisir 1')).toBeInTheDocument();
  expect(within(item).getByRole('link', { name: 'parent@example.org' })).toHaveAttribute('href', 'mailto:parent@example.org');
  expect(within(item).getByRole('link', { name: '06 12 34 56 78' })).toHaveAttribute('href', 'tel:0612345678');
  expect(within(item).getByText('Pas encore prise en charge')).toBeInTheDocument();
  await userEvent.click(within(item).getByRole('button', { name: 'Prendre en charge' }));
  expect(await within(list).findByText('Demande prise en charge.')).toBeInTheDocument();
  const taken = (await within(list).findByText('Mon fils peut-il faire un essai ?')).closest('li')!;
  await waitFor(() => expect(within(taken).getByText(/Prise en charge par/)).toHaveTextContent('Prise en charge par vous'));
  expect(within(taken).queryByRole('button', { name: 'Prendre en charge' })).not.toBeInTheDocument();
  await userEvent.click(within(taken).getByRole('button', { name: 'Marquer comme résolue' }));
  expect(await within(list).findByText('Aucune demande de contact à traiter.')).toBeInTheDocument();
  expect(mutations.map((item) => item.path)).toEqual(['/contact-requests/c1/take', '/contact-requests/c1/resolve']);
  await waitFor(() => expect(within(menu).queryByLabelText(/demandes? de contact/)).not.toBeInTheDocument());
  // Toutes les demandes : celle d’un collègue garde son nom.
  await userEvent.click(within(list).getByRole('checkbox', { name: 'Non résolues uniquement' }));
  const old = (await within(list).findByText('Horaires des M15 ?')).closest('li')!;
  expect(within(old).getByText(/Prise en charge par/)).toHaveTextContent('Prise en charge par Sam');
  expect(within(old).getByText('Résolue')).toBeInTheDocument();
  expect(within(old).getByRole('button', { name: 'Rouvrir' })).toBeInTheDocument();
  // Le formulaire reste accessible aux administrateurs.
  await userEvent.click(within(tabs).getByRole('button', { name: 'Formulaire' }));
  expect(await screen.findByRole('form', { name: 'Formulaire de contact' })).toBeInTheDocument();
});

it('un adhérent ne voit que le formulaire de contact, adresse de son compte préremplie', async () => {
  account = { ...member, email: 'camille@example.org' } as unknown as typeof member;
  open('/app/contact');
  const form = await screen.findByRole('form', { name: 'Formulaire de contact' });
  expect(within(form).getByLabelText('Adresse e-mail')).toHaveValue('camille@example.org');
  expect(screen.queryByRole('group', { name: 'Vue du contact' })).not.toBeInTheDocument();
  expect(screen.queryByRole('region', { name: 'Demandes de contact' })).not.toBeInTheDocument();
});

it('le filtre Mon planning du Planning garde mes équipes, mes favoris, ce dont je suis référent et mes inscriptions', async () => {
  const other = { ...training, referent_ids: ['a1'], section_ids: ['s2'] };
  routes['/sections'] = [{ id: 's1', name: 'Loisir' }, { id: 's2', name: 'Compétition' }];
  routes['/teams'] = [{ id: 't1', name: 'Loisir 1', section_id: 's1', referent_ids: ['a1'] }, { id: 't2', name: 'Compétition 1', section_id: 's2', referent_ids: ['m1'] }];
  routes['/events'] = [
    { ...training, id: 'e1', title: 'Je suis référent' },
    { ...other, id: 'e2', title: 'Autre section', section_ids: ['s3'] },
    { ...other, id: 'e3', title: 'Événement favori' },
    { ...other, id: 'e4', title: 'Séance de mon équipe', section_ids: ['s1'], team_ids: ['t1'] },
    { ...other, id: 'e5', title: 'Équipe dont je suis référent', team_ids: ['t2'] },
    { ...other, id: 'e6', title: 'Je suis inscrit' },
  ];
  routes['/follows'] = [{ id: 'f1', user_id: 'm1', event_id: 'e3', series_id: null }];
  routes['/registrations'] = [{ event_id: 'e6', user_id: 'm1', status: 'accepted' }];
  open('/app/mon-planning');
  // L’ancienne application mène au Planning, filtre coché.
  expect(await screen.findByRole('heading', { level: 1, name: 'Planning' })).toBeInTheDocument();
  const mine = await screen.findByRole('checkbox', { name: 'Mon planning' });
  expect(mine).toBeChecked();
  expect(screen.queryByLabelText('Origine des événements')).not.toBeInTheDocument();
  for (const title of ['Je suis référent', 'Événement favori', 'Séance de mon équipe', 'Équipe dont je suis référent', 'Je suis inscrit'])
    expect(await screen.findByRole('link', { name: new RegExp(title) })).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: /Autre section/ })).not.toBeInTheDocument();
  await userEvent.click(mine);
  expect(await screen.findByRole('link', { name: /Autre section/ })).toBeInTheDocument();
});

it('place en tête, d’une autre couleur, les équipes dont je suis référent', async () => {
  routes['/sections'] = [{ id: 's1', name: 'Loisir' }, { id: 's2', name: 'Compétition' }];
  routes['/teams'] = [{ id: 't1', name: 'Loisir 1', section_id: 's1', referent_ids: ['a1'] }, { id: 't2', name: 'Compétition 1', section_id: 's2', referent_ids: ['m1'] }];
  routes['/users/m1/assignments'] = [{ id: 'as1', user_id: 'm1', team_id: 't1', kind: 'player' }, { id: 'as2', user_id: 'm1', team_id: 't2', kind: 'coach' }];
  open('/app/planning');
  const select = await screen.findByLabelText('Équipe');
  const group = within(select).getByRole('group', { name: 'Mes équipes (référent)' });
  expect(within(group).getAllByRole('option').map((option) => option.textContent)).toEqual(['Compétition 1']);
  expect(within(group).getByRole('option')).toHaveClass('team-referent');
  expect(within(select).getAllByRole('option').map((option) => option.textContent)).toEqual(['Toutes les équipes', 'Compétition 1', 'Loisir 1']);
  cleanup();
  open('/app/equipes');
  const cards = await screen.findAllByRole('heading', { level: 3 });
  expect(cards.map((card) => card.textContent)).toEqual(['Compétition 1 Référent', 'Loisir 1']);
  expect(cards[0]!.closest('section')).toHaveClass('team-referent-card');
  expect(cards[1]!.closest('section')).toHaveClass('team-other-card');
});

it('réserve l’historique d’un événement aux administrateurs et à ses référents', async () => {
  routes['/events'] = [{ ...training, referent_ids: ['a1'] }];
  routes['/events/e1'] = { ...training, referent_ids: ['a1'], team_ids: ['t1'] };
  open('/app/planning?event=e1');
  const dialog = await screen.findByRole('dialog', { name: 'Entraînement loisir' });
  expect(await within(dialog).findByRole('button', { name: 'Ajouter aux favoris' })).toBeInTheDocument();
  expect(within(dialog).queryByRole('button', { name: 'Historique' })).not.toBeInTheDocument();
  cleanup();
  // Référent de l’événement : l’historique est proposé.
  routes['/events/e1'] = { ...training, team_ids: ['t1'] };
  open('/app/planning?event=e1');
  const own = await screen.findByRole('dialog', { name: 'Entraînement loisir' });
  expect(await within(own).findByRole('button', { name: 'Historique' })).toBeInTheDocument();
});

it('présente un match FFVB sans heure sur sa journée, heure à compléter', async () => {
  routes['/events'] = [{ ...training, id: 'e9', title: 'LSO / Rueil', kind: 'match', ffvb_match_id: 'm9', courts: 0, starts_at: new Date(`${day}T00:00:00+02:00`).toISOString(), ends_at: new Date(`${addDays(day, 1)}T00:00:00+02:00`).toISOString(), time_unknown: true }];
  routes['/events/e9'] = { ...(routes['/events'] as object[])[0], team_ids: ['t1'] };
  open('/app/planning?event=e9');
  const dialog = await screen.findByRole('dialog', { name: 'LSO / Rueil' });
  expect(within(dialog).getByText('Journée · heure à compléter')).toBeInTheDocument();
});

it('cherche un créneau, garde la recherche dans l’historique et ouvre la création préremplie', async () => {
  account = admin;
  const later = addDays(day, 7);
  const slots = [{ day: later, gymnasium_id: 'g1', first_start: new Date(`${later}T19:00:00+01:00`).toISOString(), last_start: new Date(`${later}T19:00:00+01:00`).toISOString() }];
  mutation = (path) => (path === '/slot-search' ? reply(slots) : reply({}, 201));
  open('/app/planning');
  // Onglet loupe, à droite du planning des gymnases.
  const tabs = await screen.findByRole('navigation', { name: 'Planning' });
  expect(within(tabs).getAllByRole('link').map((link) => link.getAttribute('aria-label') ?? link.textContent)).toEqual(['Planning du club', 'Planning des gymnases', 'Recherche de créneau']);
  await userEvent.click(within(tabs).getByRole('link', { name: 'Recherche de créneau' }));
  const form = await screen.findByRole('form', { name: 'Recherche de créneau' });
  // Heure en 24 h et minutes au quart d’heure, sans AM/PM.
  const hour = within(form).getByLabelText('Heure de début');
  expect(hour.tagName).toBe('SELECT');
  expect(hour).toHaveValue('19');
  expect(within(hour).getAllByRole('option').map((option) => option.textContent)).toContain('23');
  expect(within(form).getByLabelText('Minutes de Heure de début')).toHaveValue('00');
  await userEvent.click(within(form).getByLabelText('Mardi'));
  await userEvent.clear(within(form).getByLabelText('Terrains nécessaires'));
  await userEvent.type(within(form).getByLabelText('Terrains nécessaires'), '2');
  await userEvent.click(within(form).getByRole('button', { name: 'Rechercher' }));
  const results = await screen.findByRole('region', { name: 'Créneaux trouvés' });
  expect(within(results).getByText(/Gymnase Ambroise Paré · à partir de 19:00/)).toBeInTheDocument();
  expect(mutations[0]).toEqual({ path: '/slot-search', method: 'POST', body: { from_date: null, to_date: null, weekdays: [1], start: '19:00', end: null, duration_minutes: 120, gymnasium_ids: [], courts: 2 } });
  // L’historique propose de relancer la recherche.
  const history = screen.getByRole('region', { name: 'Dernières recherches' });
  expect(history).toHaveTextContent('Mar à 19:00 · 2 h · 2 terrains · tous les gymnases');
  await userEvent.click(within(history).getByRole('button', { name: 'Relancer' }));
  await waitFor(() => expect(mutations.filter((item) => item.path === '/slot-search')).toHaveLength(2));
  // Choisir le créneau ouvre la création de l’événement, préremplie.
  await userEvent.click(within(await screen.findByRole('region', { name: 'Créneaux trouvés' })).getByRole('link', { name: 'Créer l’événement' }));
  expect(await screen.findByLabelText('Gymnase du club')).toHaveValue('g1');
  expect(screen.getByLabelText('Terrains occupés')).toHaveValue(2);
});

it('cherche un créneau sur une période choisie', async () => {
  account = admin;
  mutation = (path) => (path === '/slot-search' ? reply([]) : reply({}, 201));
  open('/app/planning?onglet=recherche');
  const form = await screen.findByRole('form', { name: 'Recherche de créneau' });
  await userEvent.type(within(form).getByLabelText('Du'), '01/12/2099');
  await userEvent.tab();
  await userEvent.type(within(form).getByLabelText('Au'), '15/12/2099');
  await userEvent.tab();
  await userEvent.click(within(form).getByRole('button', { name: 'Rechercher' }));
  expect(await screen.findByText('Aucun jour ne convient sur cette période.')).toBeInTheDocument();
  expect(mutations[0]?.body).toMatchObject({ from_date: '2099-12-01', to_date: '2099-12-15' });
  expect(screen.getByRole('region', { name: 'Dernières recherches' })).toHaveTextContent('du 01/12 au 15/12');
});

it('réserve la recherche de créneau aux administrateurs', async () => {
  open('/app/planning?onglet=recherche');
  const tabs = await screen.findByRole('navigation', { name: 'Planning' });
  expect(within(tabs).queryByRole('link', { name: 'Recherche de créneau' })).not.toBeInTheDocument();
  expect(screen.queryByRole('form', { name: 'Recherche de créneau' })).not.toBeInTheDocument();
});
