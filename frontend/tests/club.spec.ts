import { expect, test, type Page } from '@playwright/test';

type Row = Record<string, unknown>;
const account: Row = { id: 'member-1', username: 'camille', first_name: 'Camille', category: 'adult', roles: ['member'], active: true, email: null, messaging_allowed: true, followed_email: true, referent_email: true, admin_email: true };

function parisMonday(): string {
  const day = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Paris' }).format(new Date());
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return date.toISOString().slice(0, 10);
}
// Jour d’un événement de la semaine : sur téléphone, le planning n’affiche que le jour choisi.
function day(offset: number) {
  const date = new Date(`${parisMonday()}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}
function at(offset: number, time: string) {
  return new Date(`${day(offset)}T${time}:00+01:00`).toISOString();
}
const base = { section_ids: ['section-1'], location: '', referent_ids: ['member-1'], direct_edit: false, cancelled: false, version: 1, series_id: null, exception: false, ffvb_match_id: null, kickoff_at: null, before_minutes: 75, after_minutes: 150, match_courts: 3, occupancy_unknown: false, registration_section_ids: [], registration_limit: null, registration_count: 0 };
const events: Row[] = [
  { ...base, id: 'event-1', title: 'Entraînement loisir du mercredi soir', kind: 'training', gymnasium_id: 'gym-1', starts_at: at(2, '19:00'), ends_at: at(2, '21:00'), courts: 2, series_id: 'series-1', registration_section_ids: ['section-1'], registration_limit: 12, registration_count: 5 },
  { ...base, id: 'event-2', title: 'LSO COLOMBES / AS SP BOURG LA REINE 2', kind: 'match', gymnasium_id: 'gym-1', starts_at: at(4, '19:15'), ends_at: at(4, '23:00'), courts: 3, ffvb_match_id: 'match-1', kickoff_at: at(4, '20:30'), referent_ids: ['admin-1'] },
];

async function prepare(page: Page) {
  const mutations: { path: string; method: string; body: unknown }[] = [];
  await page.context().addCookies([{ name: 'lsoc_csrf', value: 'browser-csrf', domain: 'localhost', path: '/' }]);
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace('/api/v1', '');
    const method = request.method();
    const reply = (value: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: status === 204 ? '' : JSON.stringify(value) });
    if (method !== 'GET') {
      expect(request.headers()['x-csrf-token']).toBe('browser-csrf');
      mutations.push({ path, method, body: request.postDataJSON() });
      if (path.endsWith('/follow')) return reply({ id: 'follow-1', user_id: 'member-1', event_id: path.split('/')[2], series_id: null }, 201);
      if (path.endsWith('/questions')) return reply({ id: 'thread-1', user_id: 'member-1', event_id: 'event-1' }, 201);
      return reply({}, 201);
    }
    const data: Record<string, unknown> = {
      '/auth/me': account,
      '/sections': [{ id: 'section-1', name: 'Loisir mixte' }],
      '/teams': [{ id: 'team-1', name: 'Loisir 1', section_id: 'section-1', referent_ids: ['admin-1'] }],
      '/gymnasiums': [{ id: 'gym-1', name: 'Gymnase Ambroise Paré', capacity: 3 }, { id: 'gym-2', name: 'Gymnase Jules Ladoumègue', capacity: 2 }],
      '/users/member-1/assignments': [{ id: 'assignment-1', user_id: 'member-1', team_id: 'team-1', kind: 'player' }],
      '/profiles/admin-1': { id: 'admin-1', first_name: 'Alix', category: 'adult' },
      '/events': events,
      '/events/event-1': events[0],
      '/events/event-2': events[1],
      '/ffvb/matches': [{ id: 'match-1', match_code: 'BRC007', season: '2026/2027', entity: 'PTIDF92', source_id: 's', official: {}, protected: {}, last_verified_at: at(0, '08:00'), last_changed_at: null, suspended_until: null, disabled: false, missing: false }],
      '/questions': [{ id: 'thread-1', user_id: 'member-1', event_id: 'event-1' }],
      '/questions/thread-1/messages': [
        { id: 'message-1', thread_id: 'thread-1', author_id: 'member-1', body: 'Bonjour, faut-il apporter un ballon ?', created_at: at(0, '09:00'), read_at: at(0, '10:00') },
        { id: 'message-2', thread_id: 'thread-1', author_id: 'admin-1', body: 'Non, le club en fournit. À mercredi !', created_at: at(0, '10:00'), read_at: null },
      ],
      '/events/event-1/registrations': { event_id: 'event-1', open: true, limit: 12, count: 5, registered: false, eligible: true, participants: null },
      '/events/event-2/registrations': { event_id: 'event-2', open: false, limit: null, count: 0, registered: false, eligible: false, participants: null },
      '/unread': { messages: 1, notifications: 1, threads: ['thread-1'], thread_counts: { 'thread-1': 1 } },
      '/notifications': [{ id: 'notification-1', kind: 'event_changed', title: 'Modification : Entraînement loisir du mercredi soir', event_id: 'event-1', read_at: null, created_at: at(0, '11:00') }],
      '/gymnasiums/gym-1/availability': { gymnasium_id: 'gym-1', capacity: 3, segments: [
        { starts_at: at(2, '19:00'), ends_at: at(2, '21:00'), occupied: 2, available: 1, excess: 0 },
        { starts_at: at(4, '19:15'), ends_at: at(4, '23:00'), occupied: 4, available: 0, excess: 1 },
      ] },
      '/availability-blocks': [{ id: 'block-1', gymnasium_id: 'gym-1', title: 'Travaux de peinture', starts_at: at(4, '18:00'), ends_at: at(4, '23:00'), courts: 1 }],
    };
    if (path in data) {
      const value = data[path];
      return reply(Array.isArray(value) && Number(url.searchParams.get('offset') ?? 0) > 0 ? [] : value);
    }
    return reply([]);
  });
  return mutations;
}
async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

test('planning, détail, suivi et question depuis un événement', async ({ page }) => {
  const mutations = await prepare(page);
  await page.goto(`/app/planning?jour=${day(2)}`);
  await page.getByRole('link', { name: /Entraînement loisir du mercredi soir/ }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Entraînement loisir du mercredi soir' });
  await expect(dialog).toBeVisible();
  await noOverflow(page);
  await dialog.getByRole('button', { name: 'Suivre l’événement' }).click();
  await expect(dialog.getByRole('button', { name: 'Ne plus suivre' })).toBeVisible();
  await dialog.getByLabel('Poser une question aux administrateurs').fill('Le créneau est-il maintenu ?');
  await dialog.getByRole('button', { name: 'Envoyer la question' }).click();
  await expect(dialog.getByText('Question envoyée.')).toBeVisible();
  expect(mutations.map((item) => item.path)).toEqual(['/events/event-1/follow', '/events/event-1/questions']);
  await dialog.getByRole('button', { name: 'Fermer' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page).not.toHaveURL(/event=/);
});

test('sections du club utilisables de 320 à 2560 px sans débordement', async ({ page }, info) => {
  test.setTimeout(240_000);
  test.skip(info.project.name !== 'desktop', 'Matrice responsive exécutée une fois');
  await prepare(page);
  const pages: [string, RegExp | string][] = [
    ['/app', 'Bonjour Camille'],
    ['/app/planning', 'Planning du club'],
    ['/app/planning?event=event-2', 'LSO COLOMBES / AS SP BOURG LA REINE 2'],
    ['/app/planning?event=event-1', 'Inscriptions'],
    ['/app/gymnases', 'Gymnases'],
    ['/app/messagerie?thread=thread-1', 'Entraînement loisir du mercredi soir'],
    ['/app/mon-planning', 'Mon planning'],
    ['/app/sections', 'Loisir mixte'],
  ];
  for (const [width, height] of [[320, 568], [390, 844], [768, 1024], [1024, 768], [1440, 900], [2560, 1440]] as const) {
    await page.setViewportSize({ width, height });
    for (const [path, heading] of pages) {
      await page.goto(path);
      await expect(page.getByRole('heading', { name: heading }).first()).toBeVisible();
      await noOverflow(page);
    }
  }
  const previews: [string, string, string][] = [['home', '/app', 'Marquer comme lu'], ['planning', `/app/planning?jour=${day(2)}`, 'Entraînement loisir du mercredi soir'], ['event', '/app/planning?event=event-2', 'Match BRC007'], ['registrations', '/app/planning?event=event-1', '5 inscrits sur 12'], ['gyms', '/app/gymnases', 'Travaux de peinture'], ['messages', '/app/messagerie?thread=thread-1', 'Non, le club en fournit'], ['sections', '/app/sections', 'Joueur']];
  for (const [name, path, text] of previews) {
    for (const [device, size] of [['desktop', { width: 1440, height: 900 }], ['mobile', { width: 390, height: 844 }]] as const) {
      await page.setViewportSize(size);
      await page.goto(path);
      await expect(page.getByText(text).filter({ visible: true }).first()).toBeVisible();
      await page.screenshot({ path: `.cache/previews/club-${name}-${device}.png`, fullPage: true });
    }
  }
});
