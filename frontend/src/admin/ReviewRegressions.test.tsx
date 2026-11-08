import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { AuthApp } from '../auth/AuthApp';
const admin = { id: 'admin', first_name: 'Admin', category: 'adult', roles: ['admin'], active: true };
function reply(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }); }
function open(tab: string) { document.cookie = 'lsoc_csrf=csrf; path=/'; render(<MemoryRouter initialEntries={[`/app/administration?tab=${tab}`]}><AuthApp /></MemoryRouter>); }
afterEach(() => { vi.unstubAllGlobals(); document.cookie = 'lsoc_csrf=; Max-Age=0; path=/'; });
it('recharge les événements après décision et sur Actualiser', async () => {
  let accepted = false; let eventReads = 0;
  vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
    const path = new URL(String(input), 'http://localhost').pathname;
    if (path.endsWith('/auth/me')) return reply(admin);
    if (path.endsWith('/users')) return reply([admin]);
    if (path.endsWith('/events')) { eventReads++; return reply([{ id: 'e', title: accepted ? 'Nouveau titre' : 'Ancien titre', version: accepted ? 2 : 1 }]); }
    if (path.endsWith('/decision') && init?.method === 'POST') { accepted = true; return reply({}); }
    if (path.endsWith('/change-requests')) return reply([{ id: accepted ? 'r2' : 'r1', event_id: 'e', actor_name: 'Camille', base_version: 1, changes: { title: 'Nouveau titre' }, status: 'pending', created_at: '2026-10-10T10:00:00Z' }]);
    return reply([]);
  }));
  open('requests');
  await userEvent.click(await screen.findByRole('button', { name: 'Examiner' }));
  await userEvent.selectOptions(screen.getByLabelText('Décision'), 'yes');
  await userEvent.type(screen.getByLabelText('Message au référent'), 'Validé.');
  await userEvent.click(screen.getByRole('button', { name: 'Enregistrer la décision' }));
  await screen.findByText('Décision enregistrée.');
  expect(eventReads).toBe(2);
  await userEvent.click(screen.getByRole('button', { name: 'Actualiser' }));
  expect(eventReads).toBe(3);
});
it('ne propose plus de consulter les disponibilités dans l’onglet Indisponibilités', async () => {
  vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockImplementation(async (input) => {
    const path = new URL(String(input), 'http://localhost').pathname;
    if (path.endsWith('/auth/me')) return reply(admin);
    if (path.endsWith('/users')) return reply([admin]);
    if (path.endsWith('/gymnasiums')) return reply([{ id: 'g1', name: 'Paré', capacity: 3 }]);
    return reply([]);
  }));
  open('blocks');
  expect(await screen.findByRole('button', { name: 'Ajouter une indisponibilité' })).toBeInTheDocument();
  expect(screen.queryByText('Consulter les disponibilités')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Gymnase à consulter')).not.toBeInTheDocument();
});
it('le lien d’une notification ouvre directement la décision de la demande', async () => {
  vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockImplementation(async (input) => {
    const path = new URL(String(input), 'http://localhost').pathname;
    if (path.endsWith('/auth/me')) return reply(admin);
    if (path.endsWith('/users')) return reply([admin]);
    if (path.endsWith('/events')) return reply([{ id: 'e', title: 'Entraînement du jeudi', version: 1 }]);
    if (path.endsWith('/change-requests')) return reply([{ id: 'r1', event_id: 'e', actor_name: 'Camille', base_version: 1, changes: { title: 'Nouveau titre' }, status: 'pending', created_at: '2026-10-10T10:00:00Z' }]);
    if (path.endsWith('/event-requests')) return reply([{ id: 'x1', team_id: null, actor_id: 'c', actor_name: 'Coach', proposal: { title: 'Stage' }, note: '', status: 'pending', decision: '', decider_name: null, decided_at: null, created_at: '2026-10-10T10:00:00Z', event_id: null }]);
    return reply([]);
  }));
  open('requests&demande=r1');
  expect(await screen.findByRole('heading', { name: 'Décision pour la demande de Camille' })).toBeInTheDocument();
  expect(screen.getByLabelText('Message au référent')).toBeRequired();
});
it('le lien d’une création d’événement ouvre l’onglet et la décision correspondants', async () => {
  vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockImplementation(async (input) => {
    const path = new URL(String(input), 'http://localhost').pathname;
    if (path.endsWith('/auth/me')) return reply(admin);
    if (path.endsWith('/users')) return reply([admin]);
    if (path.endsWith('/event-requests')) return reply([{ id: 'x1', team_id: null, actor_id: 'c', actor_name: 'Coach', proposal: { title: 'Stage' }, note: '', status: 'pending', decision: '', decider_name: null, decided_at: null, created_at: '2026-10-10T10:00:00Z', event_id: null }]);
    return reply([]);
  }));
  open('requests&type=events&demande=x1');
  expect(await screen.findByRole('heading', { name: 'Décision pour la demande de Coach' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Nouveaux événements' })).toHaveAttribute('aria-pressed', 'true');
});
