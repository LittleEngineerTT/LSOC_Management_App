import { useAdmin } from './data';
import { dateLabel } from './time';
export const fieldLabels: Record<string, string> = {
  title: 'Titre',
  description: 'Description',
  until: 'Fin de la récurrence',
  weekdays: 'Chaque semaine le',
  kind: 'Type',
  section_ids: 'Sections',
  gymnasium_id: 'Gymnase',
  location: 'Lieu',
  starts_at: 'Début',
  ends_at: 'Fin',
  courts: 'Terrains',
  referent_ids: 'Référents',
  direct_edit: 'Modification directe',
  cancelled: 'Annulé',
  cancel_reason: 'Motif d’annulation',
  cancel_note: 'Précision du motif',
  kickoff_at: 'Coup d’envoi',
  before_minutes: 'Marge avant (min)',
  after_minutes: 'Marge après (min)',
  match_courts: 'Terrains du match',
  version: 'Version',
  series_id: 'Série',
  exception: 'Exception',
  ffvb_disabled: 'Synchronisation désactivée',
  ffvb_suspended_until: 'Suspension jusqu’au',
  occupancy_unknown: 'Occupation inconnue',
  registration_section_ids: 'Ouvert aux sections',
  registration_team_ids: 'Ouvert aux équipes',
  registration_limit: 'Limite d’inscrits',
  registration_quotas: 'Places réservées',
};
export function Changes({ values }: { values: Record<string, unknown> }) {
  const { catalog } = useAdmin();
  function label(key: string, value: unknown): string {
    if (value === null || value === '') return 'Aucun';
    if (typeof value === 'boolean') return value ? 'Oui' : 'Non';
    if ((key === 'section_ids' || key === 'registration_section_ids') && Array.isArray(value))
      return value
        .map((id) => catalog.sections.find((section) => section.id === id)?.name ?? String(id))
        .join(', ');
    if (key === 'weekdays' && Array.isArray(value))
      return value
        .map(
          (day) =>
            ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'][Number(day)],
        )
        .join(', ');
    if (key === 'until' && typeof value === 'string')
      return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long', timeZone: 'UTC' }).format(
        new Date(`${value}T12:00:00Z`),
      );
    if (key === 'match_courts' && value === 0) return 'Tout le gymnase';
    if (key === 'gymnasium_id')
      return catalog.gymnasiums.find((gym) => gym.id === value)?.name ?? String(value);
    if (key === 'registration_quotas' && Array.isArray(value))
      return (
        (value as { section_id: string; position_ids: string[]; limit: number }[])
          .map((quota) => {
            const positions = quota.position_ids
              .map(
                (id) => catalog.positions.find((item) => item.id === id)?.name ?? 'poste supprimé',
              )
              .join(' ou ');
            const section =
              catalog.sections.find((item) => item.id === quota.section_id)?.name ??
              'section supprimée';
            return `${quota.limit} ${positions} (${section})`;
          })
          .join(' ; ') || 'Aucune'
      );
    if (key === 'registration_team_ids' && Array.isArray(value))
      return value
        .map((id) => catalog.teams.find((team) => team.id === id)?.name ?? 'Équipe supprimée')
        .join(', ');
    if (key === 'referent_ids' && Array.isArray(value))
      return (
        value
          .map(
            (id) => catalog.users.find((user) => user.id === id)?.first_name ?? 'Compte supprimé',
          )
          .join(', ') || 'Aucun'
      );
    if (
      ['starts_at', 'ends_at', 'kickoff_at', 'ffvb_suspended_until'].includes(key) &&
      typeof value === 'string'
    )
      return dateLabel(value);
    if (key === 'kind')
      return (
        ({ training: 'Entraînement', match: 'Match', other: 'Autre' } as Record<string, string>)[
          String(value)
        ] ?? String(value)
      );
    return typeof value === 'object' ? JSON.stringify(value) : String(value);
  }
  return (
    <dl className="admin-changes">
      {Object.entries(values).map(([key, value]) => (
        <div key={key}>
          <dt>{fieldLabels[key] ?? key}</dt>
          <dd>{label(key, value)}</dd>
        </div>
      ))}
    </dl>
  );
}
