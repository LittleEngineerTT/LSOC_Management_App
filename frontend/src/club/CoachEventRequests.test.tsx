import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { AuthApp } from '../auth/AuthApp';
import { addDays, dayLabel, nextJuly31, today } from './calendar';

const coach = {
  id: 'coach',
  username: 'camille',
  first_name: 'Camille',
  category: 'adult',
  active: true,
  roles: ['coach'],
  email: null,
  messaging_allowed: true,
};
const admin = { ...coach, id: 'admin', roles: ['admin'] };
const day = addDays(today(), 2);
const proposal = {
  title: 'Stage proposé',
  kind: 'training',
  section_ids: ['s1'],
  gymnasium_id: null,
  location: 'Parc',
  starts_at: `${day}T16:00:00Z`,
  ends_at: `${day}T18:00:00Z`,
  courts: 0,
  referent_id: 'coach',
  direct_edit: false,
  registration_section_ids: [],
  registration_team_ids: ['t3'],
  registration_limit: 12,
};
const event = {
  ...proposal,
  id: 'e1',
  title: 'Séance équipe',
  cancelled: false,
  version: 1,
  series_id: null,
  exception: false,
  ffvb_match_id: null,
  kickoff_at: null,
  before_minutes: 75,
  after_minutes: 150,
  match_courts: 3,
  occupancy_unknown: false,
  registration_count: 0,
};
const pending = {
  id: 'r1',
  team_id: 't1',
  actor_id: 'coach',
  actor_name: 'Camille',
  proposal,
  note: 'Préparation tournoi',
  status: 'pending',
  decision: '',
  decider_name: null,
  decided_at: null,
  created_at: `${day}T10:00:00Z`,
  event_id: null,
};
let account: typeof coach;
let routes: Record<string, unknown>;
let mutations: { path: string; body: Record<string, unknown> }[];
let mutation: (path: string, body: Record<string, unknown>) => Response;
function reply(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
function open(path = `/app/planning?vue=mois&semaine=${day}`) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <AuthApp />
    </MemoryRouter>,
  );
}
beforeAll(() => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value() {
      this.setAttribute('open', '');
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true,
    value() {
      this.removeAttribute('open');
    },
  });
});
afterAll(() => {
  Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal');
  Reflect.deleteProperty(HTMLDialogElement.prototype, 'close');
});
beforeEach(() => {
  account = coach;
  mutations = [];
  mutation = () => {
    routes['/event-requests'] = [pending];
    return reply(pending, 201);
  };
  routes = {
    '/sections': [
      { id: 's1', name: 'Loisir' },
      { id: 's2', name: 'Compétition' },
    ],
    '/teams': [
      { id: 't1', name: 'Loisir 1', section_id: 's1', referent_id: null },
      { id: 't2', name: 'Loisir 2', section_id: 's1', referent_id: null },
      { id: 't3', name: 'Compétition 1', section_id: 's2', referent_id: null },
    ],
    '/gymnasiums': [{ id: 'g1', name: 'Paré', capacity: 3 }],
    '/users': [coach, admin],
    '/users/coach/assignments': [
      { id: 'a1', user_id: 'coach', team_id: 't1', kind: 'coach' },
      { id: 'a2', user_id: 'coach', team_id: 't2', kind: 'coach' },
      { id: 'a3', user_id: 'coach', team_id: 't3', kind: 'player' },
    ],
    '/events': [],
    '/event-requests': [],
    '/follows': [],
    '/change-requests': [],
  };
  document.cookie = 'lsoc_csrf=csrf; path=/';
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
      const path = new URL(String(input), 'http://localhost').pathname.replace('/api/v1', '');
      if (init?.method && init.method !== 'GET') {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        mutations.push({ path, body });
        return mutation(path, body);
      }
      return reply(path === '/auth/me' ? account : (routes[path] ?? []));
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  document.cookie = 'lsoc_csrf=; Max-Age=0; path=/';
});

it('dépose une demande pour plusieurs équipes coachées, avec ouverture ciblée et sans créer un événement', async () => {
  open();
  await userEvent.click(await screen.findByRole('button', { name: 'Nouvel événement' }));
  const teams = screen.getByRole('group', { name: 'Équipes organisatrices' });
  expect(within(teams).getAllByRole('checkbox').map((box) => box.parentElement?.textContent)).toEqual(['Tous', 'Loisir 1', 'Loisir 2']);
  await userEvent.click(within(teams).getByLabelText('Loisir 2'));
  await userEvent.click(within(teams).getByLabelText('Loisir 1'));
  await userEvent.type(screen.getByLabelText('Titre'), 'Stage interéquipes');
  await userEvent.type(screen.getByLabelText('Lieu extérieur'), 'Parc');
  await userEvent.click(
    within(
      screen.getByRole('group', { name: 'Ouvert aux inscriptions' }),
    ).getByLabelText('Compétition 1'),
  );
  // Directive du 11 octobre : un coach peut aussi proposer une récurrence.
  expect(screen.getByLabelText('Répéter chaque semaine')).not.toBeChecked();
  expect(screen.queryByLabelText('Référent')).not.toBeInTheDocument();
  expect(screen.queryByLabelText(/Forcer/)).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Envoyer la demande' }));
  expect(await screen.findByText(/Indiquez le nombre maximal d’inscrits/)).toBeInTheDocument();
  expect(mutations).toEqual([]);
  await userEvent.type(screen.getByLabelText('Nombre maximal d’inscrits'), '12');
  await userEvent.type(screen.getByLabelText('Description'), 'Ateliers puis matchs.');
  await userEvent.type(screen.getByLabelText('Commentaire'), 'Préparation tournoi');
  await userEvent.click(screen.getByRole('button', { name: 'Envoyer la demande' }));
  expect(await screen.findByText(/Demande envoyée aux administrateurs/)).toBeInTheDocument();
  expect(mutations).toEqual([
    {
      path: '/event-requests',
      body: {
        team_id: 't1',
        team_ids: ['t2'],
        title: 'Stage interéquipes',
        description: 'Ateliers puis matchs.',
        kind: 'training',
        gymnasium_id: null,
        location: 'Parc',
        starts_at: expect.stringMatching(/T1[67]:00:00\.000Z$/),
        ends_at: expect.stringMatching(/T1[89]:00:00\.000Z$/),
        courts: 0,
        registration_section_ids: [],
        registration_team_ids: ['t3'],
        registration_limit: 12,
        note: 'Préparation tournoi',
      },
    },
  ]);
  expect(await screen.findByText('En attente')).toBeInTheDocument();
}, 15000);

it('masque la demande de création sans rôle coach ou sans rattachement coach', async () => {
  account = { ...coach, roles: ['member'] };
  open();
  await screen.findByRole('heading', { name: 'Planning du club' });
  expect(screen.queryByRole('button', { name: 'Nouvel événement' })).not.toBeInTheDocument();
});

it('conserve le suivi des demandes acceptées et refusées avec motif et lien vers l’événement créé', async () => {
  routes['/event-requests'] = [
    { ...pending, status: 'accepted', decision: 'Créneau disponible', event_id: 'e1' },
    {
      ...pending,
      id: 'r2',
      status: 'rejected',
      decision: 'Gymnase indisponible',
      proposal: { ...proposal, title: 'Stage refusé' },
    },
  ];
  open();
  const requests = await screen.findByRole('region', { name: 'Mes demandes d’événements' });
  expect(await within(requests).findByText('Acceptée')).toBeInTheDocument();
  expect(within(requests).getByText('Refusée')).toBeInTheDocument();
  expect(within(requests).getByText(/Gymnase indisponible/)).toBeInTheDocument();
  expect(within(requests).getAllByRole('link', { name: 'Voir l’événement' })).toHaveLength(1);
  expect(within(requests).getByRole('link', { name: 'Voir l’événement' })).toHaveAttribute(
    'href',
    expect.stringContaining('event=e1'),
  );
});

it('permet à un auteur dont le rôle coach a été retiré de suivre la décision sans déposer de nouvelle demande', async () => {
  account = { ...coach, roles: ['member'] };
  routes['/event-requests'] = [{ ...pending, status: 'rejected', decision: 'Rattachement retiré' }];
  open();
  expect(await screen.findByText(/Rattachement retiré/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Nouvel événement' })).not.toBeInTheDocument();
});

it.each([
  { accept: 'yes', force: true },
  { accept: 'no', force: false },
])(
  'examine une création séparément des modifications et enregistre la décision $accept',
  async ({ accept, force }) => {
    account = admin;
    routes['/event-requests'] = [pending];
    mutation = (_path, body) => {
      routes['/event-requests'] = [
        { ...pending, status: body.accept ? 'accepted' : 'rejected', decision: body.reason },
      ];
      return reply({ ...pending, status: body.accept ? 'accepted' : 'rejected' });
    };
    open('/app/administration?tab=requests');
    await userEvent.click(await screen.findByRole('button', { name: 'Nouveaux événements' }));
    expect(await screen.findByRole('heading', { name: 'Stage proposé' })).toBeInTheDocument();
    expect(screen.getByText('Préparation tournoi')).toBeInTheDocument();
    expect(screen.getByText('Compétition 1')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Examiner' }));
    await userEvent.selectOptions(screen.getByLabelText('Décision'), accept);
    await userEvent.type(screen.getByLabelText('Message au référent'), 'Décision motivée');
    if (force) await userEvent.click(screen.getByLabelText(/Confirmer le dépassement/));
    await userEvent.click(screen.getByRole('button', { name: 'Enregistrer la décision' }));
    expect(await screen.findByText('Décision enregistrée.')).toBeInTheDocument();
    expect(mutations).toEqual([
      {
        path: '/event-requests/r1/decision',
        body: {
          accept: accept === 'yes',
          reason: 'Décision motivée',
          force,
          acknowledge_ffvb: false,
        },
      },
    ]);
  },
);

it('préserve la proposition et le motif si la capacité empêche l’acceptation', async () => {
  account = admin;
  routes['/event-requests'] = [pending];
  mutation = () => reply({ detail: { code: 'capacity_exceeded' } }, 409);
  open('/app/administration?tab=requests');
  await userEvent.click(await screen.findByRole('button', { name: 'Nouveaux événements' }));
  await userEvent.click(await screen.findByRole('button', { name: 'Examiner' }));
  await userEvent.selectOptions(screen.getByLabelText('Décision'), 'yes');
  await userEvent.type(screen.getByLabelText('Message au référent'), 'À revoir');
  await userEvent.click(screen.getByRole('button', { name: 'Enregistrer la décision' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('capacité');
  expect(screen.getByLabelText('Message au référent')).toHaveValue('À revoir');
  expect(screen.getByRole('button', { name: 'Enregistrer la décision' })).toBeEnabled();
});

it('inclut les ouvertures de mes équipes sans ouvrir toute leur section dans mon planning', async () => {
  routes['/users/coach/assignments'] = [
    { id: 'a1', user_id: 'coach', team_id: 't1', kind: 'player' },
  ];
  routes['/events'] = [
    { ...event, referent_id: 'admin', section_ids: ['s2'], registration_team_ids: ['t1'] },
    {
      ...event,
      id: 'e2',
      title: 'Autre équipe uniquement',
      referent_id: 'admin',
      section_ids: ['s2'],
      registration_team_ids: ['t2'],
    },
    {
      ...event,
      id: 'e3',
      title: 'Ouverture section',
      referent_id: 'admin',
      section_ids: ['s2'],
      registration_team_ids: [],
      registration_section_ids: ['s1'],
    },
  ];
  open(`/app/mon-planning?vue=mois&semaine=${day}`);
  const selected = await screen.findByRole('region', { name: `Événements du ${dayLabel(day)}` });
  expect(await within(selected).findByRole('link', { name: /Séance équipe/ })).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: /Autre équipe uniquement/ })).not.toBeInTheDocument();
  expect(within(selected).getByRole('link', { name: /Ouverture section/ })).toBeInTheDocument();
});

it('affiche une ouverture uniquement par équipe et permet l’inscription selon l’éligibilité du serveur', async () => {
  routes['/events/e1'] = event;
  routes['/events/e1/registrations'] = {
    event_id: 'e1',
    open: true,
    limit: 12,
    count: 0,
    registered: false,
    eligible: true,
    participants: null,
  };
  open('/app/planning?event=e1');
  const dialog = await screen.findByRole('dialog', { name: 'Séance équipe' });
  expect(await within(dialog).findByText(/Ouvert aux équipes : Compétition 1/)).toBeInTheDocument();
  expect(within(dialog).getByRole('button', { name: 'S’inscrire' })).toBeEnabled();
});

it('l’administrateur ouvre un événement à une équipe avec une limite obligatoire', async () => {
  account = admin;
  mutation = () => reply(event, 201);
  open();
  await userEvent.click(await screen.findByRole('button', { name: 'Nouvel événement' }));
  await userEvent.type(screen.getByLabelText('Titre'), 'Séance découverte');
  await userEvent.click(
    within(screen.getByRole('group', { name: 'Sections et équipes organisatrices' })).getByLabelText('Loisir'),
  );
  await userEvent.click(
    within(
      screen.getByRole('group', { name: 'Ouvert aux inscriptions' }),
    ).getByLabelText('Compétition 1'),
  );
  await userEvent.click(screen.getByRole('button', { name: 'Créer' }));
  expect(await screen.findByText(/Indiquez le nombre maximal d’inscrits/)).toBeInTheDocument();
  expect(mutations).toEqual([]);
  await userEvent.type(screen.getByLabelText('Nombre maximal d’inscrits'), '12');
  await userEvent.click(screen.getByRole('button', { name: 'Créer' }));
  await waitFor(() => expect(mutations).toHaveLength(1));
  expect(mutations[0]).toMatchObject({
    path: '/events',
    body: { registration_team_ids: ['t3'], registration_section_ids: [], registration_limit: 12 },
  });
});

it('l’administrateur coche « Tous » pour les équipes organisatrices et les inscriptions', async () => {
  account = admin;
  mutation = () => reply(event, 201);
  open();
  await userEvent.click(await screen.findByRole('button', { name: 'Nouvel événement' }));
  await userEvent.type(screen.getByLabelText('Titre'), 'Tournoi interne');
  const organisers = screen.getByRole('group', { name: 'Sections et équipes organisatrices' });
  await userEvent.click(within(organisers).getByLabelText('Tous'));
  expect(within(organisers).getByLabelText('Loisir 2')).toBeChecked();
  await userEvent.click(within(organisers).getByLabelText('Loisir 2'));
  expect(within(organisers).getByLabelText('Tous')).not.toBeChecked();
  await userEvent.click(within(organisers).getByLabelText('Tous'));
  await userEvent.click(
    within(screen.getByRole('group', { name: 'Ouvert aux inscriptions' })).getByLabelText('Tous'),
  );
  await userEvent.type(screen.getByLabelText('Nombre maximal d’inscrits'), '40');
  await userEvent.click(screen.getByRole('button', { name: 'Créer' }));
  await waitFor(() => expect(mutations).toHaveLength(1));
  expect(mutations[0]).toMatchObject({
    path: '/events',
    body: {
      section_ids: ['s1', 's2'],
      team_ids: ['t1', 't2', 't3'],
      registration_section_ids: ['s1', 's2'],
      registration_team_ids: ['t1', 't2', 't3'],
    },
  });
});

it('un événement sans organisateur exige des inscriptions libres et une confirmation', async () => {
  account = admin;
  mutation = () => reply(event, 201);
  open();
  await userEvent.click(await screen.findByRole('button', { name: 'Nouvel événement' }));
  await userEvent.type(screen.getByLabelText('Titre'), 'Portes ouvertes');
  await userEvent.click(screen.getByRole('button', { name: 'Créer' }));
  expect(await screen.findByText(/Sans section ni équipe organisatrice/)).toBeInTheDocument();
  await userEvent.click(
    within(screen.getByRole('group', { name: 'Ouvert aux inscriptions' })).getByLabelText('Compétition 1'),
  );
  await userEvent.type(screen.getByLabelText('Nombre maximal d’inscrits'), '20');
  await userEvent.click(screen.getByRole('button', { name: 'Créer' }));
  const dialog = await screen.findByRole('dialog', { name: 'Événement sans catégorie organisatrice' });
  expect(within(dialog).getByText(/n’a pas de catégorie/)).toBeInTheDocument();
  expect(mutations).toEqual([]);
  await userEvent.click(within(dialog).getByRole('button', { name: 'Enregistrer sans organisateur' }));
  await waitFor(() => expect(mutations).toHaveLength(1));
  expect(mutations[0]).toMatchObject({
    path: '/events',
    body: { section_ids: [], team_ids: [], registration_team_ids: ['t3'], registration_limit: 20 },
  });
});

it('un coach sans rattachement coach voit le bouton et apprend comment obtenir ce rattachement', async () => {
  routes[`/users/${coach.id}/assignments`] = [];
  open();
  await userEvent.click(await screen.findByRole('button', { name: 'Nouvel événement' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(/référent d’une équipe ou y être rattaché comme coach/);
  expect(screen.queryByRole('group', { name: 'Équipes organisatrices' })).not.toBeInTheDocument();
});

it('un adhérent référent d’une équipe, sans rôle coach, peut demander un événement pour cette équipe', async () => {
  account = { ...coach, roles: ['member'] };
  routes['/users/coach/assignments'] = [{ id: 'a9', user_id: 'coach', team_id: 't1', kind: 'player' }];
  routes['/teams'] = [
    { id: 't1', name: 'Loisir 1', section_id: 's1', referent_id: null },
    { id: 't2', name: 'Loisir 2', section_id: 's1', referent_id: 'coach' },
  ];
  open();
  await userEvent.click(await screen.findByRole('button', { name: 'Nouvel événement' }));
  const teams = await screen.findByRole('group', { name: 'Équipes organisatrices' });
  // Seule équipe possible : elle est cochée d’office.
  expect(within(teams).getAllByRole('checkbox')).toHaveLength(1);
  expect(within(teams).getByLabelText('Loisir 2')).toBeChecked();
});

it('un coach propose un entraînement récurrent par jours et heures', async () => {
  open();
  await userEvent.click(await screen.findByRole('button', { name: 'Nouvel événement' }));
  await userEvent.click(within(screen.getByRole('group', { name: 'Équipes organisatrices' })).getByLabelText('Loisir 1'));
  await userEvent.type(screen.getByLabelText('Titre'), 'Entraînement jeunes');
  await userEvent.type(screen.getByLabelText('Lieu extérieur'), 'Parc');
  await userEvent.click(screen.getByLabelText('Répéter chaque semaine'));
  expect(screen.queryByText('Début (Europe/Paris)')).not.toBeInTheDocument();
  const days = screen.getByRole('group', { name: 'Jours de répétition' });
  await userEvent.click(within(days).getByLabelText('Mardi'));
  await userEvent.click(within(days).getByLabelText('Jeudi'));
  await userEvent.click(screen.getByRole('button', { name: 'Envoyer la demande' }));
  expect(await screen.findByText(/Demande envoyée aux administrateurs/)).toBeInTheDocument();
  expect(mutations[0]).toMatchObject({
    path: '/event-requests',
    body: { team_id: 't1', team_ids: [], weekdays: [1, 3], until: nextJuly31() },
  });
});

it('l’administrateur désigne plusieurs équipes organisatrices sans cocher de section', async () => {
  account = admin;
  mutation = () => reply(event, 201);
  open();
  await userEvent.click(await screen.findByRole('button', { name: 'Nouvel événement' }));
  await userEvent.type(screen.getByLabelText('Titre'), 'Tournoi interne');
  const teams = screen.getByRole('group', { name: 'Sections et équipes organisatrices' });
  await userEvent.click(within(teams).getByLabelText('Loisir 1'));
  await userEvent.click(within(teams).getByLabelText('Compétition 1'));
  await userEvent.click(screen.getByRole('button', { name: 'Créer' }));
  await waitFor(() => expect(mutations).toHaveLength(1));
  expect(mutations[0]).toMatchObject({ path: '/events', body: { section_ids: [], team_ids: ['t1', 't3'] } });
});

it('refuse au coach une demande sur un gymnase déjà complet, avec le message du serveur', async () => {
  mutation = () =>
    reply({ detail: { code: 'no_courts', message: 'Aucun terrain disponible le 15/10/2026 à 18:00. Choisissez un autre créneau ou un autre gymnase.' } }, 409);
  open();
  await userEvent.click(await screen.findByRole('button', { name: 'Nouvel événement' }));
  await userEvent.click(within(screen.getByRole('group', { name: 'Équipes organisatrices' })).getByLabelText('Loisir 1'));
  await userEvent.type(screen.getByLabelText('Titre'), 'Séance');
  await userEvent.selectOptions(screen.getByLabelText('Gymnase du club'), 'g1');
  await userEvent.click(screen.getByRole('button', { name: 'Envoyer la demande' }));
  expect(await screen.findByText(/Aucun terrain disponible le 15\/10\/2026 à 18:00/)).toBeInTheDocument();
});

it('avertit l’administrateur d’une demande sur une indisponibilité, sans exiger de forçage', async () => {
  account = admin;
  routes['/event-requests'] = [{ ...pending, unavailability: ['15/10/2026 : Travaux'] }];
  open('/app/administration?tab=requests&type=events');
  const warning = await screen.findByRole('note');
  expect(warning).toHaveTextContent('Gymnase indisponible sur ce créneau.');
  expect(warning).toHaveTextContent('15/10/2026 : Travaux');
});
