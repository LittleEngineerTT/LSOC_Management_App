const paris = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Europe/Paris',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});
export function toLocal(value: string | null | undefined): string {
  return value ? paris.format(new Date(value)).replace(' ', 'T') : '';
}
export function fromLocal(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value))
    throw new Error('Saisissez une date et une heure valides.');
  const wall = Date.parse(`${value}:00Z`);
  if (!Number.isFinite(wall)) throw new Error('Date invalide.');
  // Test both Paris offsets. This is independent of the browser’s local timezone.
  const candidates = [2, 1]
    .map((offset) => new Date(wall - offset * 3_600_000))
    .filter((date) => toLocal(date.toISOString()) === value);
  if (!candidates.length)
    throw new Error('Cette heure n’existe pas en Europe/Paris lors du passage à l’heure d’été.');
  if (candidates.length > 1)
    throw new Error(
      'Cette heure existe deux fois en Europe/Paris lors du passage à l’heure d’hiver. Choisissez une heure non ambiguë.',
    );
  return candidates[0]!.toISOString();
}
export function interval(start: string, end: string) {
  const starts_at = fromLocal(start);
  const ends_at = fromLocal(end);
  if (ends_at <= starts_at) throw new Error('La fin doit suivre le début.');
  return { starts_at, ends_at };
}
export function dateLabel(value: string | null | undefined): string {
  return value
    ? new Intl.DateTimeFormat('fr-FR', {
        timeZone: 'Europe/Paris',
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(new Date(value))
    : 'Jamais';
}
