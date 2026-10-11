import { toLocal } from '../admin/time';
import { addDays, dayStart } from './calendar';

export interface GymInterval {
  starts_at: string;
  ends_at: string;
}
export interface GymDaySlot<T> {
  item: T;
  day: string;
  startMinute: number;
  endMinute: number;
}
/** Clip every interval against real Paris midnights; ends are exclusive. */
export function splitGymIntervals<T extends GymInterval>(
  items: T[],
  days: string[],
): GymDaySlot<T>[] {
  const minute = (value: string) => {
    const [hour, minutes] = toLocal(value).slice(11, 16).split(':').map(Number);
    return hour! * 60 + minutes!;
  };
  return days.flatMap((day) => {
    const start = Date.parse(dayStart(day));
    const end = Date.parse(dayStart(addDays(day, 1)));
    return items.flatMap((item) => {
      const itemStart = Date.parse(item.starts_at);
      const itemEnd = Date.parse(item.ends_at);
      if (!(itemEnd > itemStart && itemEnd > start && itemStart < end)) return [];
      const startMinute = itemStart <= start ? 0 : minute(item.starts_at);
      return [
        {
          item,
          day,
          startMinute,
          endMinute: itemEnd >= end ? 1440 : Math.max(startMinute + 1, minute(item.ends_at)),
        },
      ];
    });
  });
}
export function gymSlotTime(slot: Pick<GymDaySlot<unknown>, 'startMinute' | 'endMinute'>): string {
  const format = (minutes: number) =>
    `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
  return `${format(slot.startMinute)} – ${format(slot.endMinute)}`;
}

/** Allocate lanes to bookings, leaving readable room for short reservations. */
export function placeGymBookings<T>(slots: GymDaySlot<T>[]) {
  const placed: (GymDaySlot<T> & { lane: number; lanes: number })[] = [];
  for (const day of new Set(slots.map((slot) => slot.day))) {
    const sorted = slots
      .filter((slot) => slot.day === day)
      .sort((a, b) => a.startMinute - b.startMinute || b.endMinute - a.endMinute);
    let group: typeof placed = [];
    let ends: number[] = [];
    let groupEnd = -1;
    function finish() {
      for (const item of group) item.lanes = ends.length;
      placed.push(...group);
      group = [];
      ends = [];
      groupEnd = -1;
    }
    for (const slot of sorted) {
      if (slot.startMinute >= groupEnd && group.length) finish();
      const end = Math.max(slot.endMinute, slot.startMinute + 150);
      let lane = ends.findIndex((value) => value <= slot.startMinute);
      if (lane < 0) lane = ends.length;
      ends[lane] = end;
      groupEnd = Math.max(groupEnd, end);
      group.push({ ...slot, lane, lanes: 1 });
    }
    finish();
  }
  return placed;
}
