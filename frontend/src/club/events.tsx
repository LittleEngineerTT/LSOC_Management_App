import { Link, useLocation, useSearchParams } from 'react-router-dom';
import type { Event } from '../admin/types';
import { Badge, Empty } from '../admin/ui';
import { dayLabel, parisDay, timeRange } from './calendar';
import { isFollowed, useClub } from './context';

export const kindLabels: Record<Event['kind'], string> = {
  training: 'Entraînement',
  match: 'Match',
  other: 'Autre activité',
};

export function EventOrigin({ event }: { event: Pick<Event, 'ffvb_match_id'> }) {
  return (
    <span className={`event-origin origin-${event.ffvb_match_id ? 'ffvb' : 'local'}`}>
      {event.ffvb_match_id ? 'FFVB' : 'Local'}
    </span>
  );
}

export function usePlace() {
  const { gymnasiums } = useClub();
  return (event: Pick<Event, 'gymnasium_id' | 'location'>) =>
    event.gymnasium_id
      ? (gymnasiums.find((gym) => gym.id === event.gymnasium_id)?.name ?? 'Gymnase supprimé')
      : event.location || 'Lieu à préciser';
}
export function useSectionNames() {
  const { sections } = useClub();
  return (ids: string[]) =>
    ids.map((id) => sections.find((section) => section.id === id)?.name ?? 'Section supprimée');
}
export function useTeamNames() {
  const { teams } = useClub();
  return (ids: string[]) =>
    ids.map((id) => teams.find((team) => team.id === id)?.name ?? 'Équipe supprimée');
}
export function registrationOpen(
  event: Pick<Event, 'registration_section_ids' | 'registration_team_ids'>,
) {
  return (
    event.registration_section_ids.length > 0 || (event.registration_team_ids?.length ?? 0) > 0
  );
}

/** Lien vers le détail d’un événement, ouvert dans la page courante. */
export function useEventLink() {
  const location = useLocation();
  const [search] = useSearchParams();
  return (id: string) => {
    const next = new URLSearchParams(search);
    next.set('event', id);
    return `${location.pathname}?${next.toString()}`;
  };
}

function atLimit(event: Event) {
  return event.registration_limit !== null && event.registration_count >= event.registration_limit;
}

export function EventRow({ event }: { event: Event }) {
  const { follows, account, guest } = useClub();
  const place = usePlace();
  const sectionNames = useSectionNames();
  const link = useEventLink();
  return (
    <li
      className={`club-event kind-${event.kind} origin-${event.ffvb_match_id ? 'ffvb' : 'local'}${event.cancelled ? ' cancelled' : ''}`}
    >
      <Link to={link(event.id)} className="club-event-link">
        <span className="club-event-time">{timeRange(event.starts_at, event.ends_at)}</span>
        <span className="club-event-copy">
          <strong>{event.title}</strong>
          <span>
            {kindLabels[event.kind]} · {place(event)}
            {event.courts > 0 && ` · ${event.courts} terrain${event.courts > 1 ? 's' : ''}`}
          </span>
          <span className="club-event-sections">{sectionNames(event.section_ids).join(', ')}</span>
        </span>
        <span className="club-event-badges">
          {event.cancelled && <Badge tone="danger">Annulé</Badge>}
          <EventOrigin event={event} />
          {!guest && event.occupancy_unknown && <Badge tone="warning">Lieu non associé</Badge>}
          {!guest && event.referent_ids.includes(account.id) && <Badge tone="good">Référent</Badge>}
          {!guest && !event.referent_ids.length && <Badge tone="warning">Sans référent</Badge>}
          {isFollowed(follows, event) && <Badge>Suivi</Badge>}
          {registrationOpen(event) && (
            <Badge tone={atLimit(event) ? 'warning' : 'good'}>
              {atLimit(event) ? 'Complet' : 'Ouvert'} · {event.registration_count}/
              {event.registration_limit}
            </Badge>
          )}
        </span>
      </Link>
    </li>
  );
}

export function Agenda({
  events,
  days,
  empty,
}: {
  events: Event[];
  /** Jours à afficher même vides, sinon seuls les jours occupés. */
  days?: string[];
  empty: string;
}) {
  const groups = new Map<string, Event[]>();
  for (const day of days ?? []) groups.set(day, []);
  for (const event of events) {
    const day = parisDay(event.starts_at);
    groups.set(day, [...(groups.get(day) ?? []), event]);
  }
  if (!events.length && !days) return <Empty>{empty}</Empty>;
  const current = parisDay(new Date());
  return (
    <div className="club-agenda">
      {[...groups.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([day, items]) => (
          <section key={day} className={`club-day${day === current ? ' today' : ''}`}>
            <h3>
              {dayLabel(day)}
              {day === current && <Badge tone="good">Aujourd’hui</Badge>}
            </h3>
            {items.length ? (
              <ul className="club-events">
                {items.map((event) => (
                  <EventRow key={event.id} event={event} />
                ))}
              </ul>
            ) : (
              <p className="club-day-empty">Aucun événement.</p>
            )}
          </section>
        ))}
      {!events.length && <Empty>{empty}</Empty>}
    </div>
  );
}
