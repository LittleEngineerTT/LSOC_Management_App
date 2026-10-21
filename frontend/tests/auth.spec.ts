import { expect, test, type Page } from '@playwright/test';

const account = {
  id: 'browser-user', username: 'camille', first_name: 'Camille', category: 'adult', roles: ['admin'],
  active: true, email: 'camille@example.org', messaging_allowed: true,
  followed_email: true, referent_email: true, admin_email: true,
};
const token = 'valid-token-for-the-browser-authentication-tests';

// Les sections chargent leurs données ; sans backend, elles reçoivent des listes vides.
async function emptyApi(page: Page) {
  await page.route('**/api/v1/**', (route) => route.fulfill({ json: [] }));
}
async function anonymous(page: Page) {
  await page.route('**/api/v1/auth/me', (route) => route.fulfill({ status: 401, json: { detail: 'Connexion requise' } }));
}
async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

test('connexion, accueil, menus, restauration et déconnexion CSRF', async ({ page, context }) => {
  let connected = false;
  await emptyApi(page);
  await page.route('**/api/v1/auth/me', (route) => route.fulfill(connected ? { json: account } : { status: 401, json: { detail: 'Connexion requise' } }));
  await page.route('**/api/v1/auth/login', async (route) => {
    expect(route.request().postDataJSON()).toEqual({ username: account.username, password: 'password-browser-123' });
    connected = true;
    await context.addCookies([{ name: 'lsoc_csrf', value: 'browser-csrf', url: 'http://localhost:5173' }]);
    await route.fulfill({ json: { user: account, csrf_token: 'browser-csrf' } });
  });
  await page.route('**/api/v1/auth/logout', async (route) => {
    expect(route.request().headers()['x-csrf-token']).toBe('browser-csrf');
    connected = false;
    await route.fulfill({ status: 204 });
  });
  await page.goto('/login');
  await page.getByLabel('Identifiant').fill(account.username);
  await page.getByLabel('Mot de passe', { exact: true }).fill('password-browser-123');
  await page.getByRole('button', { name: 'Se connecter', exact: true }).click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByRole('heading', { name: 'Bonjour Camille' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Accueil' })).toBeVisible();
  await noOverflow(page);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Accueil' })).toBeVisible();
  await page.getByRole('link', { name: 'Mon planning', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Mon planning' })).toBeVisible();
  await expect(page.getByText(/Rien de prévu/)).toBeVisible();
  await page.getByRole('button', { name: 'Options du profil de Camille' }).click();
  await page.getByRole('link', { name: 'Mon profil' }).click();
  await expect(page.getByRole('heading', { name: 'Mon profil' })).toBeVisible();
  await expect(page.locator('#profile-options')).toHaveCount(0);
  await page.getByRole('button', { name: 'Options du profil de Camille' }).click();
  await page.getByRole('button', { name: 'Se déconnecter' }).click();
  // Déconnecté, on reste sur le site du club, en invité.
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByRole('heading', { name: 'Bienvenue au LSO Colombes Volley' })).toBeVisible();
});

test('récupération, validation de confirmation et réinitialisation', async ({ page }) => {
  await anonymous(page);
  await page.route('**/api/v1/auth/reset-password', (route) => {
    expect(route.request().postDataJSON()).toEqual({ token, password: 'nouveau-password-123' });
    return route.fulfill({ json: { message: 'Mot de passe modifié' } });
  });
  await page.goto('/login');
  await page.getByRole('link', { name: 'Mot de passe oublié ?' }).click();
  await expect(page.getByText(/Contactez un administrateur/)).toBeVisible();
  await expect(page.getByLabel('Adresse e-mail')).toHaveCount(0);
  await page.goto(`/reset-password?token=${token}`);
  await page.getByLabel('Nouveau mot de passe', { exact: true }).fill('nouveau-password-123');
  await page.getByLabel('Confirmer le mot de passe', { exact: true }).fill('autre-password-123');
  await page.getByRole('button', { name: 'Enregistrer le mot de passe' }).click();
  await expect(page.getByText('Les mots de passe ne correspondent pas.')).toBeVisible();
  await page.getByLabel('Confirmer le mot de passe', { exact: true }).fill('nouveau-password-123');
  await page.getByRole('button', { name: 'Enregistrer le mot de passe' }).click();
  await expect(page.getByRole('heading', { name: 'Votre mot de passe est modifié.' })).toBeVisible();
  expect(new URL(page.url()).searchParams.has('token')).toBe(false);
  await page.getByRole('link', { name: 'Retour à la connexion' }).click();
  await expect(page.getByRole('button', { name: 'Se connecter', exact: true })).toBeVisible();
});

test('invitation activée sans e-mail et sans double consommation', async ({ page }) => {
  let activations = 0;
  await anonymous(page);
  await page.route('**/api/v1/auth/activate', (route) => {
    activations += 1;
    expect(route.request().postDataJSON()).toEqual({ token, username: account.username, password: 'nouveau-password-123' });
    return route.fulfill({ json: { message: 'Compte activé' } });
  });
  await page.goto(`/activate?token=${token}`);
  await expect(page.getByLabel('Adresse e-mail')).toHaveCount(0);
  await page.getByLabel('Identifiant').fill(account.username);
  await page.getByLabel('Mot de passe', { exact: true }).fill('nouveau-password-123');
  await page.getByLabel('Confirmer le mot de passe', { exact: true }).fill('nouveau-password-123');
  await page.getByRole('button', { name: 'Activer mon compte' }).click();
  await expect(page.getByRole('heading', { name: 'Votre compte est activé.' })).toBeVisible();
  expect(activations).toBe(1);
  // Ancien lien de vérification : on arrive sur le site, en invité, sans consommer de jeton.
  await page.route('**/api/v1/public/**', (route) => route.fulfill({ json: [] }));
  await page.goto(`/verify-email?token=${token}`);
  await expect(page.getByRole('heading', { name: 'Bienvenue au LSO Colombes Volley' })).toBeVisible();
});

test('erreurs de lien et de réseau lisibles', async ({ page }) => {
  await anonymous(page);
  await page.goto('/reset-password');
  await expect(page.getByRole('heading', { name: 'Ce lien est incomplet.' })).toBeVisible();
  await page.getByRole('link', { name: 'Demander un nouveau lien' }).click();
  await expect(page.getByText(/Contactez un administrateur/)).toBeVisible();
  await page.route('**/api/v1/auth/reset-password', (route) => route.abort());
  await page.goto(`/reset-password?token=${token}`);
  await page.getByLabel('Nouveau mot de passe', { exact: true }).fill('nouveau-password-123');
  await page.getByLabel('Confirmer le mot de passe', { exact: true }).fill('nouveau-password-123');
  await page.getByRole('button', { name: 'Enregistrer le mot de passe' }).click();
  await expect(page.getByRole('alert')).toContainText('Impossible de joindre le serveur');
  await expect(page.getByRole('button', { name: 'Enregistrer le mot de passe' })).toBeEnabled();
});

test('menu mobile repliable et navigation entre applications', async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 0) > 500, 'Navigation repliable uniquement sur téléphone');
  await emptyApi(page);
  await page.route('**/api/v1/auth/me', (route) => route.fulfill({ json: account }));
  await page.goto('/app');
  await expect(page.getByRole('navigation', { name: 'Applications' })).not.toBeVisible();
  await page.getByRole('button', { name: 'Ouvrir les applications' }).click();
  await page.getByRole('link', { name: 'Gymnases', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Gymnases' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Applications' })).not.toBeVisible();
  await expect(page.getByText('Aucun gymnase n’est encore configuré.')).toBeVisible();
});

test('aucun débordement aux résolutions courantes et captures', async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  test.skip(testInfo.project.name !== 'desktop', 'Matrice responsive exécutée une fois');
  await anonymous(page);
  const resolutions = [[320, 568], [360, 800], [375, 667], [390, 844], [412, 915], [430, 932], [768, 1024], [820, 1180], [1024, 768], [1280, 720], [1366, 768], [1440, 900], [1920, 1080], [2560, 1440]] as const;
  const routes = ['/login', '/forgot-password', `/reset-password?token=${token}`, `/activate?token=${token}`];
  for (const [width, height] of resolutions) {
    await page.setViewportSize({ width, height });
    for (const route of routes) {
      await page.goto(route);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await noOverflow(page);
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/login');
  await expect(page.getByRole('button', { name: 'Se connecter', exact: true })).toBeVisible();
  await page.screenshot({ path: '.cache/previews/login-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: '.cache/previews/login-mobile.png', fullPage: true });
  await page.unroute('**/api/v1/auth/me');
  await emptyApi(page);
  await page.route('**/api/v1/auth/me', (route) => route.fulfill({ json: account }));
  for (const [width, height] of resolutions) {
    await page.setViewportSize({ width, height });
    await page.goto('/app');
    await expect(page.getByRole('heading', { name: 'Bonjour Camille' })).toBeVisible();
    await noOverflow(page);
    await page.getByRole('button', { name: 'Options du profil de Camille' }).click();
    await expect(page.getByRole('button', { name: 'Se déconnecter' })).toBeVisible();
    await noOverflow(page);
    await page.keyboard.press('Escape');
    await expect(page.locator('#profile-options')).toHaveCount(0);
    await page.goto('/app/profil');
    await expect(page.getByLabel('Adresse e-mail de notification (facultative)')).toBeVisible();
    await noOverflow(page);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/app');
  await expect(page.getByRole('heading', { name: 'Accueil' })).toBeVisible();
  await page.screenshot({ path: '.cache/previews/home-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: '.cache/previews/home-mobile.png', fullPage: true });
});
