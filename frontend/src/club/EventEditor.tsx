import { useState } from 'react';
import { AdminError } from '../admin/api';
import { fromLocal, toLocal } from '../admin/time';
import type { Event } from '../admin/types';
import {
  EntityForm,
  checked,
  choices,
  num,
  str,
  type FormField,
  type FormValues,
} from '../admin/ui';
import { timeRange } from './calendar';
import { schedule, scheduleFields, scheduleInitial } from './schedule';
import { useClub } from './context';
import { kindLabels } from './events';

type Scope = 'event' | 'following';
interface CapacityProblem {
  segments: { starts_at: string; ends_at: string; occupied: number; excess: number }[];
}
function capacityProblem(error: unknown): CapacityProblem | null {
  if (!(error instanceof AdminError) || error.status !== 409) return null;
  const detail = error.detail as {
    code?: string;
    segments?: CapacityProblem['segments'];
    events?: { segments: CapacityProblem['segments'] }[];
  } | null;
  if (detail?.code !== 'capacity_exceeded') return null;
  return { segments: detail.segments ?? detail.events?.flatMap((item) => item.segments) ?? [] };
}
function registrationLimit(values: FormValues): number | null {
  return str(values, 'registration_limit') ? num(values, 'registration_limit') : null;
}
function sameList(left: string[], right: string[]) {
  return [...left].sort().join() === [...right].sort().join();
}

/** Création (admin) ou modification d’un événement selon les droits effectifs. */
export function EventEditor({
  event,
  defaultDay,
  onDone,
  onCancel,
}: {
  event?: Event;
  defaultDay?: string;
  onDone: (message: string, event?: Event) => void;
  onCancel: () => void;
}) {
  const { api, admin, account, sections, teams, gymnasiums, users } = useClub();
  const [capacity, setCapacity] = useState<CapacityProblem | null>(null);
  const [force, setForce] = useState(false);
  const [acknowledge, setAcknowledge] = useState(false);
  const [scope, setScope] = useState<Scope>('event');
  const [includeExceptions, setIncludeExceptions] = useState(false);
  const ffvb = !!event?.ffvb_match_id;
  const direct = admin || (!!event && event.referent_id === account.id && event.direct_edit);
  const gymOptions = gymnasiums.map((gym) => ({
    value: gym.id,
    label: `${gym.name} (${gym.capacity} terrain${gym.capacity > 1 ? 's' : ''})`,
  }));
  const fields: FormField[] = [
    { name: 'title', label: 'Titre', required: true, maxLength: 200 },
    {
      name: 'description',
      label: 'Description',
      type: 'textarea' as const,
      maxLength: 2000,
      hint: 'Contenu de la séance, matériel, consignes… Visible par tous les membres.',
    },
    ...(!event
      ? [
          {
            name: 'kind',
            label: 'Type',
            type: 'select' as const,
            required: true,
            options: Object.entries(kindLabels).map(([value, label]) => ({ value, label })),
          },
        ]
      : []),
    ...(admin
      ? [
          {
            name: 'section_ids',
            label: 'Sections concernées',
            type: 'choices' as const,
            options: sections.map((section) => ({ value: section.id, label: section.name })),
          },
        ]
      : []),
    ...(!ffvb || admin
      ? [
          {
            name: 'gymnasium_id',
            label: 'Gymnase du club',
            type: 'select' as const,
            options: gymOptions,
            hint: 'Laissez « Choisir… » pour un lieu extérieur, sans réservation de terrain.',
          },
          { name: 'location', label: 'Lieu extérieur', maxLength: 200 },
        ]
      : []),
    ...(ffvb
      ? admin
        ? [
            {
              name: 'kickoff_at',
              label: 'Coup d’envoi (Europe/Paris)',
              type: 'datetime-local' as const,
              required: true,
            },
            {
              name: 'before_minutes',
              label: 'Réservation avant (minutes)',
              type: 'number' as const,
              min: 0,
              max: 1440,
            },
            {
              name: 'after_minutes',
              label: 'Réservation après (minutes)',
              type: 'number' as const,
              min: 1,
              max: 1440,
            },
          ]
        : []
      : event
        ? [
            {
              name: 'starts_at',
              label: 'Début (Europe/Paris)',
              type: 'datetime-local' as const,
              required: true,
            },
            {
              name: 'ends_at',
              label: 'Fin (Europe/Paris)',
              type: 'datetime-local' as const,
              required: true,
            },
          ]
        : scheduleFields('datetime-local')),
    {
      name: ffvb ? 'match_courts' : 'courts',
      label: ffvb ? 'Terrains réservés pour le match' : 'Terrains occupés',
      type: 'number',
      min: ffvb ? 1 : 0,
      max: 100,
      required: true,
      hint: ffvb ? undefined : 'Au moins un terrain dans un gymnase du club, zéro à l’extérieur.',
    },
    ...(admin
      ? [
          {
            name: 'referent_id',
            label: 'Référent',
            type: 'select' as const,
            required: true,
            options: users
              .filter((user) => user.active)
              .map((user) => ({ value: user.id, label: user.first_name })),
          },
          {
            name: 'direct_edit',
            label: 'Le référent peut modifier sans validation',
            type: 'checkbox' as const,
            hint: 'Ce droit est retiré automatiquement lors d’un changement de référent, sauf s’il est coché à nouveau.',
          },
          {
            name: 'registration_section_ids',
            label: 'Ouvert aux inscriptions des sections',
            type: 'choices' as const,
            options: sections.map((section) => ({ value: section.id, label: section.name })),
            hint: 'L’ouverture concerne les sections ou équipes sélectionnées.',
          },
          {
            name: 'registration_team_ids',
            label: 'Ouvert aux inscriptions des équipes',
            type: 'choices' as const,
            options: teams.map((team) => ({ value: team.id, label: team.name })),
            hint: 'Ouvrir une équipe permet seulement à ses membres de s’inscrire.',
          },
          {
            name: 'registration_limit',
            label: 'Nombre maximal d’inscrits',
            type: 'number' as const,
            min: 1,
            max: 1000,
            hint: 'Obligatoire pour une séance ouverte ; les inscriptions s’arrêtent une fois la limite atteinte.',
          },
        ]
      : []),
    ...(event ? [{ name: 'cancelled', label: 'Événement annulé', type: 'checkbox' as const }] : []),
  ];
  const initial: FormValues = event
    ? {
        title: event.title,
        description: event.description ?? '',
        section_ids: event.section_ids,
        gymnasium_id: event.gymnasium_id ?? '',
        location: event.location,
        starts_at: toLocal(event.starts_at),
        ends_at: toLocal(event.ends_at),
        kickoff_at: toLocal(event.kickoff_at),
        before_minutes: String(event.before_minutes),
        after_minutes: String(event.after_minutes),
        courts: String(event.courts),
        match_courts: String(event.match_courts),
        referent_id: event.referent_id ?? '',
        direct_edit: event.direct_edit,
        cancelled: event.cancelled,
        registration_section_ids: event.registration_section_ids,
        registration_team_ids: event.registration_team_ids ?? [],
        registration_limit:
          event.registration_limit === null ? '' : String(event.registration_limit),
      }
    : {
        title: '',
        description: '',
        kind: 'training',
        section_ids: [],
        gymnasium_id: '',
        location: '',
        ...scheduleInitial(defaultDay),
        courts: '1',
        referent_id: account.id,
        direct_edit: false,
        registration_section_ids: [],
        registration_team_ids: [],
        registration_limit: '',
      };

  function changes(values: FormValues, original: Event) {
    const result: Record<string, unknown> = {};
    const text = (name: 'title' | 'description' | 'location') => {
      if (
        fields.some((field) => field.name === name) &&
        str(values, name) !== (original[name] ?? '')
      )
        result[name] = str(values, name);
    };
    text('title');
    text('description');
    text('location');
    if (admin && !sameList(choices(values, 'section_ids'), original.section_ids))
      result.section_ids = choices(values, 'section_ids');
    if (fields.some((field) => field.name === 'gymnasium_id')) {
      const gym = str(values, 'gymnasium_id') || null;
      if (gym !== original.gymnasium_id) result.gymnasium_id = gym;
    }
    for (const name of ['starts_at', 'ends_at', 'kickoff_at'] as const)
      if (
        fields.some((field) => field.name === name) &&
        str(values, name) !== toLocal(original[name])
      )
        result[name] = fromLocal(str(values, name));
    for (const name of ['courts', 'match_courts', 'before_minutes', 'after_minutes'] as const)
      if (fields.some((field) => field.name === name) && num(values, name) !== original[name])
        result[name] = num(values, name);
    if (admin) {
      if (str(values, 'referent_id') !== (original.referent_id ?? ''))
        result.referent_id = str(values, 'referent_id');
      if (checked(values, 'direct_edit') !== original.direct_edit)
        result.direct_edit = checked(values, 'direct_edit');
      if (!sameList(choices(values, 'registration_section_ids'), original.registration_section_ids))
        result.registration_section_ids = choices(values, 'registration_section_ids');
      if (!sameList(choices(values, 'registration_team_ids'), original.registration_team_ids ?? []))
        result.registration_team_ids = choices(values, 'registration_team_ids');
      const limit = registrationLimit(values);
      if (limit !== original.registration_limit) result.registration_limit = limit;
    }
    if (checked(values, 'cancelled') !== original.cancelled)
      result.cancelled = checked(values, 'cancelled');
    if (result.gymnasium_id === null && !ffvb) result.courts = 0;
    return result;
  }

  async function save(values: FormValues, signal: AbortSignal) {
    try {
      if (
        admin &&
        (choices(values, 'registration_section_ids').length ||
          choices(values, 'registration_team_ids').length) &&
        registrationLimit(values) === null
      )
        throw new Error('Indiquez le nombre maximal d’inscrits pour une séance ouverte.');
      if (!event) {
        const gym = str(values, 'gymnasium_id') || null;
        if (!choices(values, 'section_ids').length)
          throw new Error('Sélectionnez au moins une section.');
        const when = schedule(values);
        const body = {
          title: str(values, 'title'),
          description: str(values, 'description'),
          kind: str(values, 'kind'),
          section_ids: choices(values, 'section_ids'),
          gymnasium_id: gym,
          location: str(values, 'location'),
          starts_at: when.starts_at,
          ends_at: when.ends_at,
          courts: gym ? num(values, 'courts') : 0,
          referent_id: str(values, 'referent_id'),
          direct_edit: checked(values, 'direct_edit'),
          registration_section_ids: choices(values, 'registration_section_ids'),
          registration_team_ids: choices(values, 'registration_team_ids'),
          registration_limit: registrationLimit(values),
        };
        if (when.recurrence) {
          const created = await api.request<Event[]>(
            '/series',
            'POST',
            { event: body, ...when.recurrence, force },
            signal,
          );
          onDone(
            `Série créée : ${created.length} occurrence${created.length > 1 ? 's' : ''}.`,
            created[0],
          );
        } else {
          const created = await api.request<Event>(
            `/events${force ? '?force=true' : ''}`,
            'POST',
            body,
            signal,
          );
          onDone('Événement créé.', created);
        }
        return;
      }
      const patch = changes(values, event);
      if (!Object.keys(patch).length) throw new Error('Aucune modification à enregistrer.');
      if (
        ffvb &&
        admin &&
        !acknowledge &&
        Object.keys(patch).some((key) => ['gymnasium_id', 'location', 'kickoff_at'].includes(key))
      )
        throw new Error(
          'Ces informations sont normalement mises à jour par la FFVB : cochez la confirmation pour les modifier localement.',
        );
      const body = {
        base_version: event.version,
        changes: patch,
        force,
        acknowledge_ffvb: acknowledge,
      };
      if (!direct) {
        await api.request(
          `/events/${event.id}/change-requests`,
          'POST',
          { ...body, force: false },
          signal,
        );
        onDone('Demande envoyée aux administrateurs pour validation.');
      } else if (scope === 'following' && event.series_id) {
        const updated = await api.request<Event[]>(
          `/series/${event.series_id}`,
          'PATCH',
          { ...body, from_event_id: event.id, include_exceptions: includeExceptions },
          signal,
        );
        onDone(
          `${updated.length} occurrence${updated.length > 1 ? 's' : ''} mise${updated.length > 1 ? 's' : ''} à jour.`,
          updated.find((item) => item.id === event.id),
        );
      } else {
        const updated = await api.request<Event>(`/events/${event.id}`, 'PATCH', body, signal);
        onDone('Événement mis à jour.', updated);
      }
    } catch (error) {
      const problem = capacityProblem(error);
      if (problem) setCapacity(problem);
      throw error;
    }
  }

  return (
    <EntityForm
      title={
        event ? (direct ? 'Modifier l’événement' : 'Proposer une modification') : 'Nouvel événement'
      }
      fields={fields}
      initial={initial}
      submit={event ? (direct ? 'Enregistrer' : 'Envoyer la demande') : 'Créer'}
      onCancel={onCancel}
      onSave={save}
    >
      {!direct && event && (
        <p className="admin-hint club-wide">
          Vos changements seront appliqués après validation par un administrateur.
        </p>
      )}
      {direct && event?.series_id && (
        <fieldset className="admin-choice-group club-wide">
          <legend>Portée de la modification</legend>
          <label>
            <input
              type="radio"
              name="scope"
              checked={scope === 'event'}
              onChange={() => setScope('event')}
            />
            Cette occurrence uniquement
          </label>
          <label>
            <input
              type="radio"
              name="scope"
              checked={scope === 'following'}
              onChange={() => setScope('following')}
            />
            Cette occurrence et les suivantes de la série
          </label>
          {scope === 'following' && (
            <label>
              <input
                type="checkbox"
                checked={includeExceptions}
                onChange={(change) => setIncludeExceptions(change.target.checked)}
              />
              Inclure les occurrences déjà modifiées individuellement
            </label>
          )}
        </fieldset>
      )}
      {ffvb && admin && (
        <label className="club-wide club-confirm">
          <input
            type="checkbox"
            checked={acknowledge}
            onChange={(change) => setAcknowledge(change.target.checked)}
          />
          Je comprends que date, heure et lieu sont normalement synchronisés depuis la FFVB ; une
          modification locale sera protégée et pourra ouvrir un conflit.
        </label>
      )}
      {capacity && (
        <div className="admin-notice club-wide" role="alert">
          <strong>Capacité dépassée</strong>
          <ul>
            {capacity.segments.map((segment) => (
              <li key={`${segment.starts_at}-${segment.ends_at}`}>
                {timeRange(segment.starts_at, segment.ends_at)} : {segment.occupied} terrains
                occupés, {segment.excess} en excès
              </li>
            ))}
          </ul>
          {admin && (
            <label className="club-confirm">
              <input
                type="checkbox"
                checked={force}
                onChange={(change) => setForce(change.target.checked)}
              />
              Forcer le dépassement (action historisée)
            </label>
          )}
        </div>
      )}
    </EntityForm>
  );
}
