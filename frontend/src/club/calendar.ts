import { fromLocal, toLocal } from '../admin/time';

// Days are 'YYYY-MM-DD' strings in Europe/Paris; arithmetic stays on calendar dates.
export function parisDay(value: string | Date): string {
  return toLocal(typeof value === 'string' ? value : value.toISOString()).slice(0, 10);
}
export function today(): string {
  return parisDay(new Date());
}
export function addDays(day: string, count: number): string {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + count);
  return date.toISOString().slice(0, 10);
}
export function mondayOf(day: string): string {
  const weekday = new Date(`${day}T12:00:00Z`).getUTCDay();
  return addDays(day, weekday === 0 ? -6 : 1 - weekday);
}
export function validDay(value: string | null): value is string {
  return !!value && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value));
}
/** Instant at which a Paris day begins; midnight always exists in Europe/Paris. */
export function dayStart(day: string): string {
  return fromLocal(`${day}T00:00`);
}
export function range(firstDay: string, days: number) {
  return { starts_at: dayStart(firstDay), ends_at: dayStart(addDays(firstDay, days)) };
}
/** Lendemain du 31 août de l’année suivante : borne exclusive de « Mon planning ». */
export function horizonEnd(day: string): string {
  return `${Number(day.slice(0, 4)) + 1}-09-01`;
}
/** Prochain 31 juillet (fin de saison) : date de fin par défaut d’une récurrence. */
export function nextJuly31(day: string = today()): string {
  const year = Number(day.slice(0, 4));
  return day <= `${year}-07-31` ? `${year}-07-31` : `${year + 1}-07-31`;
}
export function horizonLabel(): string {
  return `31 août ${horizonEnd(today()).slice(0, 4)}`;
}
export function daysBetween(first: string, last: string): number {
  return Math.round(
    (Date.parse(`${last}T12:00:00Z`) - Date.parse(`${first}T12:00:00Z`)) / 86_400_000,
  );
}
export function rangeQuery(firstDay: string, days: number): string {
  const { starts_at, ends_at } = range(firstDay, days);
  return `starts_at=${encodeURIComponent(starts_at)}&ends_at=${encodeURIComponent(ends_at)}`;
}
const dayFormat = new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'UTC',
  weekday: 'long',
  day: 'numeric',
  month: 'long',
});
const shortDayFormat = new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'UTC',
  day: 'numeric',
  month: 'short',
});
const timeFormat = new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'Europe/Paris',
  hour: '2-digit',
  minute: '2-digit',
});
export function dayLabel(day: string): string {
  const label = dayFormat.format(new Date(`${day}T12:00:00Z`));
  return label.charAt(0).toUpperCase() + label.slice(1);
}
export function shortDay(day: string): string {
  return shortDayFormat.format(new Date(`${day}T12:00:00Z`));
}
export function weekLabel(monday: string): string {
  return `Semaine du ${shortDay(monday)} au ${shortDay(addDays(monday, 6))}`;
}
export function timeLabel(value: string): string {
  return timeFormat.format(new Date(value));
}
export function timeRange(start: string, end: string): string {
  const sameDay = parisDay(start) === parisDay(end);
  return sameDay
    ? `${timeLabel(start)} – ${timeLabel(end)}`
    : `${timeLabel(start)} – ${shortDay(parisDay(end))} ${timeLabel(end)}`;
}
