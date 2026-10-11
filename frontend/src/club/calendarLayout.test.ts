import { expect, it } from 'vitest';
import type { Event } from '../admin/types';
import { monthDays, splitEvents, placeSegments } from './calendarLayout';

const event = (id: string, starts_at: string, ends_at: string) =>
  ({ id, starts_at, ends_at }) as Event;

it('construit un mois de six semaines à partir du lundi, y compris au changement d’année', () => {
  const days = monthDays('2027-01-20');
  expect(days).toHaveLength(42);
  expect(days[0]).toBe('2026-12-28');
  expect(days.at(-1)).toBe('2027-02-07');
});

it('répartit un événement sur chaque jour traversé et exclut la fin à minuit', () => {
  const value = event('night', '2026-10-10T20:00:00Z', '2026-10-12T22:00:00Z');
  const parts = splitEvents([value], ['2026-10-10', '2026-10-11', '2026-10-12', '2026-10-13']);
  expect(parts.map((item) => [item.day, item.startMinute, item.endMinute])).toEqual([
    ['2026-10-10', 1320, 1440],
    ['2026-10-11', 0, 1440],
    ['2026-10-12', 0, 1440],
  ]);
  expect(parts[1]).toMatchObject({ continuesBefore: true, continuesAfter: true });
});

it('respecte les heures de Paris pendant les journées de 23 et 25 heures', () => {
  const spring = splitEvents(
    [event('spring', '2027-03-28T00:00:00Z', '2027-03-28T02:00:00Z')],
    ['2027-03-28'],
  );
  expect(spring[0]).toMatchObject({ startMinute: 60, endMinute: 240 });
  const fall = splitEvents(
    [event('fall', '2026-10-24T22:00:00Z', '2026-10-25T23:00:00Z')],
    ['2026-10-25'],
  );
  expect(fall[0]).toMatchObject({ startMinute: 0, endMinute: 1440 });
});

it('place les événements superposés côte à côte et réutilise la largeur après le groupe', () => {
  const parts = splitEvents(
    [
      event('one', '2026-10-11T16:00:00Z', '2026-10-11T18:00:00Z'),
      event('two', '2026-10-11T17:00:00Z', '2026-10-11T19:00:00Z'),
      event('three', '2026-10-11T20:00:00Z', '2026-10-11T22:00:00Z'),
    ],
    ['2026-10-11'],
  );
  const placed = placeSegments(parts);
  expect(placed.map((item) => [item.event.id, item.lane, item.lanes])).toEqual([
    ['one', 0, 2],
    ['two', 1, 2],
    ['three', 0, 1],
  ]);
});

it('évite que les cartes des événements courts se masquent malgré leur hauteur minimale', () => {
  const parts = splitEvents(
    [
      event('short', '2026-10-11T16:00:00Z', '2026-10-11T16:15:00Z'),
      event('next', '2026-10-11T16:30:00Z', '2026-10-11T17:00:00Z'),
    ],
    ['2026-10-11'],
  );
  expect(placeSegments(parts).map((item) => item.lanes)).toEqual([2, 2]);
});
