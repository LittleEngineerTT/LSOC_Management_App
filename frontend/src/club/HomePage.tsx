import { useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useLoad } from '../admin/data';
import { Empty, LoadState } from '../admin/ui';
import { dayLabel, parisDay, eventHours } from './calendar';
import { useClub } from './context';
import { DetailHost } from './EventDetail';
import { eventStatus, StatusBadge, useEventLink } from './events';
import { useMyEvents } from './myEvents';
import { ReleaseNotes } from './ReleaseNotes';
import { RecentResults } from './RecentResults';

export function HomePage() {
  const { account, admin } = useClub();
  const { result, events } = useMyEvents();
  const link = useEventLink();
  // Une séance seulement ouverte n’est pas un rendez-vous tant qu’on n’y est pas inscrit.
  const next = events
    .filter((item) => item.reasons.some((reason) => reason !== 'open'))
    .slice(0, 6)
    .map((item) => item.event);
  return (
    <>
      <div className="club-welcome">
        <h2>Bonjour {account.first_name}</h2>
        <p>Voici ce qui vous attend au club.</p>
      </div>
      {admin && <AdminSummary />}
      {/* À la une : nouveautés de la version et derniers résultats, côte à côte. */}
      <div className="club-highlights">
        <ReleaseNotes />
        <RecentResults />
      </div>
      <div className="club-home">
        <section className="admin-card">
          <h3>Prochains rendez-vous</h3>
          <LoadState result={result} />
          {result.loaded && !next.length && (
            <Empty>
              Rien de prévu pour vous. <Link to="/app/planning">Consulter le planning du club</Link>
            </Empty>
          )}
          <ul className="club-plain-list">
            {next.map((event) => (
              <li
                key={event.id}
                className={eventStatus(event) ? `club-${eventStatus(event)}` : undefined}
              >
                <Link to={link(event.id)}>{event.title}</Link> <StatusBadge event={event} />
                <span className="admin-hint">
                  {' '}
                  {dayLabel(parisDay(event.starts_at))}, {eventHours(event)}
                </span>
              </li>
            ))}
          </ul>
          <Link className="admin-button" to="/app/planning?mon=1">
            Tout mon planning
          </Link>
        </section>
      </div>
      <DetailHost onChanged={result.reload} />
    </>
  );
}

function AdminSummary() {
  const { api } = useClub();
  const loader = useCallback(
    async (signal: AbortSignal) => {
      const [requests, conflicts] = await Promise.all([
        api.list<unknown>('/change-requests', true, signal),
        api.list<unknown>('/event-conflicts', false, signal),
      ]);
      return { requests: requests.length, conflicts: conflicts.length };
    },
    [api],
  );
  const result = useLoad(loader);
  if (!result.data) return <LoadState result={result} />;
  return (
    <div className="admin-overview club-summary">
      <Link to="/app/administration?tab=requests">
        <strong>{result.data.requests}</strong> demande{result.data.requests > 1 ? 's' : ''} à
        valider
      </Link>
      <Link to="/app/administration?tab=conflicts">
        <strong>{result.data.conflicts}</strong> conflit{result.data.conflicts > 1 ? 's' : ''} à
        traiter
      </Link>
    </div>
  );
}
