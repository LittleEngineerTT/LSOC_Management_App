import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { expect, it, vi } from 'vitest';
import type { ClubPage } from './clubPages';
import { OurClubPage } from './OurClubPage';

vi.mock('./context', () => ({
  useClub: () => ({
    sections: [{ id: 's1', name: 'Séniors' }],
    teams: [{ id: 't1', name: 'Senior Féminin 1', section_id: 's1', referent_ids: [] }],
  }),
}));

const pages: ClubPage[] = [
  { type: 'team', target: 'senior feminin 1', image: '/notre-club/sf1.jpg', sections: [{ title: 'Notre équipe', content: 'Premier paragraphe.\n\nSecond paragraphe.' }] },
  { type: 'section', target: 'Inconnue', sections: [{ title: 'Présentation', content: 'Sans image.' }] },
];

it('liste les pages, retrouve l’équipe du catalogue et accepte une page sans image', async () => {
  render(<MemoryRouter><OurClubPage pages={pages} /></MemoryRouter>);
  const nav = screen.getByRole('navigation', { name: 'Sections et équipes' });
  expect(within(nav).getAllByRole('link').map((link) => link.textContent)).toEqual(['Senior Féminin 1Équipe · Séniors', 'InconnueSection']);
  const first = screen.getByRole('article', { name: /Senior Féminin 1/ });
  expect(within(first).getByRole('img')).toHaveAttribute('src', '/notre-club/sf1.jpg');
  expect(within(first).getByText('Premier paragraphe.').tagName).toBe('SPAN');
  expect(within(first).getAllByText(/paragraphe\./).map((node) => node.closest('p'))).toHaveLength(2);
  await userEvent.click(within(nav).getByRole('link', { name: /Inconnue/ }));
  const second = screen.getByRole('article', { name: /Inconnue/ });
  expect(within(second).queryByRole('img')).not.toBeInTheDocument();
  expect(within(second).getByText('Sans image.')).toBeInTheDocument();
});

it('indique l’absence de présentation', () => {
  render(<MemoryRouter><OurClubPage pages={[]} /></MemoryRouter>);
  expect(screen.getByText('Aucune présentation pour le moment.')).toBeInTheDocument();
});
