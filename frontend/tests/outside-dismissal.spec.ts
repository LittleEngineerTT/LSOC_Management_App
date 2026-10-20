import { expect, test, type Locator, type Page } from '@playwright/test';

async function prepare(page: Page) {
  const mutations: string[] = [];
  const event = {
    id: 'outside-event', title: 'Séance à fermer', kind: 'training',
    starts_at: '2026-10-14T17:00:00Z', ends_at: '2026-10-14T19:00:00Z',
    section_ids: [], gymnasium_id: null, location: 'Colombes', courts: 1,
    referent_ids: [], direct_edit: false, cancelled: false, version: 1,
    series_id: null, exception: false, ffvb_match_id: null, kickoff_at: null,
    before_minutes: 75, after_minutes: 150, match_courts: 3,
    occupancy_unknown: false, registration_section_ids: [], registration_limit: null,
    registration_count: 0,
  };
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace('/api/v1', '');
    if (request.method() !== 'GET') mutations.push(`${request.method()} ${path}`);
    const data: Record<string, unknown> = {
      '/auth/me': { id: 'admin', first_name: 'Camille', category: 'adult', roles: ['admin'], active: true },
      '/sections': [{ id: 'section', name: 'Section à supprimer' }],
      '/events': [event], '/events/outside-event': event,
      '/events/outside-event/registrations': { event_id: event.id, open: false, limit: null, count: 0, registered: false, eligible: false, participants: null },
      '/ffvb/club': { club_code: '0926620' },
      '/ffvb/defaults': { before_minutes: 75, after_minutes: 150, courts: 3 },
    };
    const body = Number(url.searchParams.get('offset') ?? 0) > 0 ? [] : data[path] ?? [];
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
  });
  return mutations;
}

async function insideAndDrag(page: Page, dialog: Locator) {
  const bounds = await dialog.boundingBox();
  expect(bounds).not.toBeNull();
  // Empty dialog padding is still inside the modal, even though its target is <dialog>.
  await page.mouse.click(bounds!.x + 3, bounds!.y + 3);
  await expect(dialog).toBeVisible();
  await page.mouse.move(bounds!.x + 3, bounds!.y + 3);
  await page.mouse.down();
  await page.mouse.move(2, 2);
  await page.mouse.up();
  await expect(dialog).toBeVisible();
}

test('le détail reste ouvert à l’intérieur et ferme au clic extérieur avec nettoyage de l’URL', async ({ page }) => {
  await prepare(page);
  await page.goto('/app/planning?event=outside-event');
  const dialog = page.getByRole('dialog', { name: 'Séance à fermer' });
  await expect(dialog).toBeVisible();
  await insideAndDrag(page, dialog);
  await page.mouse.click(2, 2);
  await expect(dialog).toHaveCount(0);
  await expect(page).not.toHaveURL(/event=/);
});

test('la confirmation ferme au clic extérieur sans appeler la suppression', async ({ page }) => {
  const mutations = await prepare(page);
  await page.goto('/app/administration?tab=sections');
  await page.getByRole('button', { name: 'Supprimer Section à supprimer', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await insideAndDrag(page, dialog);
  await page.mouse.click(2, 2);
  await expect(dialog).toHaveCount(0);
  expect(mutations).toEqual([]);
  await expect(page.getByRole('heading', { name: 'Section à supprimer', exact: true })).toBeVisible();
});

test('les options du profil ferment au clic extérieur', async ({ page }) => {
  await prepare(page);
  await page.goto('/app/planning');
  const button = page.getByRole('button', { name: 'Options du profil de Camille' });
  await button.click();
  await expect(button).toHaveAttribute('aria-expanded', 'true');
  await page.locator('.profile-caption').click();
  await expect(button).toHaveAttribute('aria-expanded', 'true');
  await page.getByRole('heading', { name: 'Planning', exact: true }).click();
  await expect(button).toHaveAttribute('aria-expanded', 'false');
});

test('le menu mobile ferme au clic extérieur et conserve son bouton et son contenu interactifs', async ({ page }, info) => {
  test.skip(info.project.name !== 'mobile', 'Le menu repliable est réservé au mobile.');
  await prepare(page);
  await page.goto('/app/planning');
  const button = page.getByRole('button', { name: /(?:Ouvrir|Fermer) les applications/ });
  await button.click();
  await expect(button).toHaveAttribute('aria-expanded', 'true');
  await page.locator('.sidebar-bottom').click();
  await expect(button).toHaveAttribute('aria-expanded', 'true');
  await page.getByRole('heading', { name: 'Planning', exact: true }).click();
  await expect(button).toHaveAttribute('aria-expanded', 'false');
  await button.click();
  await expect(button).toHaveAttribute('aria-expanded', 'true');
  await button.click();
  await expect(button).toHaveAttribute('aria-expanded', 'false');
});
