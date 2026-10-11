import { useSearchParams } from 'react-router-dom';
import { addDays, mondayOf, today, validDay, weekLabel } from './calendar';
import { monthDays, shiftMonth } from './calendarLayout';

export type CalendarMode = 'week' | 'month';
export function useCalendarPeriod(defaultMode: CalendarMode = 'week') {
  const [search] = useSearchParams();
  const requested = search.get('vue');
  const mode: CalendarMode =
    requested === 'mois' ? 'month' : requested === 'semaine' ? 'week' : defaultMode;
  const raw = search.get('semaine');
  const anchor = validDay(raw) ? raw : today();
  const first = mondayOf(anchor);
  const days =
    mode === 'month'
      ? monthDays(anchor)
      : Array.from({ length: 7 }, (_, index) => addDays(first, index));
  return { mode, anchor, days };
}

const monthFormat = new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'UTC',
  month: 'long',
  year: 'numeric',
});
export function CalendarNavigation({ mode, anchor }: { mode: CalendarMode; anchor: string }) {
  const [, setSearch] = useSearchParams();
  function change(values: Record<string, string>) {
    setSearch((previous) => {
      const next = new URLSearchParams(previous);
      for (const [key, value] of Object.entries(values)) next.set(key, value);
      next.delete('jour');
      next.delete('event');
      return next;
    });
  }
  const monthLabel = monthFormat.format(new Date(`${anchor}T12:00:00Z`));
  const label =
    mode === 'week'
      ? weekLabel(mondayOf(anchor))
      : monthLabel.charAt(0).toUpperCase() + monthLabel.slice(1);
  const move = (direction: number) =>
    change({
      semaine:
        mode === 'month' ? shiftMonth(anchor, direction) : addDays(mondayOf(anchor), direction * 7),
    });
  return (
    <div className="calendar-navigation">
      <div className="club-week">
        <button className="admin-button" onClick={() => move(-1)}>
          <span aria-hidden="true">←</span>{' '}
          {mode === 'month' ? 'Mois précédent' : 'Semaine précédente'}
        </button>
        <strong aria-live="polite">{label}</strong>
        <button className="admin-button" onClick={() => change({ semaine: today() })}>
          Aujourd’hui
        </button>
        <button className="admin-button" onClick={() => move(1)}>
          {mode === 'month' ? 'Mois suivant' : 'Semaine suivante'} <span aria-hidden="true">→</span>
        </button>
      </div>
      <div className="admin-subtabs" role="group" aria-label="Vue du calendrier">
        <button
          className={`admin-button${mode === 'week' ? ' selected' : ''}`}
          aria-pressed={mode === 'week'}
          onClick={() => change({ vue: 'semaine' })}
        >
          Semaine
        </button>
        <button
          className={`admin-button${mode === 'month' ? ' selected' : ''}`}
          aria-pressed={mode === 'month'}
          onClick={() => change({ vue: 'mois' })}
        >
          Mois
        </button>
      </div>
    </div>
  );
}
