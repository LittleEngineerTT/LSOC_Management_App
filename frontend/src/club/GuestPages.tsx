import { useCallback, useEffect, useId, useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useLoad } from '../admin/data';
import type { Event } from '../admin/types';
import { Empty, LoadState, PanelHeading } from '../admin/ui';
import { useDialogBackdropDismiss } from '../app/useDialogBackdropDismiss';
import { dayLabel, dayStart, horizonEnd, parisDay, rangeQuery, timeRange, today } from './calendar';
import { CalendarNavigation, useCalendarPeriod } from './CalendarNavigation';
import { CalendarLegend, CalendarView } from './CalendarView';
import { ReleaseNotes } from './ReleaseNotes';
import { RecentResults } from './RecentResults';
import { useClub } from './context';
import {
  EventOrigin,
  kindLabels,
  useEventLink,
  usePlace,
  useSectionNames,
  useTeamNames,
} from './events';

/** Match FFVB tel que l’API publique le décrit : sans référent, inscriptions ni description. */
type PublicEvent = Pick<
  Event,
  | 'id'
  | 'title'
  | 'kind'
  | 'section_ids'
  | 'gymnasium_id'
  | 'location'
  | 'starts_at'
  | 'ends_at'
  | 'cancelled'
  | 'ffvb_match_id'
  | 'kickoff_at'
  | 'team_ids'
>;

/** Complète un match public pour les composants du planning, sans rien d’interne. */
function asEvent(event: PublicEvent): Event {
  return {
    ...event,
    courts: 0,
    referent_ids: [],
    direct_edit: false,
    version: 0,
    series_id: null,
    exception: false,
    before_minutes: 0,
    after_minutes: 0,
    match_courts: 0,
    occupancy_unknown: false,
    registration_section_ids: [],
    registration_team_ids: [],
    registration_limit: null,
    registration_count: 0,
  };
}

function SignInInvite() {
  return (
    <section className="admin-card guest-invite">
      <h3>Vous êtes adhérent ?</h3>
      <p>
        Connectez-vous pour voir tout le planning du club (entraînements, activités), vos
        rendez-vous, vos notifications et la messagerie.
      </p>
      <Link className="admin-button primary" to="/login">
        Se connecter
      </Link>
    </section>
  );
}

export function GuestHome() {
  const { api } = useClub();
  const link = useEventLink();
  const loader = useCallback(
    (signal: AbortSignal) => {
      const first = today();
      const starts_at = dayStart(first);
      const ends_at = dayStart(horizonEnd(first));
      const query = `starts_at=${encodeURIComponent(starts_at)}&ends_at=${encodeURIComponent(ends_at)}&limit=6`;
      return api.request<PublicEvent[]>(`/public/events?${query}`, 'GET', undefined, signal);
    },
    [api],
  );
  const result = useLoad(loader);
  const next = (result.data ?? []).filter((event) => event.ends_at > new Date().toISOString());
  return (
    <>
      <div className="club-welcome">
        <h2>Bienvenue au LSO Colombes Volley</h2>
        <p>Vous visitez l’espace club en tant qu’invité.</p>
      </div>
      <div className="club-highlights">
        <ReleaseNotes />
        <section className="admin-card">
          <h3>Prochains matchs FFVB</h3>
          <LoadState result={result} />
          {result.loaded && !next.length && <Empty>Aucun match FFVB programmé.</Empty>}
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
          <Link className="admin-button" to="/app/planning">
            Voir le planning des matchs
          </Link>
        </section>
      </div>
      <div className="club-home">
        <RecentResults />
        <SignInInvite />
      </div>
      <GuestDetailHost />
    </>
  );
}

export function GuestPlanning() {
  const { api, sections, teams, gymnasiums } = useClub();
  const [search, setSearch] = useSearchParams();
  const section = sections.some((item) => item.id === search.get('section'))
    ? (search.get('section') ?? '')
    : '';
  // Les équipes proposées suivent la section choisie ; une équipe inconnue est ignorée.
  const teamChoices = teams.filter((item) => !section || item.section_id === section);
  const team = teamChoices.some((item) => item.id === search.get('equipe'))
    ? (search.get('equipe') ?? '')
    : '';
  const gym = gymnasiums.some((item) => item.id === search.get('gymnase'))
    ? (search.get('gymnase') ?? '')
    : '';
  function filter(name: string, value: string) {
    setSearch((previous) => {
      const next = new URLSearchParams(previous);
      if (value) next.set(name, value);
      else next.delete(name);
      return next;
    });
  }
  const { mode, anchor, days } = useCalendarPeriod();
  const firstDay = days[0]!;
  const loader = useCallback(
    (signal: AbortSignal) =>
      api
        .list<PublicEvent>(`/public/events?${rangeQuery(firstDay, days.length)}`, true, signal)
        .then((events) => events.map(asEvent)),
    [api, firstDay, days.length],
  );
  const result = useLoad(loader);
  return (
    <>
      <PanelHeading
        title="Matchs FFVB du club"
        description="Les matchs officiels des équipes du club. Les entraînements et autres activités sont réservés aux adhérents connectés."
      >
        <Link className="admin-button primary" to="/login">
          Se connecter
        </Link>
      </PanelHeading>
      <div className="admin-toolbar">
        <label>
          Section
          <select
            value={section}
            onChange={(change) => {
              filter('section', change.target.value);
              filter('equipe', '');
            }}
          >
            <option value="">Toutes les sections</option>
            {sections.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Équipe
          <select value={team} onChange={(change) => filter('equipe', change.target.value)}>
            <option value="">Toutes les équipes</option>
            {teamChoices.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Gymnase
          <select value={gym} onChange={(change) => filter('gymnase', change.target.value)}>
            <option value="">Tous les lieux</option>
            {gymnasiums.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <CalendarLegend />
      <CalendarNavigation mode={mode} anchor={anchor} />
      <LoadState result={result} />
      {result.data && (
        <CalendarView
          events={result.data.filter(
            (event) =>
              (!gym || event.gymnasium_id === gym) &&
              (!section || event.section_ids.includes(section)) &&
              (!team || (event.team_ids ?? []).includes(team)),
          )}
          days={days}
          mode={mode}
          anchor={anchor}
          empty="Aucun match FFVB sur cette période."
        />
      )}
      <GuestDetailHost />
    </>
  );
}

/** Détail en lecture seule d’un match, ouvert par le paramètre « event » de l’URL. */
function GuestDetailHost() {
  const [search, setSearch] = useSearchParams();
  const id = search.get('event');
  if (!id) return null;
  return (
    <GuestEventDetail
      key={id}
      id={id}
      onClose={() =>
        setSearch((previous) => {
          const next = new URLSearchParams(previous);
          next.delete('event');
          return next;
        })
      }
    />
  );
}

function GuestEventDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const { api } = useClub();
  const dialog = useRef<HTMLDialogElement>(null);
  const backdropDismiss = useDialogBackdropDismiss(onClose);
  const titleId = useId();
  const place = usePlace();
  const sectionNames = useSectionNames();
  const teamNames = useTeamNames();
  const loader = useCallback(
    (signal: AbortSignal) =>
      api.request<PublicEvent>(
        `/public/events/${encodeURIComponent(id)}`,
        'GET',
        undefined,
        signal,
      ),
    [api, id],
  );
  const result = useLoad(loader);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  const event = result.data;
  return (
    <dialog
      {...backdropDismiss}
      ref={dialog}
      className="admin-dialog club-detail"
      aria-labelledby={titleId}
      onCancel={(change) => {
        change.preventDefault();
        onClose();
      }}
    >
      <div className="club-detail-head">
        <h2 id={titleId}>{event?.title ?? 'Match'}</h2>
        <button type="button" className="admin-button" onClick={onClose}>
          Fermer
        </button>
      </div>
      <LoadState result={result} />
      {event && (
        <dl className="admin-changes">
          <dt>Type</dt>
          <dd>
            {kindLabels[event.kind]} <EventOrigin event={event} />
            {event.cancelled && ' · annulé'}
          </dd>
          <dt>Date</dt>
          <dd>
            {dayLabel(parisDay(event.starts_at))}, {timeRange(event.starts_at, event.ends_at)}
          </dd>
          {event.kickoff_at && (
            <>
              <dt>Coup d’envoi</dt>
              <dd>{timeRange(event.kickoff_at, event.kickoff_at).split(' – ')[0]}</dd>
            </>
          )}
          <dt>Lieu</dt>
          <dd>{place(event)}</dd>
          {event.section_ids.length > 0 && (
            <>
              <dt>Sections</dt>
              <dd>{sectionNames(event.section_ids).join(', ')}</dd>
            </>
          )}
          {(event.team_ids?.length ?? 0) > 0 && (
            <>
              <dt>Équipes organisatrices</dt>
              <dd>{teamNames(event.team_ids!).join(', ')}</dd>
            </>
          )}
        </dl>
      )}
    </dialog>
  );
}
