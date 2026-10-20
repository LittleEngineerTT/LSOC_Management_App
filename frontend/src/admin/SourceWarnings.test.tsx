import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { AuthApp } from '../auth/AuthApp';

afterEach(() => { vi.unstubAllGlobals(); document.cookie = 'lsoc_csrf=; Max-Age=0; path=/'; });
it('affiche les équipes sans source et mémorise le choix d’ignorer ou réactiver', async () => {
  let ignored = false;
  const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
    const path = new URL(String(input), 'http://localhost').pathname;
    const team = { id: 't', name: 'Loisir A', section_id: 's', referent_ids: [], ffvb_source_warning_ignored: ignored };
    let value: unknown = [];
    if (path.endsWith('/auth/me')) value = { id: 'a', first_name: 'Admin', category: 'adult', roles: ['admin'], active: true };
    if (path.endsWith('/users')) value = [{ id: 'a', first_name: 'Admin', category: 'adult', roles: ['admin'], active: true }];
    if (path.endsWith('/teams')) value = [team, { ...team, id: 'with-source', name: 'Compétition' }];
    if (path.endsWith('/sections')) value = [{ id: 's', name: 'Loisir' }];
    if (path.endsWith('/sources')) value = [{ id: 'src', team_id: 'with-source', enabled: false }];
    if (path.endsWith('/ffvb-warning')) { ignored = JSON.parse(String(init?.body)).ignored; value = { ...team, ffvb_source_warning_ignored: ignored }; }
    return new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
  });
  vi.stubGlobal('fetch', fetchMock); document.cookie = 'lsoc_csrf=csrf; path=/';
  render(<MemoryRouter initialEntries={['/app/administration?tab=teams']}><AuthApp /></MemoryRouter>);
  expect(await screen.findByText('Aucune source FFVB créée pour l’équipe Loisir A.')).toBeInTheDocument();
  expect(screen.queryByText('Aucune source FFVB créée pour l’équipe Compétition.')).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Ignorer pour Loisir A' }));
  await waitFor(() => expect(screen.queryByText('Aucune source FFVB créée pour l’équipe Loisir A.')).not.toBeInTheDocument());
  await userEvent.click(screen.getByRole('button', { name: 'Réactiver l’avertissement pour Loisir A' }));
  expect(await screen.findByText('Aucune source FFVB créée pour l’équipe Loisir A.')).toBeInTheDocument();
  const mutations = fetchMock.mock.calls.filter(([input]) => String(input).endsWith('/ffvb-warning'));
  expect(mutations).toHaveLength(2);
  expect(new Headers(mutations[0]?.[1]?.headers).get('X-CSRF-Token')).toBe('csrf');
});
it('présente la catégorie Sénior dans le formulaire et la liste', async () => {
  vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockImplementation(async (input) => {
    const path = new URL(String(input), 'http://localhost').pathname;
    const admin = { id: 'a', first_name: 'Admin', category: 'adult', roles: ['admin'], active: true };
    return new Response(JSON.stringify(path.endsWith('/auth/me') ? admin : path.endsWith('/users') ? [admin] : []), { headers: { 'Content-Type': 'application/json' } });
  }));
  render(<MemoryRouter initialEntries={['/app/administration']}><AuthApp /></MemoryRouter>);
  await userEvent.click(await screen.findByRole('button', { name: 'Ajouter un utilisateur' }));
  expect(screen.getByRole('option', { name: 'Sénior' })).toHaveValue('adult');
  expect(screen.getByText(/Sénior ·/)).toBeInTheDocument();
  expect(screen.queryByText(/Adulte/)).not.toBeInTheDocument();
});
