import { expect, test, type Page } from '@playwright/test';

const account = { id: 'm', username: 'camille', first_name: 'Camille', roles: ['member'], active: true, email: null };
const base = { kind: 'training', gymnasium_id: 'g1', section_ids: [], location: '', starts_at: '2026-10-14T16:00:00Z', ends_at: '2026-10-14T18:00:00Z', courts: 2, referent_id: 'm', direct_edit: false, cancelled: false, version: 1, series_id: null, exception: false, ffvb_match_id: null, kickoff_at: null, before_minutes: 75, after_minutes: 150, match_courts: 3, occupancy_unknown: false, registration_section_ids: [], registration_limit: null, registration_count: 0 };
const events = [{ ...base, id: 'e1', title: 'Séance locale' }, { ...base, id: 'e2', title: 'Match fédéral', kind: 'match', ffvb_match_id: 'match-1', starts_at: '2026-10-16T16:00:00Z', ends_at: '2026-10-16T20:00:00Z' }];
async function prepare(page: Page) {
  const calls: URL[] = [];
  await page.route('**/api/v1/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace('/api/v1', '');
    calls.push(url);
    let value: unknown = [];
    if (path === '/auth/me') value = account;
    if (path === '/gymnasiums') value = [{ id: 'g1', name: 'Paré', capacity: 3 }, { id: 'g2', name: 'Ladoumègue', capacity: 2 }];
    if (path === '/events') value = events;
    if (path === '/events/e1') value = events[0];
    if (path === '/events/e1/registrations') value = { event_id: 'e1', open: false, limit: null, count: 0, registered: false, eligible: false, participants: null };
    if (path === '/availability-blocks') value = [{ id: 'b1', title: 'Travaux de peinture', gymnasium_id: 'g1', courts: 1, starts_at: '2026-10-13T21:00:00Z', ends_at: '2026-10-15T22:00:00Z' }];
    if (path.endsWith('/availability')) value = { capacity: 3, segments: [
      { starts_at: url.searchParams.get('starts_at'), ends_at: '2026-10-13T21:00:00Z', occupied: 0, available: 3, excess: 0 },
      { starts_at: '2026-10-13T21:00:00Z', ends_at: '2026-10-15T22:00:00Z', occupied: 2, available: 1, excess: 0 },
      { starts_at: '2026-10-15T22:00:00Z', ends_at: '2026-10-16T18:00:00Z', occupied: 3, available: 0, excess: 0 },
      { starts_at: '2026-10-16T18:00:00Z', ends_at: '2026-10-16T20:00:00Z', occupied: 4, available: 0, excess: 1 },
      { starts_at: '2026-10-16T20:00:00Z', ends_at: url.searchParams.get('ends_at'), occupied: 0, available: 3, excess: 0 },
    ] };
    if (Number(url.searchParams.get('offset') ?? 0) > 0 && Array.isArray(value)) value = [];
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(value) });
  });
  return calls;
}

test('calendrier des gymnases : créneaux libres, complet, dépassement et détail conservé', async ({ page }) => {
  const calls = await prepare(page);
  await page.goto('/app/gymnases?gymnase=g1&semaine=2026-10-12');
  const week = page.getByRole('region', { name: 'Calendrier de disponibilité de la semaine' });
  await expect(week.getByRole('region', { name: 'Lundi 12 octobre' })).toContainText('3 libres sur 3');
  await week.getByLabel('Grille horaire des disponibilités, défilement horizontal et vertical').scrollIntoViewIfNeeded();
  await expect(week.getByRole('region', { name: 'Lundi 12 octobre' }).getByText('3 libres sur 3')).toBeInViewport();
  await expect(week.getByRole('region', { name: 'Jeudi 15 octobre' })).toContainText('1 libre sur 3');
  await expect(week.locator('.gym-capacity-band.gym-full').first()).toContainText('Complet');
  await expect(week.locator('.gym-capacity-band.gym-excess')).toContainText('Complet · 1 terrain en excès');
  await expect(week.getByRole('link', { name: /Séance locale/ })).toHaveClass(/origin-local/);
  await expect(week.getByRole('link', { name: /Match fédéral/ })).toHaveClass(/origin-ffvb/);
  await page.getByRole('button', { name: 'Mois', exact: true }).click();
  const month = page.getByRole('region', { name: 'Calendrier de disponibilité du mois' });
  await expect(month.getByRole('button', { name: /Voir les disponibilités/ })).toHaveCount(42);
  await month.getByRole('button', { name: /Voir les disponibilités du Mercredi 14 octobre/ }).click();
  const detail = page.getByRole('region', { name: 'Disponibilités du Mercredi 14 octobre' });
  await expect(detail).toContainText('00:00 – 24:00');
  await expect(detail).toContainText('1 libre sur 3');
  await expect(detail).toContainText('Travaux de peinture');
  await expect(detail.getByRole('link', { name: /Travaux/ })).toHaveCount(0);
  await detail.getByRole('link', { name: /Séance locale/ }).click();
  await expect(page.getByRole('dialog', { name: 'Séance locale' })).toBeVisible();
  await expect(page).toHaveURL(/vue=mois/);
  await expect(page).toHaveURL(/jour=2026-10-14/);
  await page.getByRole('button', { name: 'Fermer', exact: true }).click();
  await page.getByRole('navigation', { name: 'Gymnases' }).getByRole('link', { name: /Ladoumègue/ }).click();
  await expect(page).toHaveURL(/gymnase=g2/);
  await expect(page).toHaveURL(/vue=mois/);
  await expect(page).toHaveURL(/jour=2026-10-14/);
  await expect(page).not.toHaveURL(/event=/);
  expect(calls.some((url) => url.pathname.endsWith('/availability') && url.searchParams.get('starts_at') === '2026-09-27T22:00:00.000Z' && url.searchParams.get('ends_at') === '2026-11-08T23:00:00.000Z')).toBe(true);
});

test('calendrier des gymnases utilisable de 320 à 2560 px', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'Matrice exécutée une fois.');
  test.setTimeout(150_000);
  await prepare(page);
  for (const [width, height] of [[320,568],[360,800],[390,844],[430,932],[768,1024],[1024,768],[1440,900],[1920,1080],[2560,1440]] as const) {
    await page.setViewportSize({ width, height });
    for (const vue of ['semaine', 'mois']) {
      await page.goto(`/app/gymnases?semaine=2026-10-12&vue=${vue}&jour=2026-10-14`);
      await expect(page.getByRole('region', { name: 'Disponibilités du Mercredi 14 octobre' })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${vue} ${width}px`).toBe(true);
      if (vue === 'semaine') {
        const scroller = page.getByLabel('Grille horaire des disponibilités, défilement horizontal et vertical');
        expect(await scroller.evaluate((node) => node.scrollWidth > node.clientWidth || innerWidth >= 1920)).toBe(true);
      }
    }
  }
  for (const [device, viewport] of [['desktop',{width:1440,height:900}],['mobile',{width:390,height:844}]] as const) {
    await page.setViewportSize(viewport);
    for (const vue of ['semaine','mois']) {
      await page.goto(`/app/gymnases?semaine=2026-10-12&vue=${vue}&jour=2026-10-14`);
      await expect(page.getByRole('region', { name: 'Disponibilités du Mercredi 14 octobre' })).toBeVisible();
      await page.screenshot({ path: `.cache/previews/gym-calendar-${vue}-${device}.png`, fullPage: true });
    }
  }
});
