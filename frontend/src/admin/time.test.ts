import { expect, it } from 'vitest';
import { fromLocal, interval, toLocal } from './time';
it('convertit les heures de Paris en hiver et été sans dépendre du navigateur', () => {
  expect(fromLocal('2026-10-20T18:00')).toBe('2026-10-20T16:00:00.000Z');
  expect(fromLocal('2026-12-20T18:00')).toBe('2026-12-20T17:00:00.000Z');
  expect(toLocal('2026-10-20T16:00:00Z')).toBe('2026-10-20T18:00');
});
it('refuse les heures inexistantes et ambiguës aux changements d’heure', () => {
  expect(() => fromLocal('2027-03-28T02:30')).toThrow('n’existe pas');
  expect(() => fromLocal('2026-10-25T02:30')).toThrow('deux fois');
});
it('refuse une fin antérieure ou identique au début', () => {
  expect(() => interval('2026-10-20T18:00', '2026-10-20T17:00')).toThrow('La fin');
  expect(() => interval('2026-10-20T18:00', '2026-10-20T18:00')).toThrow('La fin');
});
