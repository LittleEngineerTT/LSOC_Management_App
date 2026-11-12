import { expect, it } from 'vitest';
import type { Event } from '../admin/types';
import { toIcs } from './ics';

const base = {
  description: '',
  kind: 'training',
  section_ids: [],
  gymnasium_id: 'g1',
  location: '',
  courts: 2,
  referent_ids: [],
  direct_edit: false,
  cancelled: false,
  version: 1,
  series_id: null,
  exception: false,
  ffvb_match_id: null,
  kickoff_at: null,
  before_minutes: 0,
  after_minutes: 0,
  occupancy_unknown: false,
  match_courts: 0,
  registration_section_ids: [],
  registration_limit: null,
  registration_count: 0,
} as unknown as Event;
const options = {
  place: () => 'Ambroise Paré',
  origin: 'https://club.example',
  now: new Date('2026-11-12T08:00:00Z'),
};

it('exporte un événement au format iCalendar, en UTC, avec son lien', () => {
  const ics = toIcs(
    [
      {
        ...base,
        id: 'e1',
        title: 'Entraînement, loisir; adultes',
        starts_at: '2026-11-15T17:00:00Z',
        ends_at: '2026-11-15T19:00:00Z',
      },
    ],
    options,
  );
  const lines = ics.split('\r\n');
  expect(lines[0]).toBe('BEGIN:VCALENDAR');
  expect(lines).toContain('BEGIN:VEVENT');
  expect(lines).toContain('UID:e1@lsoc-colombes-volley');
  expect(lines).toContain('DTSTAMP:20261112T080000Z');
  expect(lines).toContain('DTSTART:20261115T170000Z');
  expect(lines).toContain('DTEND:20261115T190000Z');
  // Virgules et points-virgules échappés.
  expect(lines).toContain('SUMMARY:Entraînement\\, loisir\\; adultes');
  expect(lines).toContain('LOCATION:Ambroise Paré');
  expect(lines).toContain('STATUS:CONFIRMED');
  expect(ics).toContain('URL:https://club.example/app/planning?event=e1');
  expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
});

it('place un match sans heure sur sa journée et signale annulations et conflits', () => {
  const ics = toIcs(
    [
      {
        ...base,
        id: 'm1',
        title: 'LSO / Paris',
        time_unknown: true,
        starts_at: '2026-11-14T23:30:00Z',
        ends_at: '2026-11-15T22:59:00Z',
      },
      {
        ...base,
        id: 'c1',
        title: 'Annulé',
        cancelled: true,
        starts_at: '2026-11-16T17:00:00Z',
        ends_at: '2026-11-16T19:00:00Z',
      },
      {
        ...base,
        id: 'k1',
        title: 'Gênant',
        conflict: true,
        starts_at: '2026-11-17T17:00:00Z',
        ends_at: '2026-11-17T19:00:00Z',
      },
    ],
    options,
  );
  const lines = ics.split('\r\n');
  // 23 h 30 UTC le 14 : le 15 novembre à Paris.
  expect(lines).toContain('DTSTART;VALUE=DATE:20261115');
  expect(lines).toContain('DTEND;VALUE=DATE:20261116');
  expect(lines).toContain('SUMMARY:Annulé (annulé)');
  expect(lines).toContain('STATUS:CANCELLED');
  expect(lines).toContain('SUMMARY:Gênant (conflit)');
  expect(lines).toContain('STATUS:TENTATIVE');
});

it('replie les lignes longues à 75 octets', () => {
  const ics = toIcs(
    [
      {
        ...base,
        id: 'e1',
        title: 'é'.repeat(80),
        starts_at: '2026-11-15T17:00:00Z',
        ends_at: '2026-11-15T19:00:00Z',
      },
    ],
    options,
  );
  for (const line of ics.split('\r\n'))
    expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
  expect(ics).toContain('\r\n é');
});
