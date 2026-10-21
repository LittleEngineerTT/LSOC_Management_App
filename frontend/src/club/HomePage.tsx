import { useCallback, useState } from 'react';
import { Link } from 'react-router-dom';
import { ErrorNotice } from '../auth/components';
import { useRequest } from '../auth/useRequest';
import { useLoad } from '../admin/data';
import { dateLabel } from '../admin/time';
import { Badge, Empty, LoadState } from '../admin/ui';
import { dayLabel, parisDay, timeRange } from './calendar';
import { useClub, type Notification } from './context';
import { DetailHost } from './EventDetail';
import { useEventLink } from './events';
import { useMyEvents } from './MyPlanningPage';
import { useUnread } from '../app/unread';
import { ClubInfos } from './ClubInfos';
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
      {/* À la une : informations du club et derniers résultats, côte à côte. */}
      <div className="club-highlights">
        <ClubInfos />
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
              <li key={event.id} className={event.cancelled ? 'club-cancelled' : undefined}>
                <Link to={link(event.id)}>{event.title}</Link>{' '}
                {event.cancelled && <Badge tone="danger">Annulé</Badge>}
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

/** Notifications non lues ; une notification marquée comme lue disparaît, avec sa pastille. */
function Notifications() {
  const { api } = useClub();
  const { notifications: total, refresh } = useUnread();
  const loader = useCallback(
    (signal: AbortSignal) =>
      api.request<Notification[]>(
        '/notifications?unread_only=true&limit=30',
        'GET',
        undefined,
        signal,
      ),
    [api],
  );
  const result = useLoad(loader);
  const request = useRequest();
  const [read, setRead] = useState<Set<string>>(new Set());
  const link = useEventLink();
  const items = (result.data ?? []).filter((item) => !item.read_at && !read.has(item.id));
  // Chaque notification mène à l’action attendue : lien explicite, sinon l’événement.
  const target = (item: Notification) => item.link ?? (item.event_id ? link(item.event_id) : null);
  const count = Math.max(total, items.length);
  function markRead(ids: string[]) {
    void request.run(async (signal) => {
      for (const id of ids) {
        await api.request(`/notifications/${id}/read`, 'POST', {}, signal);
        setRead((previous) => new Set(previous).add(id));
      }
      refresh();
    });
  }
  return (
    <section className="admin-card">
      <h3>Notifications {count > 0 && <span className="club-count">{count}</span>}</h3>
      <LoadState result={result} />
      {result.loaded && !items.length && <Empty>Aucune nouvelle notification.</Empty>}
      <ErrorNotice message={request.error} />
      {items.length > 1 && (
        <div className="admin-actions club-notifications-all">
          <button
            type="button"
            className="admin-button"
            disabled={request.pending}
            onClick={() => markRead(items.map((item) => item.id))}
          >
            Tout marquer comme lu
          </button>
        </div>
      )}
      <ul className="club-plain-list club-notifications">
        {items.map((item) => (
          <li key={item.id} className="unread">
            <span className="club-notification-copy">
              <span>
                {target(item) ? <Link to={target(item)!}>{item.title}</Link> : item.title}
                <span className="admin-hint"> · {dateLabel(item.created_at)}</span>
              </span>
              {item.body && <span className="club-notification-body">{item.body}</span>}
            </span>
            <span className="club-notification-actions">
              {actionLabel(item) && (
                <Link className="admin-button primary" to={target(item)!}>
                  {actionLabel(item)}
                </Link>
              )}
              <button
                type="button"
                className="admin-button"
                disabled={request.pending}
                onClick={() => markRead([item.id])}
              >
                Marquer comme lu
              </button>
            </span>
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

function actionLabel(item: Notification): string | null {
  if (item.link?.includes('tab=requests')) return 'Examiner la demande';
  if (item.link?.startsWith('/app/messagerie')) return 'Voir le message';
  return null;
}
