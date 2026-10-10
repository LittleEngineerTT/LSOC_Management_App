import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AuthApp } from '../auth/AuthApp';
const url = 'https://www.ffvbbeach.org/ffvbapp/resu/vbspo_calendrier.php?saison=2026/2027&codent=PTIDF92&poule=BRC';
const admin = { id: 'a', first_name: 'Admin', category: 'adult', active: true, roles: ['admin'] };
let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;
let clubCode: string | null;
let linked: boolean;
let source: Record<string, unknown> | null;
let rejectCreation: boolean;
function reply(value: unknown) { return new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } }); }
function open() { render(<MemoryRouter initialEntries={['/app/administration?tab=ffvb']}><AuthApp /></MemoryRouter>); }
beforeEach(() => {
  clubCode = '0926620'; linked = true; source = null; rejectCreation = false; document.cookie = 'lsoc_csrf=csrf; path=/';
  fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
    const path = new URL(String(input), 'http://localhost').pathname;
    if (path.endsWith('/auth/me')) return reply(admin);
    if (path.endsWith('/users')) return reply([admin]);
    if (path.endsWith('/teams')) return reply([{ id: 't', name: 'LSO COLOMBES', section_id: 's', referent_id: 'a' }]);
    if (path.endsWith('/club')) { if (init?.method === 'PUT') clubCode = '0926620'; return reply({ club_code: clubCode }); }
    if (path.endsWith('/preview')) return reply({ season: '2026/2027', entity: 'PTIDF92', pool: 'BRC', club_code: clubCode, candidates: [{ team_name: 'LSO COLOMBES', team_number: '6', team_id: linked ? 't' : null }], warning: null });
    if (path.endsWith('/sources') && init?.method === 'POST') { if (rejectCreation) return new Response(JSON.stringify({ detail: 'Référent devenu inactif' }), { status: 409 }); const body = JSON.parse(String(init.body)); source = { id: 'source', ...body, interval_minutes: body.interval_days * 1440, last_success_at: null }; return reply(source); }
    if (path.endsWith('/sources') || path.endsWith('/source')) return reply(path.endsWith('/source') ? {} : source ? [source] : []);
    return reply([]);
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { vi.unstubAllGlobals(); document.cookie = 'lsoc_csrf=; Max-Age=0; path=/'; });
it('crée directement depuis l’URL lorsque toutes les informations sont identifiées', async () => {
  open();
  await userEvent.type(await screen.findByLabelText('URL du calendrier FFVB'), url);
  await userEvent.clear(screen.getByLabelText('Fréquence de la nouvelle source (jours)'));
  await userEvent.type(screen.getByLabelText('Fréquence de la nouvelle source (jours)'), '7');
  await userEvent.click(screen.getByRole('button', { name: 'Créer depuis l’URL' }));
  await screen.findByText('Source enregistrée.');
  expect(fetchMock).toHaveBeenCalledWith('/api/v1/ffvb/sources', expect.objectContaining({ method: 'POST', body: JSON.stringify({ team_id: 't', season: '2026/2027', entity: 'PTIDF92', pool: 'BRC', team_number: '6', team_name: 'LSO COLOMBES', club_code: '0926620', enabled: true, interval_days: 7 }) }));
  expect(screen.queryByLabelText('Équipe locale')).not.toBeInTheDocument();
});
it('préremplit le formulaire si le rattachement local manque, avec le code du club grisé', async () => {
  linked = false; open();
  await userEvent.type(await screen.findByLabelText('URL du calendrier FFVB'), url);
  await userEvent.click(screen.getByRole('button', { name: 'Créer depuis l’URL' }));
  expect(await screen.findByLabelText('Saison')).toHaveValue('2026/2027');
  expect(screen.getByLabelText('Numéro d’équipe FFVB')).toHaveValue('6');
  expect(screen.getByLabelText('Nom d’équipe FFVB')).toHaveValue('LSO COLOMBES');
  expect(screen.getByLabelText('Code du club FFVB')).toBeDisabled();
  expect(screen.getByLabelText('Code du club FFVB')).toHaveValue('0926620');
  expect(fetchMock.mock.calls.filter(([input, init]) => String(input) === '/api/v1/ffvb/sources' && init?.method === 'POST')).toHaveLength(0);
  await userEvent.selectOptions(screen.getByLabelText('Équipe locale'), 't');
  await userEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
  await screen.findByText('Source enregistrée.');
});
it('paramètre le club une seule fois, puis affiche le champ désactivé', async () => {
  clubCode = null; open();
  await userEvent.click(await screen.findByRole('button', { name: 'Configurer le club' }));
  expect(screen.getByLabelText('Code du club FFVB')).not.toBeDisabled();
  await userEvent.click(screen.getByRole('button', { name: 'Enregistrer le code du club' }));
  await waitFor(() => expect(screen.getByLabelText('Code du club FFVB')).toBeDisabled());
  expect(screen.queryByRole('button', { name: 'Enregistrer le code du club' })).not.toBeInTheDocument();
});
it('conserve le formulaire prérempli si la création automatique est refusée', async () => {
  rejectCreation = true; open();
  await userEvent.type(await screen.findByLabelText('URL du calendrier FFVB'), url);
  await userEvent.click(screen.getByRole('button', { name: 'Créer depuis l’URL' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Référent devenu inactif');
  expect(screen.getByLabelText('Équipe locale')).toHaveValue('t');
  expect(screen.getByLabelText('Nom d’équipe FFVB')).toHaveValue('LSO COLOMBES');
});
