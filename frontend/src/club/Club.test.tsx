import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { AuthApp } from '../auth/AuthApp';
import { addDays, mondayOf, nextJuly31, today } from './calendar';

const member = { id: 'm1', username: 'camille', first_name: 'Camille', category: 'adult', roles: ['member'], active: true, email: null, messaging_allowed: true, followed_email: true, referent_email: true, admin_email: true };
const admin = { ...member, id: 'a1', username: 'admin', first_name: 'Alix', roles: ['admin'] };
const day = addDays(mondayOf(today()), 2);
function at(time: string) { return new Date(`${day}T${time}:00+02:00`).toISOString(); }
const training = { id: 'e1', title: 'Entraînement loisir', kind: 'training', section_ids: ['s1'], gymnasium_id: 'g1', location: '', starts_at: at('18:00'), ends_at: at('20:00'), courts: 2, referent_id: 'm1', direct_edit: false, cancelled: false, version: 3, series_id: null, exception: false, ffvb_match_id: null, kickoff_at: null, before_minutes: 75, after_minutes: 150, match_courts: 3, occupancy_unknown: false, registration_section_ids: [] as string[], registration_limit: null as number | null, registration_count: 0 };
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
    '/teams': [{ id: 't1', name: 'Loisir 1', section_id: 's1', referent_id: 'a1' }],
    '/gymnasiums': [{ id: 'g1', name: 'Gymnase Ambroise Paré', capacity: 3 }],
    '/follows': [],
    '/users/m1/assignments': [{ id: 'as1', user_id: 'm1', team_id: 't1', kind: 'player' }],
    '/users/a1/assignments': [],
    '/users': [admin, member],
    '/events': [training],
    '/events/e1': training,
    '/profiles/a1': { id: 'a1', first_name: 'Alix', category: 'adult' },
  };
  document.cookie = 'lsoc_csrf=csrf; path=/';
  vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
    const path = new URL(String(input), 'http://localhost').pathname.replace('/api/v1', '');
    const method = init?.method ?? 'GET';
    if (method !== 'GET') {
      const body: unknown = init?.body ? JSON.parse(String(init.body)) : undefined;
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
  await userEvent.click(within(dialog).getByRole('button', { name: 'Suivre l’événement' }));
  expect(await within(dialog).findByRole('button', { name: 'Ne plus suivre' })).toHaveAttribute('aria-pressed', 'true');
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
  expect(within(dialog).queryByLabelText('Référent')).not.toBeInTheDocument();
  const courts = within(dialog).getByLabelText('Terrains occupés');
  await userEvent.clear(courts);
  await userEvent.type(courts, '1');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Envoyer la demande' }));
  expect(await within(dialog).findByText(/Demande envoyée aux administrateurs/)).toBeInTheDocument();
  expect(mutations).toEqual([{ path: '/events/e1/change-requests', method: 'POST', body: { base_version: 3, changes: { courts: 1 }, force: false, acknowledge_ffvb: false } }]);
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
  await userEvent.click(within(screen.getByRole('group', { name: 'Sections concernées' })).getByLabelText('Loisir'));
  await userEvent.selectOptions(screen.getByLabelText('Gymnase du club'), 'g1');
  expect(screen.queryByLabelText('Fin de la récurrence')).not.toBeInTheDocument();
  await userEvent.click(screen.getByLabelText('Répéter chaque semaine'));
  expect(screen.getByLabelText('Fin de la récurrence')).toHaveValue(nextJuly31(day > today() ? day : today()));
  await userEvent.clear(screen.getByLabelText('Fin de la récurrence'));
  await userEvent.type(screen.getByLabelText('Fin de la récurrence'), addDays(day, 7));
  await userEvent.click(screen.getByRole('button', { name: 'Créer' }));
  expect(await screen.findByText('Capacité dépassée')).toBeInTheDocument();
  await userEvent.click(screen.getByLabelText(/Forcer le dépassement/));
  await userEvent.click(screen.getByRole('button', { name: 'Créer' }));
  expect(await screen.findByText('Série créée : 2 occurrences.')).toBeInTheDocument();
  expect(attempts).toBe(2);
  expect(mutations[1]).toMatchObject({ path: '/series', body: { until: addDays(day, 7), force: true, event: { title: 'Entraînement compétition', section_ids: ['s1'], gymnasium_id: 'g1', courts: 1, referent_id: 'a1' } } });
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

it('les gymnases signalent un dépassement et mes sections présentent mon rôle', async () => {
  routes['/gymnasiums/g1/availability'] = { gymnasium_id: 'g1', capacity: 3, segments: [{ starts_at: at('18:00'), ends_at: at('19:00'), occupied: 4, available: 0, excess: 1 }] };
  open('/app/gymnases');
  expect(await screen.findByText('Complet · 1 terrain en excès')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('link', { name: 'Mes sections' }));
  const card = (await screen.findByRole('heading', { name: 'Loisir' })).closest('section')!;
  expect(within(card).getByText('Joueur')).toBeInTheDocument();
  expect(await within(card).findByText(/Référent de l’équipe : Alix/)).toBeInTheDocument();
  expect(await within(card).findByRole('link', { name: 'Entraînement loisir' })).toBeInTheDocument();
});

it('un adhérent s’inscrit à une séance ouverte à sa section tant que la limite n’est pas atteinte', async () => {
  const later = new Date(Date.now() + 14 * 86_400_000).toISOString();
  const openSession = { ...training, id: 'e2', title: 'Séance ouverte', referent_id: 'a1', starts_at: later, ends_at: new Date(Date.parse(later) + 7_200_000).toISOString(), registration_section_ids: ['s1'], registration_limit: 2, registration_count: 1 };
  routes['/events/e2'] = openSession;
  routes['/events/e2/registrations'] = { event_id: 'e2', open: true, limit: 2, count: 1, registered: false, eligible: true, participants: null };
  mutation = (path) => {
    routes['/events/e2/registrations'] = { event_id: 'e2', open: true, limit: 2, count: 2, registered: true, eligible: true, participants: null };
    return reply({ id: 'r1', user_id: 'm1', event_id: 'e2', created_at: later }, path.endsWith('/registration') ? 201 : 404);
  };
  open('/app/planning?event=e2');
  const dialog = await screen.findByRole('dialog', { name: 'Séance ouverte' });
  expect(await within(dialog).findByText('1 inscrit sur 2')).toBeInTheDocument();
  await userEvent.click(within(dialog).getByRole('button', { name: 'S’inscrire' }));
  expect(await within(dialog).findByText('Vous êtes inscrit')).toBeInTheDocument();
  expect(within(dialog).getByText('2 inscrits sur 2')).toBeInTheDocument();
  expect(mutations).toEqual([{ path: '/events/e2/registration', method: 'POST', body: {} }]);
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
  expect(within(other).queryByRole('button', { name: 'S’inscrire' })).not.toBeInTheDocument();
});

it('un administrateur ouvre une séance en fixant obligatoirement une limite', async () => {
  account = admin;
  mutation = () => reply(training, 201);
  open('/app/planning');
  await userEvent.click(await screen.findByRole('button', { name: 'Nouvel événement' }));
  await userEvent.type(screen.getByLabelText('Titre'), 'Séance découverte');
  await userEvent.click(within(screen.getByRole('group', { name: 'Sections concernées' })).getByLabelText('Loisir'));
  await userEvent.click(within(screen.getByRole('group', { name: 'Ouvert aux inscriptions des sections' })).getByLabelText('Loisir'));
  await userEvent.click(screen.getByRole('button', { name: 'Créer' }));
  expect(await screen.findByText(/Indiquez le nombre maximal d’inscrits/)).toBeInTheDocument();
  expect(mutations).toEqual([]);
  await userEvent.type(screen.getByLabelText('Nombre maximal d’inscrits'), '12');
  await userEvent.click(screen.getByRole('button', { name: 'Créer' }));
  await waitFor(() => expect(mutations).toHaveLength(1));
  expect(mutations[0]).toMatchObject({ path: '/events', body: { registration_section_ids: ['s1'], registration_limit: 12 } });
});

it('affiche les pastilles du menu et retire une notification marquée comme lue', async () => {
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
  expect(within(menu).getByLabelText('2 notifications non lues')).toBeInTheDocument();
  const card = (await screen.findByRole('heading', { name: /Notifications/ })).closest('section')!;
  const item = await within(card).findByText('Événement modifié : Entraînement loisir');
  await userEvent.click(within(item.closest('li')!).getByRole('button', { name: 'Marquer comme lu' }));
  await waitFor(() => expect(within(card).queryByText('Événement modifié : Entraînement loisir')).not.toBeInTheDocument());
  expect(await within(menu).findByLabelText('1 notification non lue')).toBeInTheDocument();
  expect(mutations).toEqual([{ path: '/notifications/n2/read', method: 'POST', body: {} }]);
});

it('un administrateur crée un entraînement les mardis et jeudis jusqu’à la date choisie', async () => {
  account = admin;
  mutation = () => reply([training], 201);
  open('/app/planning');
  await userEvent.click(await screen.findByRole('button', { name: 'Nouvel événement' }));
  await userEvent.type(screen.getByLabelText('Titre'), 'Entraînement loisir');
  await userEvent.click(within(screen.getByRole('group', { name: 'Sections concernées' })).getByLabelText('Loisir'));
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
