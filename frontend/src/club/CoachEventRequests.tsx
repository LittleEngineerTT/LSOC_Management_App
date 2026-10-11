import { useCallback, useId } from 'react';
import { Link } from 'react-router-dom';
import { useLoad } from '../admin/data';
import { dateLabel } from '../admin/time';
import type { EventRequest } from '../admin/types';
import { Badge, Empty, LoadState } from '../admin/ui';
import { useClub } from './context';
import { useEventLink } from './events';

const statuses: Record<string, { label: string; tone: string }> = {
  pending: { label: 'En attente', tone: 'warning' },
  accepted: { label: 'Acceptée', tone: 'good' },
  rejected: { label: 'Refusée', tone: 'danger' },
  withdrawn: { label: 'Retirée', tone: '' },
};

export function CoachEventRequests({ revision = 0 }: { revision?: number }) {
  const { api, account, teams } = useClub();
  const link = useEventLink();
  const headingId = useId();
  const loader = useCallback(
    (signal: AbortSignal) => {
      void revision;
      return api.list<EventRequest>('/event-requests?status=', true, signal);
    },
    [api, revision],
  );
  const result = useLoad(loader);
  const mine = (result.data ?? [])
    .filter((item) => item.actor_id === account.id)
    .slice()
    .reverse();
  if (result.loaded && !result.error && !mine.length && !account.roles.includes('coach'))
    return null;
  return (
    <section className="admin-card" aria-labelledby={headingId}>
      <h3 id={headingId}>Mes demandes d’événements</h3>
      <p className="admin-hint">
        Les demandes en attente ne réservent aucun créneau dans le planning.
      </p>
      <button className="admin-button" onClick={result.reload}>
        Actualiser mes demandes
      </button>
      <LoadState result={result} />
      {result.loaded && !mine.length && !result.error && <Empty>Aucune demande d’événement.</Empty>}
      <ul className="club-plain-list">
        {mine.map((item) => (
          <li key={item.id}>
            <strong>{item.proposal.title}</strong> ·{' '}
            {(item.proposal.team_ids ?? [item.team_id])
              .map((id) => teams.find((team) => team.id === id)?.name ?? 'Équipe supprimée')
              .join(', ')}{' '}
            ·{' '}
            <Badge tone={statuses[item.status]?.tone}>
              {statuses[item.status]?.label ?? item.status}
            </Badge>
            <p>
              Demande du {dateLabel(item.created_at)}
              {item.decided_at && ` · décision le ${dateLabel(item.decided_at)}`}
              {item.decision && ` · motif : ${item.decision}`}
              {item.decider_name && ` · ${item.decider_name}`}
            </p>
            {item.note && <p>{item.note}</p>}
            {item.event_id && <Link to={link(item.event_id)}>Voir l’événement</Link>}
          </li>
        ))}
      </ul>
    </section>
  );
}
