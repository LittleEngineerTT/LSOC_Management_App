import { useState } from 'react';
import type { EventRequest } from '../admin/types';
import { dayLabel, parisDay, timeRange } from './calendar';
import { choices, EntityForm, num, str, type FormField, type FormValues } from '../admin/ui';
import { sectionGroups, useClub } from './context';
import { teamOptions } from './teamOrder';
import { kindLabels } from './events';
import { openToRegistrations, schedule, scheduleFields, scheduleInitial } from './schedule';

/** Occurrence d’une série qui dépasserait la capacité du gymnase (`/event-requests/conflicts`). */
interface OccurrenceConflict {
  starts_at: string;
  ends_at: string;
  missing: number;
}

/** Équipes pour lesquelles le compte peut demander un événement : référent ou coach rattaché. */
export function useCoachedTeams() {
  const { account, assignments, teams } = useClub();
  const coach = account.roles.includes('coach');
  return teams.filter(
    (team) =>
      team.referent_ids.includes(account.id) ||
      (coach &&
        assignments.some(
          (assignment) =>
            assignment.user_id === account.id &&
            assignment.team_id === team.id &&
            assignment.kind === 'coach',
        )),
  );
}

export function EventProposalForm({
  defaultDay,
  onDone,
  onCancel,
}: {
  defaultDay: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const { api, account, sections, teams, gymnasiums } = useClub();
  const coached = useCoachedTeams();
  const fields: FormField[] = [
    {
      name: 'team_ids',
      label: 'Équipes organisatrices',
      type: 'choices',
      all: true,
      options: teamOptions(coached, account.id),
      hint: 'Une ou plusieurs équipes que vous entraînez ; leurs sections sont concernées. Vous serez le référent.',
    },
    { name: 'title', label: 'Titre', required: true, maxLength: 200 },
    {
      name: 'description',
      label: 'Description',
      type: 'textarea',
      maxLength: 2000,
      hint: 'Contenu de la séance, matériel, consignes… Visible par tous les membres.',
    },
    {
      name: 'kind',
      label: 'Type',
      type: 'select',
      required: true,
      options: Object.entries(kindLabels).map(([value, label]) => ({ value, label })),
    },
    ...scheduleFields(),
    {
      name: 'gymnasium_id',
      label: 'Gymnase du club',
      type: 'select',
      options: gymnasiums.map((gym) => ({
        value: gym.id,
        label: `${gym.name} (${gym.capacity} terrains)`,
      })),
      hint: 'Laissez « Choisir… » pour un lieu extérieur, sans réservation de terrain.',
    },
    { name: 'location', label: 'Lieu extérieur', maxLength: 200 },
    {
      name: 'courts',
      label: 'Terrains occupés',
      type: 'number',
      min: 0,
      max: 100,
      required: true,
      hint: 'Au moins un terrain dans un gymnase du club, zéro à l’extérieur.',
    },
    {
      name: 'registration_section_ids',
      memberName: 'registration_team_ids',
      label: 'Ouvert aux inscriptions',
      type: 'groups',
      all: true,
      groups: sectionGroups(sections, teams),
      hint: 'Cochez une section pour l’ouvrir à tous ses membres, ou dépliez-la pour n’ouvrir que certaines équipes.',
    },
    {
      name: 'registration_limit',
      requiredWhen: openToRegistrations,
      label: 'Nombre maximal d’inscrits',
      type: 'number',
      min: 1,
      max: 1000,
      hint: 'Obligatoire dès qu’une équipe ou une section est ouverte.',
    },
    {
      name: 'note',
      label: 'Description de la demande',
      type: 'textarea',
      maxLength: 2000,
      hint: 'Message pour les administrateurs, non publié avec l’événement.',
    },
  ];
  // Occurrences d’une série qui dépasseraient la capacité du gymnase : un avertissement, que le
  // demandeur confirme pour envoyer sa demande quand même, sans forcer le dépassement.
  const [conflicts, setConflicts] = useState<OccurrenceConflict[]>([]);
  const [warned, setWarned] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  async function save(values: FormValues, signal: AbortSignal) {
    // Ordre du formulaire : la première équipe cochée porte la demande.
    const selected = coached
      .filter((team) => choices(values, 'team_ids').includes(team.id))
      .map((team) => team.id);
    if (!selected.length) throw new Error('Cochez au moins une équipe que vous coachez.');
    const [team_id, ...team_ids] = selected;
    const registration_section_ids = choices(values, 'registration_section_ids');
    const registration_team_ids = choices(values, 'registration_team_ids');
    const registration_limit = str(values, 'registration_limit')
      ? num(values, 'registration_limit')
      : null;
    if (
      (registration_section_ids.length || registration_team_ids.length) &&
      registration_limit === null
    )
      throw new Error('Indiquez le nombre maximal d’inscrits pour une séance ouverte.');
    const when = schedule(values);
    const gymnasium_id = str(values, 'gymnasium_id') || null;
    const courts = gymnasium_id ? num(values, 'courts') : 0;
    if (gymnasium_id && courts < 1)
      throw new Error('Réservez au moins un terrain dans un gymnase du club.');
    const body = {
      team_id,
      team_ids,
      title: str(values, 'title'),
      description: str(values, 'description'),
      kind: str(values, 'kind'),
      starts_at: when.starts_at,
      ends_at: when.ends_at,
      ...(when.recurrence ?? {}),
      gymnasium_id,
      location: str(values, 'location'),
      courts,
      registration_section_ids,
      registration_team_ids,
      registration_limit,
      note: str(values, 'note'),
    };
    if (when.recurrence && gymnasium_id && courts > 0) {
      const key = JSON.stringify(body);
      // Demande modifiée depuis l’avertissement : les conflits sont relus.
      if (!confirmed || key !== warned) {
        const found = await api.request<OccurrenceConflict[]>(
          '/event-requests/conflicts',
          'POST',
          body,
          signal,
        );
        setConflicts(found);
        setWarned(key);
        if (found.length && !(confirmed && key === warned)) {
          setConfirmed(false);
          throw new Error(
            'Certaines dates de la série sont en conflit avec d’autres événements : lisez l’avertissement et cochez « Envoyer quand même ».',
          );
        }
      }
    }
    await api.request<EventRequest>('/event-requests', 'POST', body, signal);
    onDone();
  }
  return (
    <EntityForm
      title="Demander un événement"
      markRequired
      fields={fields}
      initial={{
        team_ids: coached.length === 1 ? [coached[0]!.id] : [],
        title: '',
        description: '',
        kind: 'training',
        ...scheduleInitial(defaultDay),
        gymnasium_id: '',
        location: '',
        courts: '1',
        registration_section_ids: [],
        registration_team_ids: [],
        registration_limit: '',
        note: '',
      }}
      submit="Envoyer la demande"
      onCancel={onCancel}
      onSave={save}
    >
      <p className="admin-hint club-wide">
        L’événement sera créé après acceptation par un administrateur.
      </p>
      {conflicts.length > 0 && (
        <div className="admin-notice club-wide proposal-conflicts" role="alert">
          <strong>
            {conflicts.length === 1
              ? 'Une date de la série dépasse la capacité du gymnase'
              : `${conflicts.length} dates de la série dépassent la capacité du gymnase`}
          </strong>
          <ul>
            {conflicts.map((item) => (
              <li key={item.starts_at}>
                {dayLabel(parisDay(item.starts_at))}, {timeRange(item.starts_at, item.ends_at)} :{' '}
                {item.missing} terrain{item.missing > 1 ? 's' : ''} manquant
                {item.missing > 1 ? 's' : ''}
              </li>
            ))}
          </ul>
          <p>
            Vous pouvez envoyer la demande quand même : l’administrateur décidera de ces dates à la
            validation.
          </p>
          <label className="admin-check">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(change) => setConfirmed(change.target.checked)}
            />
            Envoyer quand même
          </label>
        </div>
      )}
    </EntityForm>
  );
}
