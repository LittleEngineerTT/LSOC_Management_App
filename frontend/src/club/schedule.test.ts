import { expect, it } from 'vitest';
import { schedule } from './schedule';

const recurring = {
  repeat: true,
  weekdays: ['3', '1'],
  start_time: '20:00',
  end_time: '22:00',
  until: '2027-07-31',
};

it('une récurrence commence au premier jour coché à partir d’aujourd’hui', () => {
  // Dimanche 11 octobre 2026 : premier mardi le 13, à 20 h à Paris (UTC+2).
  expect(schedule(recurring, '2026-10-11')).toEqual({
    starts_at: '2026-10-13T18:00:00.000Z',
    ends_at: '2026-10-13T20:00:00.000Z',
    recurrence: { until: '2027-07-31', weekdays: [1, 3] },
  });
});

it('une heure de fin avant celle du début termine le lendemain', () => {
  const late = schedule({ ...recurring, start_time: '22:00', end_time: '00:30' }, '2026-10-11');
  expect([late.starts_at, late.ends_at]).toEqual([
    '2026-10-13T20:00:00.000Z',
    '2026-10-13T22:30:00.000Z',
  ]);
});

it('refuse une récurrence sans jour ou sans occurrence, et vérifie un événement unique', () => {
  expect(() => schedule({ ...recurring, weekdays: [] }, '2026-10-11')).toThrow(
    'Cochez au moins un jour',
  );
  expect(() => schedule({ ...recurring, until: '2026-10-12' }, '2026-10-11')).toThrow(
    'Aucune occurrence',
  );
  expect(() =>
    schedule({ repeat: false, starts_at: '2026-10-13T20:00', ends_at: '2026-10-13T19:00' }),
  ).toThrow('La fin doit suivre le début.');
  expect(
    schedule({ repeat: false, starts_at: '2026-10-13T20:00', ends_at: '2026-10-13T22:00' }),
  ).toEqual({ starts_at: '2026-10-13T18:00:00.000Z', ends_at: '2026-10-13T20:00:00.000Z' });
});
