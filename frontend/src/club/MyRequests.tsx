import { useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useLoad } from '../admin/data';
import { dateLabel } from '../admin/time';
import type { ChangeRequest } from '../admin/types';
import { Badge, Empty, LoadState } from '../admin/ui';
import { useClub } from './context';

const statuses: Record<string, { label: string; tone: string }> = {
  pending: { label: 'En attente', tone: 'warning' },
  accepted: { label: 'Acceptée', tone: 'good' },
  rejected: { label: 'Refusée', tone: 'danger' },
};
/** Demandes de modification du compte et leur décision ; rien sans demande. */
export function MyRequests() {
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
