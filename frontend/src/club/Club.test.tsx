import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
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
  expect(screen.queryByLabelText('Début (Europe/Paris)')).not.toBeInTheDocument();
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

it('les gymnases signalent un dépassement et mes sections présentent mon rôle', async () => {
  routes['/gymnasiums/g1/availability'] = { gymnasium_id: 'g1', capacity: 3, segments: [{ starts_at: at('18:00'), ends_at: at('19:00'), occupied: 4, available: 0, excess: 1 }] };
  open('/app/gymnases');
  expect(await screen.findByText('Complet · 1 terrain en excès')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('link', { name: 'Mes sections' }));
  const card = (await screen.findByRole('heading', { name: 'Loisir' })).closest('section')!;
  expect(within(card).getByText('Joueur')).toBeInTheDocument();
  await waitFor(() => expect(card).toHaveTextContent('Référents de l’équipe : Alix'));
  expect(await within(card).findByRole('link', { name: 'Entraînement loisir' })).toBeInTheDocument();
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

it('chaque notification mène à son action : examen d’une demande ou message de l’admin', async () => {
  routes['/notifications'] = [
    { id: 'n1', kind: 'decision', title: 'Modification refusée : Entraînement loisir', body: 'Gymnase indisponible.', link: '/app/messagerie?thread=q9', event_id: 'e1', read_at: null, created_at: at('10:00') },
    { id: 'n2', kind: 'license', title: 'Licence : Active', body: '', link: '/app/profil', event_id: null, read_at: null, created_at: at('11:00') },
  ];
  open('/app');
  const card = (await screen.findByRole('heading', { name: /Notifications/ })).closest('section')!;
  expect(await within(card).findByText('Gymnase indisponible.')).toBeInTheDocument();
  expect(within(card).getByRole('link', { name: 'Voir le message' })).toHaveAttribute('href', '/app/messagerie?thread=q9');
  expect(within(card).getByRole('link', { name: 'Licence : Active' })).toHaveAttribute('href', '/app/profil');
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

it('l’onglet Inscriptions montre d’abord les joueurs non inscrits, par équipe, section et étape', async () => {
  account = admin;
  routes['/sections'] = [{ id: 's1', name: 'Loisir' }, { id: 's2', name: 'Compétition' }];
  routes['/teams'] = [{ id: 't1', name: 'Loisir 1', section_id: 's1', referent_ids: [] }, { id: 't2', name: 'Régionale', section_id: 's2', referent_ids: [] }];
  routes['/licenses'] = [license('u1', 'Andréa', 'none', 't1'), license('u2', 'Bao', 'payment_pending', 't2'), license('u3', 'Chloé', 'active', 't1'), { ...license('u4', 'Dominique', 'none', 't1'), teams: [{ team_id: 't1', kind: 'coach' }] }];
  open('/app/inscriptions');
  expect(await screen.findByRole('heading', { name: 'Inscriptions' })).toBeInTheDocument();
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

it('un adhérent sans rôle coach n’accède pas à l’onglet Inscriptions', async () => {
  open('/app/inscriptions');
  expect(await screen.findByRole('heading', { name: 'Accueil' })).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Inscriptions' })).not.toBeInTheDocument();
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
  await userEvent.click(await screen.findByRole('link', { name: 'Inscriptions 2 pièces à déposer' }));
  expect(await screen.findByRole('heading', { name: 'Mon inscription' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Étapes terminées : 0/3' })).toBeInTheDocument();
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

it('l’application Inscriptions apparaît chez le joueur avec le nombre de pièces à déposer', async () => {
  routes['/unread'] = { messages: 0, notifications: 1, threads: [] };
  routes['/dossiers/me'] = { ...dossier, user_id: 'm1', first_name: 'Camille' };
  open('/app');
  const link = await screen.findByRole('link', { name: /Inscriptions/ });
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
