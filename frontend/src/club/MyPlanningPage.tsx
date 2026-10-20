import { useCallback } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useLoad } from '../admin/data';
import { dateLabel } from '../admin/time';
import type { ChangeRequest, Event, Registration } from '../admin/types';
import { Badge, Empty, LoadState, PanelHeading } from '../admin/ui';
import { daysBetween, horizonEnd, horizonLabel, rangeQuery, today } from './calendar';
import { isFollowed, useClub, useMySections } from './context';
import { DetailHost } from './EventDetail';
import { CalendarLegend, CalendarView } from './CalendarView';
import { CalendarNavigation, useCalendarPeriod } from './CalendarNavigation';

export type Reason = 'registered' | 'open' | 'followed' | 'referent' | 'section';
/** Événements jusqu’au 31 août de l’année suivante qui concernent le compte connecté. */
export function useMyEvents() {
  const { api, account, follows, assignments } = useClub();
  const mySections = useMySections();
  const loader = useCallback(
    (signal: AbortSignal) => {
      const first = today();
      return Promise.all([
        api.list<Event>(
          // Un événement annulé reste affiché, en rouge, pour que chacun le sache.
          `/events?${rangeQuery(first, daysBetween(first, horizonEnd(first)))}&include_cancelled=true`,
          true,
          signal,
        ),
        api.list<Registration>('/registrations', true, signal),
      ]);
    },
    [api],
  );
  const result = useLoad(loader);
  const sectionIds = new Set(mySections.map((section) => section.id));
  const teamIds = new Set(assignments.map((assignment) => assignment.team_id));
  const [list, registrations] = result.data ?? [[], []];
  // Une demande en attente ou refusée ne vaut pas inscription.
  const registered = new Set(
    registrations.filter((item) => item.status === 'accepted').map((item) => item.event_id),
  );
  const events = list
    .map((event) => {
      const reasons: Reason[] = [];
      if (registered.has(event.id)) reasons.push('registered');
      else if (
        event.registration_section_ids.some((id) => sectionIds.has(id)) ||
        event.registration_team_ids?.some((id) => teamIds.has(id))
      )
        reasons.push('open');
      if (isFollowed(follows, event)) reasons.push('followed');
      if (event.referent_ids.includes(account.id)) reasons.push('referent');
      if (event.section_ids.some((id) => sectionIds.has(id))) reasons.push('section');
      return { event, reasons };
    })
    .filter((item) => item.reasons.length > 0);
  return { result, events };
}

const filters: { id: '' | Reason; label: string }[] = [
  { id: '', label: 'Tout' },
  { id: 'registered', label: 'Inscrit' },
  { id: 'open', label: 'Ouvertes à mes sections ou équipes' },
  { id: 'followed', label: 'Suivis' },
  { id: 'referent', label: 'Dont je suis référent' },
  { id: 'section', label: 'Mes sections' },
];

export function MyPlanningPage() {
  const [search, setSearch] = useSearchParams();
  const { result, events } = useMyEvents();
  const { mode, anchor, days } = useCalendarPeriod('month');
  const origin = search.get('origine') ?? '';
  const active = filters.find((item) => item.id === search.get('filtre'))?.id ?? '';
  const visible = events
    .filter(
      (item) =>
        (!active || item.reasons.includes(active)) &&
        (origin === 'ffvb'
          ? !!item.event.ffvb_match_id
          : origin === 'local'
            ? !item.event.ffvb_match_id
            : true),
    )
    .map((item) => item.event);
  return (
    <>
      <PanelHeading
        title="Mon planning"
        description={`Jusqu’au ${horizonLabel()} : séances où vous êtes inscrit ou ouvertes à vos sections ou équipes, événements suivis, dont vous êtes référent ou concernant vos sections.`}
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
      <div className="admin-toolbar">
        <label>
          Origine des événements
          <select
            value={origin}
            onChange={(change) =>
              setSearch((previous) => {
                const next = new URLSearchParams(previous);
                if (change.target.value) next.set('origine', change.target.value);
                else next.delete('origine');
                return next;
              })
            }
          >
            <option value="">Toutes les origines</option>
            <option value="ffvb">FFVB</option>
            <option value="local">Locale</option>
          </select>
        </label>
        <p className="admin-hint">
          {visible.length} événement(s) sur l’ensemble de votre horizon. Changez de mois ou de
          semaine pour les parcourir.
        </p>
      </div>
      <CalendarLegend />
      <CalendarNavigation mode={mode} anchor={anchor} />
      <LoadState result={result} />
      {result.data && (
        <CalendarView
          events={visible}
          days={days}
          mode={mode}
          anchor={anchor}
          empty="Rien de prévu sur cette période. Changez de mois ou suivez des événements du club."
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
