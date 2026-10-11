import { expect, it } from 'vitest';
import { daysBetween, horizonEnd, nextJuly31 } from './calendar';

it('mon planning s’étend jusqu’au 31 août de l’année suivante', () => {
  expect(horizonEnd('2026-10-10')).toBe('2027-09-01');
  expect(horizonEnd('2027-03-15')).toBe('2028-09-01');
  expect(daysBetween('2026-10-10', horizonEnd('2026-10-10'))).toBe(326);
});

it('la récurrence se termine par défaut au prochain 31 juillet', () => {
  expect(nextJuly31('2026-10-11')).toBe('2027-07-31');
  expect(nextJuly31('2027-03-01')).toBe('2027-07-31');
  expect(nextJuly31('2027-07-31')).toBe('2027-07-31');
  expect(nextJuly31('2027-08-01')).toBe('2028-07-31');
});
