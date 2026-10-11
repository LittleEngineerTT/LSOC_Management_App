import type { Event } from '../admin/types';
import { toLocal } from '../admin/time';
import { addDays, dayStart, mondayOf } from './calendar';

export const HOUR_HEIGHT = 48;
export const MIN_EVENT_MINUTES = 90;

export interface CalendarSegment {
  event: Event;
  day: string;
  startMinute: number;
  endMinute: number;
  continuesBefore: boolean;
  continuesAfter: boolean;
}
export interface PlacedSegment extends CalendarSegment {
  lane: number;
  lanes: number;
}

export function monthDays(day: string): string[] {
  const first = mondayOf(`${day.slice(0, 7)}-01`);
  return Array.from({ length: 42 }, (_, index) => addDays(first, index));
}
export function shiftMonth(day: string, count: number): string {
  const date = new Date(`${day.slice(0, 7)}-01T12:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + count);
  return date.toISOString().slice(0, 10);
}
function minutes(value: string): number {
  const [hour, minute] = toLocal(value).slice(11, 16).split(':').map(Number);
  return hour! * 60 + minute!;
}

/** Split on actual Paris midnights, including summer/winter time and exclusive ends. */
export function splitEvents(events: Event[], days: string[]): CalendarSegment[] {
  return days.flatMap((day) => {
    const start = Date.parse(dayStart(day));
    const end = Date.parse(dayStart(addDays(day, 1)));
    return events.flatMap((event) => {
      const eventStart = Date.parse(event.starts_at);
      const eventEnd = Date.parse(event.ends_at);
      if (!(eventEnd > eventStart && eventEnd > start && eventStart < end)) return [];
      const startMinute = eventStart <= start ? 0 : minutes(event.starts_at);
      const endMinute = eventEnd >= end ? 1440 : minutes(event.ends_at);
      return [
        {
          event,
          day,
          startMinute,
          endMinute: Math.max(startMinute + 1, endMinute),
          continuesBefore: eventStart < start,
          continuesAfter: eventEnd > end,
        },
      ];
    });
  });
}

/** Separate overlapping cards, including the minimum height needed to read short events. */
export function placeSegments(segments: CalendarSegment[]): PlacedSegment[] {
  const placed: PlacedSegment[] = [];
  const days = [...new Set(segments.map((item) => item.day))];
  for (const day of days) {
    const sorted = segments
      .filter((item) => item.day === day)
      .sort(
        (a, b) =>
          a.startMinute - b.startMinute ||
          b.endMinute - a.endMinute ||
          a.event.id.localeCompare(b.event.id),
      );
    let group: PlacedSegment[] = [];
    let ends: number[] = [];
    let groupEnd = -1;
    function finish() {
      for (const item of group) item.lanes = ends.length;
      placed.push(...group);
      group = [];
      ends = [];
      groupEnd = -1;
    }
    for (const item of sorted) {
      if (item.startMinute >= groupEnd && group.length) finish();
      const laneEnd = Math.max(item.endMinute, item.startMinute + MIN_EVENT_MINUTES);
      let lane = ends.findIndex((end) => end <= item.startMinute);
      if (lane < 0) lane = ends.length;
      ends[lane] = laneEnd;
      groupEnd = Math.max(groupEnd, laneEnd);
      group.push({ ...item, lane, lanes: 1 });
    }
    finish();
  }
  return placed;
}
