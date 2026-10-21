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
  { type: 'section', target: 'seniors', sections: [{ title: 'Présentation', content: 'Premier paragraphe.\n\nSecond paragraphe.' }] },
  { type: 'team', target: 'senior feminin 1', image: '/notre-club/sf1.jpg', sections: [{ title: 'Notre équipe', content: 'Sans section configurée.' }] },
  { type: 'team', target: 'Jeunes 1', section: 'Jeunes', sections: [{ title: 'Notre équipe', content: 'Section absente.' }] },
];

it('mène d’une section à ses équipes, puis d’une équipe à sa section', async () => {
  render(<MemoryRouter><OurClubPage pages={pages} /></MemoryRouter>);
  // Menu : les sections, et une équipe seulement si sa section n’a pas de page.
  const nav = screen.getByRole('navigation', { name: 'Sections et équipes' });
  expect(within(nav).getAllByRole('link').map((link) => link.textContent)).toEqual(['SéniorsSection', 'Jeunes 1Équipe']);
  const section = screen.getByRole('article', { name: /Séniors/ });
  expect(within(section).queryByRole('img')).not.toBeInTheDocument();
  expect(within(section).getAllByText(/paragraphe\./).map((node) => node.closest('p'))).toHaveLength(2);
  await userEvent.click(within(section).getByRole('button', { name: 'Voir les équipes' }));
  await userEvent.click(within(section).getByRole('link', { name: 'Senior Féminin 1' }));
  const team = screen.getByRole('article', { name: /Senior Féminin 1/ });
  expect(within(team).getByRole('img')).toHaveAttribute('src', '/notre-club/sf1.jpg');
  expect(within(team).getByText('Séniors')).toBeInTheDocument();
  await userEvent.click(within(team).getByRole('link', { name: '← Section Séniors' }));
  expect(screen.getByRole('list', { name: 'Équipes de la section' })).toBeInTheDocument();
});

it('indique l’absence de présentation', () => {
  render(<MemoryRouter><OurClubPage pages={[]} /></MemoryRouter>);
  expect(screen.getByText('Aucune présentation pour le moment.')).toBeInTheDocument();
});
