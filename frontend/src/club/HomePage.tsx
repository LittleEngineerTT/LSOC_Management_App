import { useCallback, useState } from 'react';
import { Link } from 'react-router-dom';
import { ErrorNotice } from '../auth/components';
import { useRequest } from '../auth/useRequest';
import { useLoad } from '../admin/data';
import { dateLabel } from '../admin/time';
import { Empty, LoadState } from '../admin/ui';
import { dayLabel, parisDay, timeRange } from './calendar';
import { useClub, type Notification } from './context';
import { DetailHost } from './EventDetail';
import { useEventLink } from './events';
import { useMyEvents } from './MyPlanningPage';

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
              <li key={event.id}>
                <Link to={link(event.id)}>{event.title}</Link>
                <span className="admin-hint">
                  {' '}
                  {dayLabel(parisDay(event.starts_at))}, {timeRange(event.starts_at, event.ends_at)}
                </span>
              </li>
            ))}
          </ul>
          <Link className="admin-button" to="/app/mon-planning">
            Tout mon planning
          </Link>
        </section>
        <Notifications />
      </div>
      <DetailHost onChanged={result.reload} />
    </>
  );
}

function Notifications() {
  const { api } = useClub();
  const loader = useCallback(
    (signal: AbortSignal) =>
      api.request<Notification[]>('/notifications?limit=30', 'GET', undefined, signal),
    [api],
  );
  const result = useLoad(loader);
  const request = useRequest();
  const [read, setRead] = useState<Set<string>>(new Set());
  const link = useEventLink();
  const items = (result.data ?? []).map((item) =>
    read.has(item.id) ? { ...item, read_at: item.read_at ?? 'now' } : item,
  );
  const unread = items.filter((item) => !item.read_at);
  return (
    <section className="admin-card">
      <h3>
        Notifications {unread.length > 0 && <span className="club-count">{unread.length}</span>}
      </h3>
      <LoadState result={result} />
      {result.loaded && !items.length && <Empty>Aucune notification.</Empty>}
      <ErrorNotice message={request.error} />
      <ul className="club-plain-list club-notifications">
        {items.map((item) => (
          <li key={item.id} className={item.read_at ? '' : 'unread'}>
            <span>
              {item.event_id ? <Link to={link(item.event_id)}>{item.title}</Link> : item.title}
              <span className="admin-hint"> · {dateLabel(item.created_at)}</span>
            </span>
            {!item.read_at && (
              <button
                type="button"
                className="admin-button"
                disabled={request.pending}
                onClick={() =>
                  void request.run(async (signal) => {
                    await api.request(`/notifications/${item.id}/read`, 'POST', {}, signal);
                    setRead((previous) => new Set(previous).add(item.id));
                  })
                }
              >
                Marquer comme lue
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function AdminSummary() {
  const { api } = useClub();
  const loader = useCallback(
    async (signal: AbortSignal) => {
      const [requests, conflicts] = await Promise.all([
        api.list<unknown>('/change-requests', true, signal),
        api.list<unknown>('/ffvb/conflicts', false, signal),
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
      <Link to="/app/administration?tab=ffvb">
        <strong>{result.data.conflicts}</strong> conflit{result.data.conflicts > 1 ? 's' : ''} FFVB
        ouvert{result.data.conflicts > 1 ? 's' : ''}
      </Link>
    </div>
  );
}
