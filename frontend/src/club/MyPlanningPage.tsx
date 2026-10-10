import { useCallback } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useLoad } from '../admin/data';
import { dateLabel } from '../admin/time';
import type { ChangeRequest, Event } from '../admin/types';
import { Badge, Empty, LoadState, PanelHeading } from '../admin/ui';
import { rangeQuery, today } from './calendar';
import { isFollowed, useClub, useMySections } from './context';
import { DetailHost } from './EventDetail';
import { Agenda } from './events';

export type Reason = 'followed' | 'referent' | 'section';
export const UPCOMING_DAYS = 56;

/** Événements des huit prochaines semaines qui concernent le compte connecté. */
export function useMyEvents() {
  const { api, account, follows } = useClub();
  const mySections = useMySections();
  const loader = useCallback(
    (signal: AbortSignal) =>
      api.list<Event>(`/events?${rangeQuery(today(), UPCOMING_DAYS)}`, true, signal),
    [api],
  );
  const result = useLoad(loader);
  const sectionIds = new Set(mySections.map((section) => section.id));
  const events = (result.data ?? [])
    .map((event) => {
      const reasons: Reason[] = [];
      if (isFollowed(follows, event)) reasons.push('followed');
      if (event.referent_id === account.id) reasons.push('referent');
      if (event.section_ids.some((id) => sectionIds.has(id))) reasons.push('section');
      return { event, reasons };
    })
    .filter((item) => item.reasons.length > 0);
  return { result, events };
}

const filters: { id: '' | Reason; label: string }[] = [
  { id: '', label: 'Tout' },
  { id: 'followed', label: 'Suivis' },
  { id: 'referent', label: 'Dont je suis référent' },
  { id: 'section', label: 'Mes sections' },
];

export function MyPlanningPage() {
  const [search, setSearch] = useSearchParams();
  const { result, events } = useMyEvents();
  const active = filters.find((item) => item.id === search.get('filtre'))?.id ?? '';
  const visible = events
    .filter((item) => !active || item.reasons.includes(active))
    .map((item) => item.event);
  return (
    <>
      <PanelHeading
        title="Mon planning"
        description="Les huit prochaines semaines : événements suivis, dont vous êtes référent ou concernant vos sections."
      />
      <div className="admin-subtabs" role="group" aria-label="Filtrer mon planning">
        {filters.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`admin-button${item.id === active ? ' selected' : ''}`}
            aria-pressed={item.id === active}
            onClick={() =>
              setSearch((previous) => {
                const next = new URLSearchParams(previous);
                if (item.id) next.set('filtre', item.id);
                else next.delete('filtre');
                return next;
              })
            }
          >
            {item.label} (
            {item.id
              ? events.filter((entry) => entry.reasons.includes(item.id as Reason)).length
              : events.length}
            )
          </button>
        ))}
      </div>
      <LoadState result={result} />
      {result.data && (
        <Agenda
          events={visible}
          empty="Rien de prévu. Suivez des événements depuis le planning du club pour les retrouver ici."
        />
      )}
      <MyRequests />
      <DetailHost onChanged={result.reload} />
    </>
  );
}

const statuses: Record<string, { label: string; tone: string }> = {
  pending: { label: 'En attente', tone: 'warning' },
  accepted: { label: 'Acceptée', tone: 'good' },
  rejected: { label: 'Refusée', tone: 'danger' },
};
function MyRequests() {
  const { api, account } = useClub();
  const loader = useCallback(
    (signal: AbortSignal) =>
      api.list<ChangeRequest & { actor_id: string | null }>(
        '/change-requests?status=',
        true,
        signal,
      ),
    [api],
  );
  const result = useLoad(loader);
  const mine = (result.data ?? []).filter((item) => item.actor_id === account.id).reverse();
  if (result.loaded && !result.error && !mine.length) return null;
  return (
    <section className="admin-card">
      <h3>Mes demandes de modification</h3>
      <LoadState result={result} />
      {result.loaded && !mine.length && !result.error && <Empty>Aucune demande.</Empty>}
      <ul className="club-plain-list">
        {mine.map((item) => (
          <li key={item.id}>
            <Badge tone={statuses[item.status]?.tone}>
              {statuses[item.status]?.label ?? item.status}
            </Badge>{' '}
            Demande du {dateLabel(item.created_at)}
            {item.decided_at && ` · décision le ${dateLabel(item.decided_at)}`}
            {item.decision && ` · motif : ${item.decision}`} ·{' '}
            <Link to={`?event=${item.event_id}`}>Voir l’événement</Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
