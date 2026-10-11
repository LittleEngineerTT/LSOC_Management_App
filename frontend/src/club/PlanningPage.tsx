import { useCallback, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useLoad } from '../admin/data';
import type { Event } from '../admin/types';
import { LoadState, Notice, PanelHeading } from '../admin/ui';
import { addDays, mondayOf, rangeQuery, today, validDay, weekLabel } from './calendar';
import { useClub } from './context';
import { DetailHost } from './EventDetail';
import { EventEditor } from './EventEditor';
import { CalendarView } from './CalendarView';
import { CalendarNavigation, useCalendarPeriod } from './CalendarNavigation';
import { CoachEventRequests } from './CoachEventRequests';
import { EventProposalForm, useCoachedTeams } from './EventProposalForm';

/** Navigation par semaine, partagée par le planning et les gymnases. */
export function WeekNavigation({ monday }: { monday: string }) {
  const [, setSearch] = useSearchParams();
  const go = (day: string) =>
    setSearch((previous) => {
      const next = new URLSearchParams(previous);
      next.set('semaine', day);
      next.delete('event');
      return next;
    });
  return (
    <div className="club-week">
      <button type="button" className="admin-button" onClick={() => go(addDays(monday, -7))}>
        <span aria-hidden="true">←</span> Semaine précédente
      </button>
      <strong aria-live="polite">{weekLabel(monday)}</strong>
      <button type="button" className="admin-button" onClick={() => go(mondayOf(today()))}>
        Cette semaine
      </button>
      <button type="button" className="admin-button" onClick={() => go(addDays(monday, 7))}>
        Semaine suivante <span aria-hidden="true">→</span>
      </button>
    </div>
  );
}
export function useWeek(): string {
  const [search] = useSearchParams();
  const value = search.get('semaine');
  return mondayOf(validDay(value) ? value : today());
}

export function PlanningPage() {
  const { api, admin, sections, gymnasiums } = useClub();
  const coached = useCoachedTeams();
  const [search, setSearch] = useSearchParams();
  const { mode, anchor, days } = useCalendarPeriod();
  const firstDay = days[0]!;
  const section = search.get('section') ?? '';
  const gym = search.get('gymnase') ?? '';
  const cancelled = search.get('annules') === '1';
  const origin = search.get('origine') ?? '';
  const [creating, setCreating] = useState(false);
  const [proposing, setProposing] = useState(false);
  const [requestRevision, setRequestRevision] = useState(0);
  const [notice, setNotice] = useState('');
  const loader = useCallback(
    (signal: AbortSignal) => {
      const filters = [
        rangeQuery(firstDay, days.length),
        section && `section_id=${encodeURIComponent(section)}`,
        gym && `gymnasium_id=${encodeURIComponent(gym)}`,
        cancelled && 'include_cancelled=true',
      ].filter(Boolean);
      return api.list<Event>(`/events?${filters.join('&')}`, true, signal);
    },
    [api, firstDay, days.length, section, gym, cancelled],
  );
  const result = useLoad(loader);
  function filter(name: string, value: string) {
    setSearch((previous) => {
      const next = new URLSearchParams(previous);
      if (value) next.set(name, value);
      else next.delete(name);
      return next;
    });
  }
  return (
    <>
      <PanelHeading
        title="Planning du club"
        description="Entraînements, matchs et activités des sections en calendrier. Les horaires sont ceux de Paris."
      >
        {admin && (
          <button
            className="admin-button primary"
            onClick={() => {
              setNotice('');
              setCreating(true);
            }}
          >
            Nouvel événement
          </button>
        )}
        {!admin && coached.length > 0 && (
          <button
            className="admin-button primary"
            onClick={() => {
              setNotice('');
              setProposing(true);
            }}
          >
            Demander un événement
          </button>
        )}
      </PanelHeading>
      {proposing && coached.length > 0 && (
        <EventProposalForm
          defaultDay={anchor}
          onCancel={() => setProposing(false)}
          onDone={() => {
            setProposing(false);
            setNotice('Demande envoyée aux administrateurs pour validation.');
            setRequestRevision((value) => value + 1);
          }}
        />
      )}
      {creating && (
        <EventEditor
          defaultDay={anchor}
          onCancel={() => setCreating(false)}
          onDone={(message, created) => {
            setCreating(false);
            setNotice(message);
            result.reload();
            if (created) filter('event', created.id);
          }}
        />
      )}
      {notice && <Notice>{notice}</Notice>}
      <CalendarNavigation mode={mode} anchor={anchor} />
      <div className="admin-toolbar">
        <label>
          Section
          <select value={section} onChange={(change) => filter('section', change.target.value)}>
            <option value="">Toutes les sections</option>
            {sections.map((item) => (
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
        <label className="club-check">
          <input
            type="checkbox"
            checked={cancelled}
            onChange={(change) => filter('annules', change.target.checked ? '1' : '')}
          />
          Afficher les annulations
        </label>
        <label>
          Origine des événements
          <select value={origin} onChange={(change) => filter('origine', change.target.value)}>
            <option value="">Toutes les origines</option>
            <option value="ffvb">FFVB</option>
            <option value="local">Locale</option>
          </select>
        </label>
      </div>
      <LoadState result={result} />
      {result.data && (
        <CalendarView
          events={result.data.filter((event) =>
            origin === 'ffvb'
              ? !!event.ffvb_match_id
              : origin === 'local'
                ? !event.ffvb_match_id
                : true,
          )}
          days={days}
          mode={mode}
          anchor={anchor}
          empty="Aucun événement sur cette période avec ces filtres."
        />
      )}
      <CoachEventRequests revision={requestRevision} />
      <DetailHost onChanged={result.reload} />
    </>
  );
}
