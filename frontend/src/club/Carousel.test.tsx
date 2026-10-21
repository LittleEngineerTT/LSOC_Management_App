import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Carousel } from './Carousel';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const slides = ['Premier', 'Deuxième', 'Troisième'].map((text) => <p key={text}>{text}</p>);

it('fait défiler les informations toutes les 5 secondes par défaut, en boucle', () => {
  render(<Carousel label="Infos" slides={slides} />);
  expect(screen.getByText('Premier')).toBeInTheDocument();
  act(() => vi.advanceTimersByTime(4999));
  expect(screen.getByText('Premier')).toBeInTheDocument();
  act(() => vi.advanceTimersByTime(1));
  expect(screen.getByText('Deuxième')).toBeInTheDocument();
  act(() => vi.advanceTimersByTime(10_000));
  expect(screen.getByText('Premier')).toBeInTheDocument();
  expect(screen.getByRole('group', { name: '1 sur 3' })).toBeInTheDocument();
});

it('se met en pause au bouton, au survol et se navigue à la main', () => {
  render(<Carousel label="Infos" slides={slides} interval={1000} />);
  fireEvent.click(screen.getByRole('button', { name: 'Mettre en pause' }));
  act(() => vi.advanceTimersByTime(5000));
  expect(screen.getByText('Premier')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Information précédente' }));
  expect(screen.getByText('Troisième')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Information 2' }));
  expect(screen.getByText('Deuxième')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Reprendre le défilement' }));
  fireEvent.mouseEnter(screen.getByRole('group', { name: 'Infos' }));
  act(() => vi.advanceTimersByTime(5000));
  expect(screen.getByText('Deuxième')).toBeInTheDocument();
  fireEvent.mouseLeave(screen.getByRole('group', { name: 'Infos' }));
  act(() => vi.advanceTimersByTime(1000));
  expect(screen.getByText('Troisième')).toBeInTheDocument();
});

it('reste immobile avec une seule information et disparaît sans information', () => {
  const { container, rerender } = render(<Carousel label="Infos" slides={[slides[0]]} />);
  expect(screen.queryByRole('button', { name: 'Mettre en pause' })).not.toBeInTheDocument();
  rerender(<Carousel label="Infos" slides={[]} />);
  expect(container).toBeEmptyDOMElement();
});
