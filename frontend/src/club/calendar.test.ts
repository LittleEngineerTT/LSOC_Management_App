import { expect, it } from 'vitest';
import { daysBetween, horizonEnd } from './calendar';

it('mon planning s’étend jusqu’au 31 août de l’année suivante', () => {
  expect(horizonEnd('2026-10-10')).toBe('2027-09-01');
  expect(horizonEnd('2027-03-15')).toBe('2028-09-01');
  expect(daysBetween('2026-10-10', horizonEnd('2026-10-10'))).toBe(326);
});
