import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import type { ClubPage } from './clubPages';
import { OurClubPage } from './OurClubPage';

// Catalogue du club tel que l’API le renvoie ; chaque test peut y ajouter sections et équipes.
const club = vi.hoisted(() => ({ sections: [] as { id: string; name: string }[], teams: [] as { id: string; name: string; section_id: string; referent_ids: string[] }[] }));
vi.mock('./context', () => ({ useClub: () => club }));
beforeEach(() => {
  club.sections = [{ id: 's1', name: 'Séniors' }];
  club.teams = [
    { id: 't1', name: 'Senior Féminin 1', section_id: 's1', referent_ids: [] },
    { id: 't2', name: 'Senior Féminin 2', section_id: 's1', referent_ids: [] },
  ];
});

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
  expect(within(cards).getAllByRole('link').map((link) => link.textContent)).toEqual(['Senior Féminin 1Présentation de l’équipe', 'Senior Féminin 2Présentation de l’équipe']);
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

it('crée d’elle-même une page en cours de rédaction pour chaque nouvelle section et équipe', async () => {
  club.sections.push({ id: 's2', name: 'Jeunes' });
  club.teams.push({ id: 't3', name: 'Senior Féminin 3', section_id: 's1', referent_ids: [] }, { id: 't4', name: 'U15', section_id: 's2', referent_ids: [] });
  render(<MemoryRouter><OurClubPage pages={pages} /></MemoryRouter>);
  // La nouvelle section a son onglet ; l’équipe configurée « Jeunes 1 » la rejoint.
  const tabs = screen.getByRole('navigation', { name: 'Sections du club' });
  expect(within(tabs).getAllByRole('link').map((link) => link.textContent)).toEqual(['Séniors', 'Jeunes']);
  const seniors = within(screen.getByRole('article', { name: /Séniors/ })).getByRole('region', { name: 'Nos équipes' });
  expect(within(seniors).getAllByRole('link').map((link) => link.textContent)).toEqual(['Senior Féminin 1Présentation de l’équipe', 'Senior Féminin 2Présentation de l’équipe', 'Senior Féminin 3Présentation de l’équipe']);
  await userEvent.click(within(seniors).getByRole('link', { name: /Senior Féminin 3/ }));
  const draft = screen.getByRole('article', { name: /Senior Féminin 3/ });
  expect(within(draft).getByRole('heading', { name: 'Notre équipe' })).toBeInTheDocument();
  expect(draft).toHaveTextContent('En cours de rédaction.');
  expect(within(draft).queryByRole('heading', { name: 'Nous rejoindre' })).not.toBeInTheDocument();
  expect(within(draft).getByRole('navigation', { name: 'Fil d’Ariane' })).toHaveTextContent('Séniors › Senior Féminin 3');
  await userEvent.click(within(tabs).getByRole('link', { name: 'Jeunes' }));
  const jeunes = screen.getByRole('article', { name: /Jeunes/ });
  expect(within(jeunes).getByRole('heading', { name: 'La section' })).toBeInTheDocument();
  expect(jeunes).toHaveTextContent('En cours de rédaction.');
  expect(within(jeunes).getByRole('heading', { name: 'Nous rejoindre' })).toBeInTheDocument();
  expect(jeunes).toHaveTextContent('Contactez le club pour convenir d’une séance d’essai.');
  expect(within(within(jeunes).getByRole('region', { name: 'Nos équipes' })).getAllByRole('link').map((link) => link.textContent)).toEqual(['Jeunes 1Présentation de l’équipe', 'U15Présentation de l’équipe']);
});

it('indique l’absence de présentation quand le club n’a ni page ni section', () => {
  club.sections = [];
  club.teams = [];
  render(<MemoryRouter><OurClubPage pages={[]} /></MemoryRouter>);
  expect(screen.getByText('Aucune présentation pour le moment.')).toBeInTheDocument();
});
