import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import type { ClubPage } from './clubPages';
import { OurClubPage } from './OurClubPage';

// Catalogue du club tel que l’API le renvoie ; chaque test peut y ajouter sections et équipes.
// L’API publique présente le bureau et les entraîneurs de l’onglet Infos du club.
const club = vi.hoisted(() => {
  const value = {
    sections: [] as { id: string; name: string }[],
    teams: [] as { id: string; name: string; section_id: string; referent_ids: string[] }[],
    staff: [] as unknown[],
    standings: [] as unknown[],
    api: {
      list: (path: string) =>
        Promise.resolve(path === '/public/staff' ? value.staff : path === '/ffvb/standings' ? value.standings : []),
    },
  };
  return value;
});
vi.mock('./context', () => ({ useClub: () => club }));
beforeEach(() => {
  club.staff = [];
  club.standings = [];
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
  render(<MemoryRouter initialEntries={['/?onglet=equipes']}><OurClubPage pages={pages} /></MemoryRouter>);
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
  render(<MemoryRouter initialEntries={['/?onglet=equipes']}><OurClubPage pages={pages} /></MemoryRouter>);
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
  render(<MemoryRouter initialEntries={['/?onglet=equipes']}><OurClubPage pages={[]} /></MemoryRouter>);
  expect(screen.getByText('Aucune présentation pour le moment.')).toBeInTheDocument();
});

it('range Notre club en quatre onglets, Infos du club d’abord', async () => {
  render(<MemoryRouter><OurClubPage pages={pages} /></MemoryRouter>);
  const tabs = screen.getByRole('navigation', { name: 'Notre club' });
  expect(within(tabs).getAllByRole('link').map((link) => link.textContent)).toEqual(['Infos du club', 'Nos équipes', 'Résultats des équipes', 'Inscriptions']);
  expect(within(tabs).getByRole('link', { name: 'Infos du club' })).toHaveAttribute('aria-current', 'page');
  expect(await screen.findByText('Aucune personne à présenter pour le moment.')).toBeInTheDocument();
  await userEvent.click(within(tabs).getByRole('link', { name: 'Nos équipes' }));
  expect(screen.getByRole('navigation', { name: 'Sections du club' })).toBeInTheDocument();
  await userEvent.click(within(tabs).getByRole('link', { name: 'Inscriptions' }));
  expect(within(tabs).getByRole('link', { name: 'Inscriptions' })).toHaveAttribute('aria-current', 'page');
  expect(screen.queryByRole('navigation', { name: 'Sections du club' })).not.toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Inscription 2024-2025' })).toBeInTheDocument();
});

it('ouvre Nos équipes sur un lien vers une section ou une équipe', () => {
  render(<MemoryRouter initialEntries={['/?page=team-senior-feminin-2']}><OurClubPage pages={pages} /></MemoryRouter>);
  expect(within(screen.getByRole('navigation', { name: 'Notre club' })).getByRole('link', { name: 'Nos équipes' })).toHaveAttribute('aria-current', 'page');
  expect(screen.getByRole('article', { name: /Senior Féminin 2/ })).toHaveTextContent('SF2.');
});

it('présente l’inscription en ligne, les cotisations et les moyens de paiement', () => {
  render(<MemoryRouter initialEntries={['/?onglet=inscriptions']}><OurClubPage pages={pages} /></MemoryRouter>);
  const page = screen.getByRole('article', { name: 'Inscription 2024-2025' });
  expect(within(page).getByRole('region', { name: 'Ça y est, le LSOC se modernise !' })).toHaveTextContent('myFFvolley');
  const fees = within(within(page).getByRole('region', { name: 'Cotisations' })).getAllByRole('listitem');
  expect(fees.map((item) => item.textContent)).toEqual(['Vétérans / Loisirs160 €', 'M13 / M15 / M18200 €', 'Séniors / M21220 €']);
  const payments = within(within(page).getByRole('region', { name: 'Modalités de paiement' })).getAllByRole('listitem');
  expect(payments.map((item) => item.textContent)).toEqual(['Par chèque à l’ordre de LSOC Volley', 'Par virement bancaire sur notre HelloAsso']);
});

it('présente le bureau et les entraîneurs avec toutes leurs fonctions, une photo vide par défaut', async () => {
  club.staff = [
    { first_name: 'Yann', functions: ['president'] },
    { first_name: 'Bruno', functions: ['vice_president', 'coach'] },
    { first_name: 'Alice', functions: ['coach'], photo: '/notre-club/alice.jpg' },
  ];
  render(<MemoryRouter><OurClubPage pages={pages} /></MemoryRouter>);
  // Rubrique Dirigeants des infos du club, ouverte par défaut.
  const infos = screen.getByRole('navigation', { name: 'Infos du club' });
  expect(within(infos).getAllByRole('link').map((link) => link.textContent)).toEqual(['Dirigeants']);
  expect(within(infos).getByRole('link', { name: 'Dirigeants' })).toHaveAttribute('aria-current', 'page');
  const staff = await screen.findByRole('region', { name: 'Le bureau et les entraîneurs' });
  const people = await within(staff).findAllByRole('figure');
  expect(people.map((person) => person.querySelector('figcaption')?.textContent)).toEqual(['YannPrésident(e)', 'BrunoVice-président(e)Entraineur(e)', 'AliceEntraineur(e)']);
  expect(within(people[0]!).getByRole('img', { name: 'Pas encore de photo de Yann' })).toBeInTheDocument();
  expect(within(people[2]!).getByRole('img', { name: 'Alice' })).toHaveAttribute('src', '/notre-club/alice.jpg');
});

const row = (rank: number, team: string, points: number, played: number, won: number, scores: number[]) => ({
  rank, team, points, played, won, lost: played - won, forfeits: 0,
  wins_3_0: scores[0], wins_3_1: scores[1], wins_3_2: scores[2], losses_2_3: scores[3], losses_1_3: scores[4], losses_0_3: scores[5],
});
const standings = (team_id: string, team_name: string, section_id: string, section_name: string, club_team: string, rows: unknown[], matches: unknown[] = []) => ({
  source_id: `src-${team_id}`, season: '2026/2027', pool: '2FC', title: '2FC - CHAMPIONNAT REGIONAL 2 SENIOR FEMININ : POULE C',
  club_team, team_id, team_name, section_id, section_name, updated_at: rows.length ? '2026-11-05T05:00:00Z' : null, rows, matches,
});

it('présente le classement de chaque équipe, groupé par section, et passe d’une équipe à l’autre', async () => {
  club.standings = [
    standings('t1', 'Senior Féminin 1', 's1', 'Séniors', 'LSO COLOMBES', [
      row(1, 'UGS DRAVEIL JUVISY ATHIS MONTGERON VB - DJAM VB', 9, 3, 3, [2, 1, 0, 0, 0, 0]),
      row(5, 'LSO COLOMBES', 5, 3, 2, [0, 1, 1, 0, 1, 0]),
    ]),
    standings('t2', 'Senior Féminin 2', 's1', 'Séniors', 'LSO COLOMBES 2', [row(1, 'LSO COLOMBES 2', 3, 1, 1, [1, 0, 0, 0, 0, 0])]),
    standings('t5', 'M18 F', 's2', 'Jeunes', 'LSO COLOMBES', []),
  ];
  render(<MemoryRouter initialEntries={['/?onglet=resultats']}><OurClubPage pages={pages} /></MemoryRouter>);
  const seniors = await screen.findByRole('region', { name: 'Séniors' });
  const jeunes = screen.getByRole('region', { name: 'Jeunes' });
  // Sections dans l’ordre alphabétique.
  expect(screen.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent)).toEqual(['Jeunes', 'Séniors']);
  const switcher = within(seniors).getByRole('navigation', { name: 'Équipes Séniors' });
  expect(within(switcher).getByRole('button', { name: 'Senior Féminin 1' })).toHaveAttribute('aria-pressed', 'true');
  const table = within(seniors).getByRole('table', { name: 'Classement Senior Féminin 1' });
  expect(within(table).getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual(['#', 'Équipe', 'Pts', 'J', 'G', 'P', '3-0', '3-1', '3-2', '2-3', '1-3', '0-3']);
  const [, , own] = within(table).getAllByRole('row');
  expect(own).toHaveAttribute('aria-current', 'true');
  expect(within(own!).getAllByRole('cell').map((cell) => cell.textContent)).toEqual(['5', '5', '3', '2', '1', '–', '1', '1', '–', '1', '–']);
  expect(seniors).toHaveTextContent('saison 2026/2027 · mis à jour le');
  await userEvent.click(within(switcher).getByRole('button', { name: 'Senior Féminin 2' }));
  expect(within(seniors).getByRole('table', { name: 'Classement Senior Féminin 2' })).toBeInTheDocument();
  // Une seule équipe : pas de choix ; pas encore relevé : annoncé.
  expect(within(jeunes).queryByRole('navigation')).not.toBeInTheDocument();
  expect(jeunes).toHaveTextContent('Classement pas encore disponible.');
});

it('ouvre le classement de l’équipe de l’adresse et annonce l’absence de source', async () => {
  club.standings = [
    standings('t1', 'Senior Féminin 1', 's1', 'Séniors', 'LSO COLOMBES', [row(1, 'LSO COLOMBES', 3, 1, 1, [1, 0, 0, 0, 0, 0])]),
    standings('t2', 'Senior Féminin 2', 's1', 'Séniors', 'LSO COLOMBES 2', [row(1, 'LSO COLOMBES 2', 3, 1, 1, [1, 0, 0, 0, 0, 0])]),
  ];
  const { unmount } = render(<MemoryRouter initialEntries={['/?onglet=resultats&equipe=t2']}><OurClubPage pages={pages} /></MemoryRouter>);
  expect(await screen.findByRole('table', { name: 'Classement Senior Féminin 2' })).toBeInTheDocument();
  unmount();
  club.standings = [];
  render(<MemoryRouter initialEntries={['/?onglet=resultats']}><OurClubPage pages={pages} /></MemoryRouter>);
  expect(await screen.findByText('Aucune équipe n’a encore de classement FFVB.')).toBeInTheDocument();
});

it('liste sous le classement les matchs à venir puis les matchs joués, avec heure, lieu et score', async () => {
  club.standings = [
    standings('t1', 'Senior Féminin 1', 's1', 'Séniors', 'LSO COLOMBES', [row(5, 'LSO COLOMBES', 5, 3, 2, [0, 1, 1, 0, 1, 0])], [
      { match_code: '2FCA002', kickoff_at: '2026-10-03T18:30:00Z', home_team: 'AS ELAN CHEVILLY-LARUE', away_team: 'LSO COLOMBES', location: null, score: { home_sets: 1, away_sets: 3, set_scores: ['25:18', '19:25', '23:25', '23:25'], points: '90-93' } },
      { match_code: '2FCA011', kickoff_at: '2026-10-24T18:30:00Z', home_team: 'UGS DRAVEIL JUVISY ATHIS MONTGERON VB - DJAM VB', away_team: 'LSO COLOMBES', location: 'GYMNASE JEAN MOULIN', score: { home_sets: 3, away_sets: 1, set_scores: ['25:21', '25:14', '18:25', '25:9'], points: '93-69' } },
      { match_code: '2FCA020', kickoff_at: '2026-11-08T14:00:00Z', home_team: 'BUSSY VOLLEY', away_team: 'LSO COLOMBES', location: 'COMPLEXE SPORTIF HERZOG', score: null },
      { match_code: '2FCA022', kickoff_at: '2026-11-21T20:00:00Z', home_team: 'LSO COLOMBES', away_team: 'VESINET SAINT-GERMAIN CROISSY VOLLEY 2', location: 'GYMNASE AMBROISE PARÉ', score: null },
    ]),
  ];
  render(<MemoryRouter initialEntries={['/?onglet=resultats']}><OurClubPage pages={pages} /></MemoryRouter>);
  const upcoming = await screen.findByRole('region', { name: 'Matchs à venir' });
  const [next, later] = within(upcoming).getAllByRole('listitem');
  expect(next).toHaveTextContent('15:00');
  expect(next).toHaveTextContent('BUSSY VOLLEY / LSO COLOMBES');
  expect(next).toHaveTextContent('Extérieur');
  expect(next).toHaveTextContent('Lieu : COMPLEXE SPORTIF HERZOG');
  expect(later).toHaveTextContent('Domicile');
  const played = within(screen.getByRole('region', { name: 'Matchs joués' })).getAllByRole('listitem');
  // Le plus récent d’abord.
  expect(played[0]).toHaveTextContent('3 – 1');
  expect(played[0]).toHaveTextContent('Défaite');
  expect(played[0]).toHaveTextContent('Samedi 24 octobre · 20:30');
  expect(played[0]).toHaveTextContent('Lieu : GYMNASE JEAN MOULIN · Sets : 25:21 · 25:14 · 18:25 · 25:9 · points 93 – 69');
  expect(played[1]).toHaveTextContent('Victoire');
  expect(played[1]).not.toHaveTextContent('Lieu');
});

it('défile jusqu’à la section de l’équipe demandée, ou jusqu’à la section de l’adresse', async () => {
  const scrolled: string[] = [];
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value(this: HTMLElement) { scrolled.push(this.querySelector('h3')?.textContent ?? ''); } });
  club.standings = [
    standings('t1', 'Senior Féminin 1', 's1', 'Séniors', 'LSO COLOMBES', []),
    standings('t5', 'M18 F', 's2', 'Jeunes', 'LSO COLOMBES', []),
    standings('t6', 'M15 F', 's2', 'Jeunes', 'LSO COLOMBES 2', []),
  ];
  const { unmount } = render(<MemoryRouter initialEntries={['/?onglet=resultats&equipe=t6']}><OurClubPage pages={pages} /></MemoryRouter>);
  const jeunes = await screen.findByRole('region', { name: 'Jeunes' });
  expect(within(jeunes).getByRole('button', { name: 'M15 F' })).toHaveAttribute('aria-pressed', 'true');
  await waitFor(() => expect(scrolled).toEqual(['Jeunes']));
  unmount();
  scrolled.length = 0;
  render(<MemoryRouter initialEntries={['/?onglet=resultats&section=s1']}><OurClubPage pages={pages} /></MemoryRouter>);
  await screen.findByRole('region', { name: 'Séniors' });
  await waitFor(() => expect(scrolled).toEqual(['Séniors']));
  Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
});
