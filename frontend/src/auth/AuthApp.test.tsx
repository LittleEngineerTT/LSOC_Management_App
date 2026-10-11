import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthApp } from './AuthApp';

const user = {
  id: 'account-1', username: 'camille', first_name: 'Camille', category: 'adult', roles: ['admin'],
  active: true, email: 'camille@example.org', messaging_allowed: true,
  followed_email: true, referent_email: true, admin_email: true,
};
const token = 'valid-link-token-with-at-least-twenty-characters';
let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;

function reply(body: unknown, status = 200) {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json' },
  });
}

function open(path = '/login') {
  return render(<MemoryRouter initialEntries={[path]}><AuthApp /></MemoryRouter>);
}

function respond(path: string, body: unknown, status = 200) {
  fetchMock.mockImplementation(async (input) => {
    const url = String(input);
    if (url === `/api/v1/auth/${path}`) return reply(body, status);
    if (url === '/api/v1/auth/me') return reply({ detail: 'Connexion requise' }, 401);
    throw new Error(`Unexpected request ${url}`);
  });
}

async function fillPassword(password = 'nouveau-password-123', confirmation = password) {
  const keyboard = userEvent.setup();
  await keyboard.type(screen.getByLabelText(/^Mot de passe$|^Nouveau mot de passe$/), password);
  await keyboard.type(screen.getByLabelText('Confirmer le mot de passe'), confirmation);
}

beforeEach(() => {
  fetchMock = vi.fn<typeof fetch>().mockResolvedValue(reply({ detail: 'Connexion requise' }, 401));
  vi.stubGlobal('fetch', fetchMock);
  document.cookie = 'lsoc_csrf=; Max-Age=0; path=/';
  localStorage.clear();
  sessionStorage.clear();
});

afterEach(() => vi.unstubAllGlobals());

describe('session et connexion', () => {
  it('connecte avec les cookies, sans stocker de secret dans le navigateur', async () => {
    respond('login', { user, csrf_token: 'csrf-response' });
    open();
    await screen.findByRole('button', { name: 'Se connecter' });
    const keyboard = userEvent.setup();
    await keyboard.type(screen.getByLabelText('Identifiant'), user.username);
    await keyboard.type(screen.getByLabelText('Mot de passe'), 'mon-password-123');
    await keyboard.click(screen.getByRole('button', { name: 'Se connecter' }));
    await screen.findByRole('heading', { name: 'Accueil' });
    expect(screen.getByRole('button', { name: 'Options du profil de Camille' })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/auth/login', expect.objectContaining({
      method: 'POST', credentials: 'include',
      body: JSON.stringify({ username: user.username, password: 'mon-password-123' }),
    }));
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it('restaure une session existante et déconnecte avec le cookie CSRF', async () => {
    document.cookie = 'lsoc_csrf=cookie-csrf; path=/';
    fetchMock.mockImplementation(async (input) => {
      if (String(input).endsWith('/me')) return reply(user);
      if (String(input).endsWith('/logout')) return reply(null, 204);
      throw new Error('Unexpected request');
    });
    open();
    await screen.findByRole('heading', { name: 'Accueil' });
    await userEvent.click(screen.getByRole('button', { name: 'Options du profil de Camille' }));
    await userEvent.click(screen.getByRole('button', { name: 'Se déconnecter' }));
    await screen.findByRole('button', { name: 'Se connecter' });
    const request = fetchMock.mock.calls.find(([input]) => String(input).endsWith('/logout'))?.[1];
    expect(new Headers(request?.headers).get('X-CSRF-Token')).toBe('cookie-csrf');
  });

  it('affiche une erreur de connexion puis permet de réessayer', async () => {
    respond('login', { detail: 'Identifiants invalides' }, 401);
    open();
    await screen.findByRole('button', { name: 'Se connecter' });
    fireEvent.change(screen.getByLabelText('Identifiant'), { target: { value: user.username } });
    fireEvent.change(screen.getByLabelText('Mot de passe'), { target: { value: 'incorrect' } });
    await userEvent.click(screen.getByRole('button', { name: 'Se connecter' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Identifiants invalides');
    expect(screen.getByRole('button', { name: 'Se connecter' })).toBeEnabled();
  });

  it('permet de réessayer si la vérification de session échoue sur le réseau', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    open();
    expect(await screen.findByRole('alert')).toHaveTextContent(/connexion|serveur/i);
    fetchMock.mockResolvedValue(reply({ detail: 'Connexion requise' }, 401));
    await userEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
    await screen.findByRole('button', { name: 'Se connecter' });
  });

  it('affiche un message utile pour une limitation des tentatives', async () => {
    respond('login', { detail: 'Trop de tentatives, réessayez plus tard' }, 429);
    open();
    await screen.findByRole('button', { name: 'Se connecter' });
    fireEvent.change(screen.getByLabelText('Identifiant'), { target: { value: user.username } });
    fireEvent.change(screen.getByLabelText('Mot de passe'), { target: { value: 'incorrect' } });
    await userEvent.click(screen.getByRole('button', { name: 'Se connecter' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/Trop de tentatives/);
  });

  it('affiche et masque le mot de passe sans le modifier', async () => {
    open();
    await screen.findByRole('button', { name: 'Se connecter' });
    const password = screen.getByLabelText('Mot de passe');
    fireEvent.change(password, { target: { value: 'secret' } });
    await userEvent.click(screen.getByRole('button', { name: 'Afficher le mot de passe' }));
    expect(password).toHaveAttribute('type', 'text');
    expect(password).toHaveValue('secret');
    await userEvent.click(screen.getByRole('button', { name: 'Masquer le mot de passe' }));
    expect(password).toHaveAttribute('type', 'password');
  });

  it('protège l’accueil si la session est absente', async () => {
    open('/app');
    await screen.findByRole('button', { name: 'Se connecter' });
    expect(screen.queryByRole('navigation', { name: 'Applications' })).not.toBeInTheDocument();
  });

  it('affiche les menus demandés et le contenu de chaque section', async () => {
    fetchMock.mockImplementation(async (input) => reply(String(input).endsWith('/auth/me') ? user : []));
    open('/app');
    await screen.findByRole('heading', { name: 'Accueil' });
    expect(screen.getByRole('navigation', { name: 'Applications' })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: /Bonjour/ })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('link', { name: 'Mon planning' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Mon planning' })).toBeInTheDocument();
    expect(await screen.findByText(/Rien de prévu/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Mes sections' })).toBeInTheDocument();
    // Mon planning et Mes sections restent dans la barre du haut, plus dans le menu du compte.
    await userEvent.click(screen.getByRole('button', { name: /Options du profil/ }));
    const options = document.getElementById('profile-options')!;
    expect(within(options).getByRole('link', { name: 'Mon profil' })).toBeInTheDocument();
    expect(within(options).queryByRole('link', { name: 'Mon planning' })).not.toBeInTheDocument();
    expect(within(options).queryByRole('link', { name: 'Mes sections' })).not.toBeInTheDocument();
  });

  it('masque l’entrée administration pour un adhérent', async () => {
    fetchMock.mockResolvedValue(reply({ ...user, roles: ['member'] }));
    open('/app');
    await screen.findByRole('heading', { name: 'Accueil' });
    expect(screen.queryByRole('link', { name: 'Administration' })).not.toBeInTheDocument();
  });
});

describe('récupération et réinitialisation', () => {
  it('explique la récupération par l’administrateur sans exposer de formulaire e-mail', () => {
    open('/forgot-password');
    expect(screen.getByRole('heading', { name: 'Mot de passe oublié ?' })).toBeInTheDocument();
    expect(screen.getByText(/Contactez un administrateur/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Adresse e-mail')).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuse des mots de passe différents avant tout appel API', async () => {
    open(`/reset-password?token=${token}`);
    await fillPassword('nouveau-password-123', 'different-password-123');
    await userEvent.click(screen.getByRole('button', { name: 'Enregistrer le mot de passe' }));
    expect(await screen.findByText('Les mots de passe ne correspondent pas.')).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([input]) => String(input).endsWith('/reset-password'))).toBe(false);
  });

  it('refuse un mot de passe court avant tout appel API', async () => {
    open(`/reset-password?token=${token}`);
    await fillPassword('court');
    await userEvent.click(screen.getByRole('button', { name: 'Enregistrer le mot de passe' }));
    expect(await screen.findByText('Utilisez entre 12 et 128 caractères.')).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([input]) => String(input).endsWith('/reset-password'))).toBe(false);
  });

  it('réinitialise avec le jeton du lien puis propose la connexion', async () => {
    respond('reset-password', { message: 'Mot de passe modifié' });
    open(`/reset-password?token=${token}`);
    await fillPassword();
    await userEvent.click(screen.getByRole('button', { name: 'Enregistrer le mot de passe' }));
    await screen.findByRole('heading', { name: 'Votre mot de passe est modifié.' });
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/auth/reset-password', expect.objectContaining({
      body: JSON.stringify({ token, password: 'nouveau-password-123' }),
    }));
    await userEvent.click(screen.getByRole('link', { name: 'Retour à la connexion' }));
    await screen.findByRole('button', { name: 'Se connecter' });
  });

  it('explique un lien absent et permet d’en demander un autre', () => {
    open('/reset-password');
    expect(screen.getByRole('heading', { name: 'Ce lien est incomplet.' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Demander un nouveau lien' })).toHaveAttribute('href', '/forgot-password');
    expect(screen.queryByLabelText('Nouveau mot de passe')).not.toBeInTheDocument();
  });

  it('explique un lien expiré renvoyé par le backend', async () => {
    respond('reset-password', { detail: 'Lien invalide ou expiré' }, 400);
    open(`/reset-password?token=${token}`);
    await fillPassword();
    await userEvent.click(screen.getByRole('button', { name: 'Enregistrer le mot de passe' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Lien invalide ou expiré');
    expect(screen.getByRole('link', { name: 'Demander un nouveau lien' })).toBeInTheDocument();
  });
});

describe('invitation sans vérification e-mail', () => {
  it('active une invitation avec les seuls champs acceptés par le backend', async () => {
    respond('activate', { message: 'Compte activé' });
    open(`/activate?token=${token}`);
    await userEvent.type(screen.getByLabelText('Identifiant'), user.username);
    await fillPassword();
    await userEvent.click(screen.getByRole('button', { name: 'Activer mon compte' }));
    await screen.findByRole('heading', { name: 'Votre compte est activé.' });
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/auth/activate', expect.objectContaining({
      body: JSON.stringify({ token, username: user.username, password: 'nouveau-password-123' }),
    }));
  });

  it('redirige les anciens liens de vérification vers la connexion sans consommer de jeton', async () => {
    open(`/verify-email?token=${token}`);
    await screen.findByRole('button', { name: 'Se connecter' });
    expect(fetchMock.mock.calls.some(([input]) => String(input).endsWith('/verify-email'))).toBe(false);
  });

  it('refuse un identifiant invalide avant tout appel API', async () => {
    open(`/activate?token=${token}`);
    await userEvent.type(screen.getByLabelText('Identifiant'), 'ab');
    await fillPassword();
    await userEvent.click(screen.getByRole('button', { name: 'Activer mon compte' }));
    expect(screen.getByText(/Utilisez 3 à 80 caractères/)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('conserve le formulaire lorsque l’identifiant choisi est déjà utilisé', async () => {
    respond('activate', { detail: 'Cet identifiant est déjà utilisé' }, 409);
    open(`/activate?token=${token}`);
    await userEvent.type(screen.getByLabelText('Identifiant'), user.username);
    await fillPassword();
    await userEvent.click(screen.getByRole('button', { name: 'Activer mon compte' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Cet identifiant est déjà utilisé');
    expect(screen.getByLabelText('Identifiant')).toHaveValue(user.username);
    expect(screen.queryByLabelText('Adresse e-mail')).not.toBeInTheDocument();
  });

  it('annule une activation en cours quand on quitte le formulaire', async () => {
    let resolve: ((response: Response) => void) | undefined;
    fetchMock.mockImplementation(() => new Promise<Response>((done) => { resolve = done; }));
    open(`/activate?token=${token}`);
    await userEvent.type(screen.getByLabelText('Identifiant'), user.username);
    await fillPassword();
    await userEvent.click(screen.getByRole('button', { name: 'Activer mon compte' }));
    const request = fetchMock.mock.calls[0]?.[1];
    expect(screen.getByRole('button', { name: /Envoi en cours/ })).toBeDisabled();
    await userEvent.click(screen.getByRole('link', { name: 'Retour à la connexion' }));
    await waitFor(() => expect(request?.signal?.aborted).toBe(true));
    await act(async () => { resolve?.(reply({ message: 'Compte activé' })); });
    expect(screen.queryByRole('heading', { name: 'Votre compte est activé.' })).not.toBeInTheDocument();
  });
});
