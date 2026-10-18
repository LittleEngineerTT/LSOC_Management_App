import { fromLocal } from '../admin/time';
import { checked, choices, str, type FormField, type FormValues } from '../admin/ui';
import { addDays, nextJuly31, today } from './calendar';

export const weekdayLabels = [
  'Lundi',
  'Mardi',
  'Mercredi',
  'Jeudi',
  'Vendredi',
  'Samedi',
  'Dimanche',
];

/**
 * Bloc horaire d’un nouvel événement : dates et heures de début et de fin, ou, si
 * « Répéter chaque semaine » est coché, jours de la semaine, heures et fin de la récurrence.
 */
export function scheduleFields(): FormField[] {
  return [
    {
      name: 'repeat',
      label: 'Répéter chaque semaine',
      type: 'checkbox',
      hint: 'Pour un entraînement régulier, aux mêmes jours et horaires chaque semaine.',
    },
    {
      name: 'starts_at',
      label: 'Début (Europe/Paris)',
      type: 'datetime-fr',
      required: true,
      hiddenWhen: 'repeat',
    },
    {
      name: 'ends_at',
      label: 'Fin (Europe/Paris)',
      type: 'datetime-fr',
      required: true,
      after: { name: 'starts_at', minutes: 120 },
      hiddenWhen: 'repeat',
    },
    {
      name: 'weekdays',
      label: 'Jours de répétition',
      type: 'choices',
      visibleWhen: 'repeat',
      options: weekdayLabels.map((label, index) => ({ value: String(index), label })),
      hint: 'La série commence au premier de ces jours à partir d’aujourd’hui.',
    },
    {
      name: 'start_time',
      label: 'Heure de début',
      type: 'time',
      required: true,
      visibleWhen: 'repeat',
    },
    {
      name: 'end_time',
      label: 'Heure de fin',
      type: 'time',
      required: true,
      after: { name: 'start_time', minutes: 120 },
      visibleWhen: 'repeat',
    },
    {
      name: 'until',
      label: 'Fin de la récurrence',
      type: 'date',
      required: true,
      visibleWhen: 'repeat',
      hint: 'Par défaut, le prochain 31 juillet. Deux ans au maximum.',
    },
  ];
}

export function scheduleInitial(defaultDay?: string): FormValues {
  return {
    repeat: false,
    starts_at: defaultDay ? `${defaultDay}T18:00` : '',
    ends_at: defaultDay ? `${defaultDay}T20:00` : '',
    weekdays: [],
    start_time: '18:00',
    end_time: '20:00',
    until: nextJuly31(),
  };
}

export interface Schedule {
  starts_at: string;
  ends_at: string;
  /** Présente pour une série hebdomadaire. */
  recurrence?: { until: string; weekdays: number[] };
}

/** Horaires à envoyer : la première occurrence d’une série sert de modèle au serveur. */
export function schedule(values: FormValues, from: string = today()): Schedule {
  if (!checked(values, 'repeat')) {
    const result = {
      starts_at: fromLocal(str(values, 'starts_at')),
      ends_at: fromLocal(str(values, 'ends_at')),
    };
    if (result.ends_at <= result.starts_at) throw new Error('La fin doit suivre le début.');
    return result;
  }
  const weekdays = choices(values, 'weekdays').map(Number).sort();
  if (!weekdays.length) throw new Error('Cochez au moins un jour de répétition.');
  const until = str(values, 'until');
  if (!until) throw new Error('Indiquez la fin de la récurrence.');
  const start = str(values, 'start_time');
  const end = str(values, 'end_time');
  if (!start || !end) throw new Error('Indiquez les heures de début et de fin.');
  let first = from;
  // 2001-01-01 est un lundi : l’écart en jours donne le jour de la semaine (0 = lundi).
  const weekday = (day: string) =>
    ((((Date.parse(`${day}T12:00:00Z`) - Date.parse('2001-01-01T12:00:00Z')) / 86_400_000) % 7) +
      7) %
    7;
  while (!weekdays.includes(weekday(first))) first = addDays(first, 1);
  if (first > until) throw new Error('Aucune occurrence avant la fin de la récurrence.');
  // Une heure de fin antérieure ou égale à celle du début termine le lendemain.
  const endDay = end > start ? first : addDays(first, 1);
  return {
    starts_at: fromLocal(`${first}T${start}`),
    ends_at: fromLocal(`${endDay}T${end}`),
    recurrence: { until, weekdays },
  };
}

/** Séance ouverte : au moins une section ou une équipe peut s’inscrire. */
export function openToRegistrations(values: FormValues) {
  return (
    choices(values, 'registration_section_ids').length > 0 ||
    choices(values, 'registration_team_ids').length > 0
  );
}
