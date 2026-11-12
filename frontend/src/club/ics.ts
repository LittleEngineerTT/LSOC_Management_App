import type { Event } from '../admin/types';

/**
 * Export statique au format iCalendar (RFC 5545), lisible par les agendas des téléphones et des
 * ordinateurs. Les événements sont copiés tels qu’ils sont au moment de l’export : l’agenda ne
 * reçoit aucune mise à jour ensuite (un abonnement dynamique viendra plus tard).
 */
export interface IcsOptions {
  /** Lieu affiché d’un événement (gymnase du club ou lieu extérieur). */
  place: (event: Event) => string;
  /** Adresse de l’application, pour le lien de chaque événement. */
  origin: string;
  /** Horodatage de l’export ; par défaut, maintenant. */
  now?: Date;
}

// Date et heure UTC au format iCalendar : 20261015T160000Z.
function stamp(value: Date) {
  return value
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
}
// Journée de Paris au format iCalendar, pour un match dont l’heure reste à compléter.
function parisDate(value: string) {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Paris' })
    .format(new Date(value))
    .replace(/-/g, '');
}
function nextDate(value: string) {
  const [year, month, day] = [value.slice(0, 4), value.slice(4, 6), value.slice(6, 8)].map(Number);
  const next = new Date(Date.UTC(year!, month! - 1, day! + 1));
  return next.toISOString().slice(0, 10).replace(/-/g, '');
}
// Texte échappé : antislash, point-virgule, virgule et retours à la ligne.
function text(value: string) {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}
// Lignes repliées à 75 octets, la suite commençant par une espace.
function fold(line: string) {
  const encoder = new TextEncoder();
  const parts: string[] = [];
  let current = '';
  for (const character of line) {
    const limit = parts.length ? 74 : 75;
    if (encoder.encode(current + character).length > limit) {
      parts.push(current);
      current = character;
    } else current += character;
  }
  parts.push(current);
  return parts.join('\r\n ');
}

export function toIcs(events: Event[], { place, origin, now = new Date() }: IcsOptions): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//LSO Colombes Volley//Espace club//FR',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:LSO Colombes Volley',
    'X-WR-TIMEZONE:Europe/Paris',
  ];
  for (const event of events) {
    const status = event.cancelled ? ' (annulé)' : event.conflict ? ' (conflit)' : '';
    const link = `${origin}/app/planning?event=${encodeURIComponent(event.id)}`;
    const details = [
      event.kickoff_at &&
        !event.time_unknown &&
        `Coup d’envoi : ${new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit' }).format(new Date(event.kickoff_at))}`,
      event.time_unknown && 'Heure du match à compléter.',
      event.description,
      'Copie figée à la date de l’export : consultez l’espace club pour les mises à jour.',
      link,
    ].filter(Boolean);
    lines.push('BEGIN:VEVENT', `UID:${event.id}@lsoc-colombes-volley`, `DTSTAMP:${stamp(now)}`);
    if (event.time_unknown) {
      // Journée seule : l’heure du match n’est pas encore connue.
      const day = parisDate(event.starts_at);
      lines.push(`DTSTART;VALUE=DATE:${day}`, `DTEND;VALUE=DATE:${nextDate(day)}`);
    } else {
      lines.push(
        `DTSTART:${stamp(new Date(event.starts_at))}`,
        `DTEND:${stamp(new Date(event.ends_at))}`,
      );
    }
    lines.push(
      `SUMMARY:${text(event.title + status)}`,
      `LOCATION:${text(place(event))}`,
      `DESCRIPTION:${text(details.join('\n'))}`,
      `URL:${link}`,
      `STATUS:${event.cancelled ? 'CANCELLED' : event.conflict ? 'TENTATIVE' : 'CONFIRMED'}`,
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}

/** Propose le fichier au téléchargement ; sur mobile, l’ouvrir l’ajoute à l’agenda. */
export function downloadIcs(content: string, name: string) {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/calendar;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  // Laisse au navigateur le temps de lancer le téléchargement.
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
