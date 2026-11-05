import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { expect, it } from 'vitest';
import { ReleaseNotes } from './ReleaseNotes';
import { release } from './releaseNotes';

it('présente les nouveautés puis les correctifs de la version', () => {
  render(<MemoryRouter><ReleaseNotes /></MemoryRouter>);
  const card = screen.getByRole('region', { name: 'Quoi de neuf ?' });
  expect(card).toHaveTextContent(`Version ${release.version} · depuis la version ${release.previous}`);
  const features = within(card).getByRole('region', { name: 'Nouveautés' });
  expect(within(features).getAllByRole('listitem')).toHaveLength(release.notes.filter((note) => note.kind === 'feature').length);
  expect(within(features).getByRole('link', { name: 'Voir les résultats' })).toHaveAttribute('href', '/app/notre-club?onglet=resultats');
  expect(within(card).getByRole('region', { name: 'Correctifs' })).toHaveTextContent('Correctif apporté sur la récupération des matchs FFVB');
});

it('n’affiche que les groupes renseignés, et rien sans changement', () => {
  const { unmount } = render(
    <MemoryRouter>
      <ReleaseNotes release={{ version: '1.0.0', previous: '0.9.0', notes: [{ kind: 'fix', title: 'Correctif.' }] }} />
    </MemoryRouter>,
  );
  expect(screen.queryByRole('region', { name: 'Nouveautés' })).not.toBeInTheDocument();
  expect(screen.getByRole('region', { name: 'Correctifs' })).toHaveTextContent('Correctif.');
  unmount();
  render(<MemoryRouter><ReleaseNotes release={{ version: '1.0.0', previous: '0.9.0', notes: [] }} /></MemoryRouter>);
  expect(screen.queryByRole('region', { name: 'Quoi de neuf ?' })).not.toBeInTheDocument();
});
