import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { AuthApp } from './AuthApp';
const token = 'invitation-token-at-least-twenty-characters';
afterEach(() => { vi.unstubAllGlobals(); document.cookie = 'lsoc_csrf=; Max-Age=0; path=/'; });
it('active avec un identifiant et sans adresse e-mail ni étape de vérification', async () => {
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ message: 'Compte activé' })));
  vi.stubGlobal('fetch', fetchMock);
  render(<MemoryRouter initialEntries={[`/activate?token=${token}`]}><AuthApp /></MemoryRouter>);
  await userEvent.type(screen.getByLabelText('Identifiant'), 'Camille.Volley');
  expect(screen.queryByLabelText('Adresse e-mail')).not.toBeInTheDocument();
  await userEvent.type(screen.getByLabelText('Mot de passe'), 'nouveau-password-123');
  await userEvent.type(screen.getByLabelText('Confirmer le mot de passe'), 'nouveau-password-123');
  await userEvent.click(screen.getByRole('button', { name: 'Activer mon compte' }));
  await screen.findByRole('heading', { name: 'Votre compte est activé.' });
  expect(fetchMock).toHaveBeenCalledWith('/api/v1/auth/activate', expect.objectContaining({ body: JSON.stringify({ token, username: 'camille.volley', password: 'nouveau-password-123' }) }));
});
it('explique la récupération auprès de l’administrateur sans formulaire ni appel API', () => {
  const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
  render(<MemoryRouter initialEntries={['/forgot-password']}><AuthApp /></MemoryRouter>);
  expect(screen.getByText(/Contactez un administrateur/)).toBeInTheDocument();
  expect(screen.queryByLabelText('Adresse e-mail')).not.toBeInTheDocument();
  expect(fetchMock).not.toHaveBeenCalled();
});
it('permet d’effacer l’adresse facultative depuis les préférences de notification', async () => {
  const account = { id: 'a', username: 'admin', first_name: 'Admin', active: true, roles: ['admin'], email: 'notify@example.org', followed_email: true, referent_email: true, admin_email: true };
  const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input, init) => new Response(JSON.stringify(String(input).endsWith('/preferences') ? { ...account, ...JSON.parse(String(init?.body)) } : account)));
  vi.stubGlobal('fetch', fetchMock); document.cookie = 'lsoc_csrf=csrf; path=/';
  render(<MemoryRouter initialEntries={['/app/profil']}><AuthApp /></MemoryRouter>);
  await userEvent.clear(await screen.findByLabelText('Adresse e-mail de notification (facultative)'));
  await userEvent.click(screen.getByRole('button', { name: 'Enregistrer les préférences' }));
  await screen.findByText('Préférences enregistrées.');
  expect(fetchMock).toHaveBeenCalledWith('/api/v1/preferences', expect.objectContaining({ method: 'PUT', body: JSON.stringify({ email: null, followed_email: true, referent_email: true, admin_email: true }) }));
});
