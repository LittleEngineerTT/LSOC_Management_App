import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ClubInfos } from './ClubInfos';
import { clubInfos } from './clubInfos';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it('présente l’encart de test avec son image et déplie un texte long', () => {
  render(<ClubInfos />);
  expect(screen.getByRole('region', { name: 'Informations du club' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Encart de test' })).toBeInTheDocument();
  expect(screen.getByRole('img', { name: /Image de test/ })).toHaveAttribute('src', clubInfos[0]!.image!.src);
  const text = screen.getByText(/Ceci est un encart de test/);
  expect(text).toHaveClass('clamped');
  fireEvent.click(screen.getByRole('button', { name: 'Voir plus' }));
  expect(text).not.toHaveClass('clamped');
  expect(screen.getByRole('button', { name: 'Voir moins' })).toHaveAttribute('aria-expanded', 'true');
});

it('n’affiche « Voir plus » que si le contenu le nécessite et s’arrête pendant la lecture', () => {
  render(
    <ClubInfos
      infos={[
        { id: 'court', title: 'Court', content: 'Reprise lundi.' },
        { id: 'long', title: 'Long', content: 'Assemblée générale. '.repeat(20) },
      ]}
    />,
  );
  expect(screen.queryByRole('button', { name: 'Voir plus' })).not.toBeInTheDocument();
  act(() => vi.advanceTimersByTime(5000));
  const more = screen.getByRole('button', { name: 'Voir plus' });
  // Le focus reste dans l’encart après le clic : le texte déplié ne défile plus.
  fireEvent.mouseEnter(more);
  more.focus();
  fireEvent.click(more);
  fireEvent.mouseLeave(screen.getByRole('group', { name: 'Informations' }));
  act(() => vi.advanceTimersByTime(20_000));
  expect(screen.getByRole('heading', { name: 'Long' })).toBeInTheDocument();
});
