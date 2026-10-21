import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { expect, it, vi } from 'vitest';
import type { ClubPage } from './clubPages';
import { OurClubPage } from './OurClubPage';

vi.mock('./context', () => ({
  useClub: () => ({
    sections: [{ id: 's1', name: 'Séniors' }],
    teams: [
      { id: 't1', name: 'Senior Féminin 1', section_id: 's1', referent_ids: [] },
      { id: 't2', name: 'Senior Féminin 2', section_id: 's1', referent_ids: [] },
    ],
  }),
}));

const pages: ClubPage[] = [
  { type: 'section', target: 'seniors', sections: [{ title: 'Présentation', content: 'Premier paragraphe.\n\nSecond paragraphe.' }] },
  { type: 'team', target: 'senior feminin 1', image: '/notre-club/sf1.jpg', sections: [{ title: 'Notre équipe', content: 'SF1.' }] },
  { type: 'team', target: 'senior feminin 2', sections: [{ title: 'Notre équipe', content: 'SF2.' }] },
  { type: 'team', target: 'Jeunes 1', section: 'Jeunes', sections: [{ title: 'Notre équipe', content: 'Section absente.' }] },
];

it('présente les sections en onglets, leurs équipes en cartes et passe d’une équipe à l’autre', async () => {
  render(<MemoryRouter><OurClubPage pages={pages} /></MemoryRouter>);
  // Onglets : les sections, et une équipe seulement si sa section n’a pas de page.
  const tabs = screen.getByRole('navigation', { name: 'Sections du club' });
  expect(within(tabs).getAllByRole('link').map((link) => link.textContent)).toEqual(['Séniors', 'Jeunes 1']);
  const section = screen.getByRole('article', { name: /Séniors/ });
  expect(within(section).queryByRole('img')).not.toBeInTheDocument();
  expect(within(section).getAllByText(/paragraphe\./).map((node) => node.closest('p'))).toHaveLength(2);
  const cards = within(section).getByRole('region', { name: 'Nos équipes' });
  expect(within(cards).getAllByRole('link').map((link) => link.textContent)).toEqual(['Senior Féminin 1Voir la présentation', 'Senior Féminin 2Voir la présentation']);
  await userEvent.click(within(cards).getByRole('link', { name: /Senior Féminin 1/ }));
  const team = screen.getByRole('article', { name: /Senior Féminin 1/ });
  expect(within(team).getByRole('img')).toHaveAttribute('src', '/notre-club/sf1.jpg');
  const switcher = within(team).getByRole('navigation', { name: 'Équipes Séniors' });
  expect(within(switcher).getByRole('link', { name: 'Senior Féminin 1' })).toHaveAttribute('aria-current', 'page');
  await userEvent.click(within(switcher).getByRole('link', { name: 'Senior Féminin 2' }));
  expect(screen.getByRole('article', { name: /Senior Féminin 2/ })).toHaveTextContent('SF2.');
  await userEvent.click(within(screen.getByRole('navigation', { name: 'Fil d’Ariane' })).getByRole('link', { name: 'Séniors' }));
  expect(screen.getByRole('region', { name: 'Nos équipes' })).toBeInTheDocument();
});

it('indique l’absence de présentation', () => {
  render(<MemoryRouter><OurClubPage pages={[]} /></MemoryRouter>);
  expect(screen.getByText('Aucune présentation pour le moment.')).toBeInTheDocument();
});
