import { useRef, type CSSProperties } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { Event } from '../admin/types';
import { Empty } from '../admin/ui';
import { dayLabel, timeRange, today } from './calendar';
import {
  HOUR_HEIGHT,
  MIN_EVENT_MINUTES,
  placeSegments,
  splitEvents,
  type PlacedSegment,
} from './calendarLayout';
import type { CalendarMode } from './CalendarNavigation';
import { EventRow, EventOrigin, kindLabels, useEventLink, usePlace } from './events';
import { validDay } from './calendar';
import './calendar.css';

export function CalendarLegend() {
  return (
    <div className="calendar-legend" aria-label="Légende du calendrier">
      <span className="origin-ffvb">
        <span className="calendar-dot" />
        Événement FFVB
      </span>
      <span className="origin-local">
        <span className="calendar-dot" />
        Événement local
      </span>
      <span>Horaires de Paris · cliquez sur un événement pour le consulter</span>
    </div>
  );
}
export function CalendarView({
  events,
  days,
  mode,
  anchor,
  empty,
}: {
  events: Event[];
  days: string[];
  mode: CalendarMode;
  anchor: string;
  empty: string;
}) {
  const segments = splitEvents(events, days);
  return (
    <>
      <CalendarLegend />
      {!segments.length && <Empty>{empty}</Empty>}
      {mode === 'week' ? (
        <WeekCalendar key={days[0]} days={days} segments={placeSegments(segments)} />
      ) : (
        <MonthCalendar key={anchor.slice(0, 7)} days={days} events={events} anchor={anchor} />
      )}
    </>
  );
}

const weekdayFormat = new Intl.DateTimeFormat('fr-FR', { timeZone: 'UTC', weekday: 'short' });
const weekday = (day: string) => weekdayFormat.format(new Date(`${day}T12:00:00Z`));
function WeekCalendar({ days, segments }: { days: string[]; segments: PlacedSegment[] }) {
  const scroll = useRef<HTMLDivElement>(null);
  const columns = useRef(new Map<string, HTMLElement>());
  const current = today();
  const startHour = Math.max(
    0,
    Math.min(8, ...segments.map((item) => Math.floor(item.startMinute / 60))),
  );
  const endHour = Math.min(
    24,
    Math.max(22, ...segments.map((item) => Math.ceil(item.endMinute / 60))),
  );
  const height = (endHour - startHour) * HOUR_HEIGHT + (MIN_EVENT_MINUTES * HOUR_HEIGHT) / 60;
  const hours = Array.from({ length: endHour - startHour + 1 }, (_, index) => startHour + index);
  return (
    <section className="calendar-week" aria-label="Calendrier de la semaine">
      <div className="calendar-mobile-days" role="group" aria-label="Aller à un jour">
        {days.map((day) => (
          <button
            key={day}
            className="admin-button"
            aria-label={dayLabel(day)}
            onClick={() => {
              const column = columns.current.get(day);
              const container = scroll.current;
              if (column && container)
                container.scrollTo({ left: column.offsetLeft - 48, behavior: 'smooth' });
            }}
          >
            {weekday(day)} {Number(day.slice(8))}
          </button>
        ))}
      </div>
      <p className="calendar-mobile-hint">
        Faites glisser le calendrier pour voir les autres jours.
      </p>
      <div
        className="calendar-week-scroll"
        ref={scroll}
        tabIndex={0}
        aria-label="Grille horaire, défilement horizontal et vertical"
      >
        <div
          className="calendar-week-grid"
          style={
            {
              '--calendar-height': `${height}px`,
              '--hour-height': `${HOUR_HEIGHT}px`,
            } as CSSProperties
          }
        >
          <div className="calendar-corner">Paris</div>
          {days.map((day) => (
            <div
              className={`calendar-day-heading${day === current ? ' today' : ''}`}
              key={day}
              aria-hidden="true"
            >
              <span>{weekday(day)}</span>
              <strong>{Number(day.slice(8))}</strong>
              {day === current && <span>Aujourd’hui</span>}
            </div>
          ))}
          <div className="calendar-hours" aria-hidden="true">
            {hours.map((hour) => (
              <span key={hour} style={{ top: (hour - startHour) * HOUR_HEIGHT }}>
                {String(hour).padStart(2, '0')}:00
              </span>
            ))}
          </div>
          {days.map((day) => {
            const items = segments.filter((item) => item.day === day);
            return (
              <section
                className={`calendar-time-column${day === current ? ' today' : ''}`}
                key={day}
                aria-label={dayLabel(day)}
                ref={(node) => {
                  if (node) columns.current.set(day, node);
                  else columns.current.delete(day);
                }}
              >
                {!items.length && <p className="calendar-day-empty">Aucun événement</p>}
                {items.map((item) => (
                  <CalendarEvent
                    key={item.event.id}
                    event={item.event}
                    className="calendar-time-event"
                    style={{
                      top: ((item.startMinute - startHour * 60) * HOUR_HEIGHT) / 60,
                      height:
                        (Math.max(item.endMinute - item.startMinute, MIN_EVENT_MINUTES) *
                          HOUR_HEIGHT) /
                        60,
                      left: `calc(${(item.lane / item.lanes) * 100}% + 3px)`,
                      width: `calc(${100 / item.lanes}% - 6px)`,
                    }}
                    continuation={item.continuesBefore || item.continuesAfter}
                  />
                ))}
              </section>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function CalendarEvent({
  event,
  style,
  className = '',
  continuation = false,
}: {
  event: Event;
  style?: CSSProperties;
  className?: string;
  continuation?: boolean;
}) {
  const link = useEventLink();
  const place = usePlace();
  const source = event.ffvb_match_id ? 'FFVB' : 'Local';
  const label = `${event.title}, ${source}, ${kindLabels[event.kind]}, ${timeRange(event.starts_at, event.ends_at)}, ${place(event)}${event.cancelled ? ', annulé' : ''}`;
  return (
    <Link
      to={link(event.id)}
      className={`calendar-event origin-${event.ffvb_match_id ? 'ffvb' : 'local'}${event.cancelled ? ' cancelled' : ''} ${className}`}
      style={style}
      aria-label={label}
      title={label}
    >
      <span className="calendar-event-meta">
        <EventOrigin event={event} />
        {event.cancelled && <span>Annulé</span>}
      </span>
      <strong>{event.title}</strong>
      <span className="calendar-event-hours">{timeRange(event.starts_at, event.ends_at)}</span>
      {event.kickoff_at && (
        <span className="calendar-kickoff">
          Coup d’envoi : {timeRange(event.kickoff_at, event.kickoff_at).split(' – ')[0]}
        </span>
      )}
      {continuation && <span className="calendar-continuation">Sur plusieurs jours</span>}
    </Link>
  );
}

function MonthCalendar({
  days,
  events,
  anchor,
}: {
  days: string[];
  events: Event[];
  anchor: string;
}) {
  const current = today();
  const [search, setSearch] = useSearchParams();
  const requested = search.get('jour');
  const selected = validDay(requested) && days.includes(requested) ? requested : anchor;
  const segments = splitEvents(events, days);
  const groups = new Map(
    days.map((day) => [day, segments.filter((item) => item.day === day).map((item) => item.event)]),
  );
  return (
    <section className="calendar-month" aria-label="Calendrier du mois">
      <div className="calendar-month-grid">
        {days.slice(0, 7).map((day) => (
          <div className="calendar-month-weekday" key={day}>
            {weekday(day)}
          </div>
        ))}
        {days.map((day) => {
          const items = groups.get(day) ?? [];
          return (
            <section
              key={day}
              aria-label={dayLabel(day)}
              className={`calendar-month-day${day.slice(0, 7) !== anchor.slice(0, 7) ? ' outside' : ''}${day === current ? ' today' : ''}${day === selected ? ' selected-day' : ''}`}
            >
              <button
                className="calendar-date-button"
                aria-pressed={day === selected}
                aria-label={`${dayLabel(day)}, ${items.length} événement${items.length > 1 ? 's' : ''}`}
                onClick={() =>
                  setSearch((previous) => {
                    const next = new URLSearchParams(previous);
                    next.set('jour', day);
                    return next;
                  })
                }
              >
                <span>{Number(day.slice(8))}</span>
                <span className="calendar-month-count">{items.length > 0 ? items.length : ''}</span>
                <span className="calendar-month-dots" aria-hidden="true">
                  {items.some((item) => item.ffvb_match_id) && (
                    <i className="origin-ffvb calendar-dot" />
                  )}
                  {items.some((item) => !item.ffvb_match_id) && (
                    <i className="origin-local calendar-dot" />
                  )}
                </span>
              </button>
              <div className="calendar-month-events">
                {items.map((event) => (
                  <CalendarEvent key={event.id} event={event} />
                ))}
              </div>
            </section>
          );
        })}
      </div>
      <section
        className="calendar-selected-day club-day"
        aria-label={`Événements du ${dayLabel(selected)}`}
      >
        <h3>{dayLabel(selected)}</h3>
        {(groups.get(selected) ?? []).length ? (
          <ul className="club-events">
            {groups.get(selected)!.map((event) => (
              <EventRow key={event.id} event={event} />
            ))}
          </ul>
        ) : (
          <Empty>Aucun événement ce jour avec ces filtres.</Empty>
        )}
      </section>
    </section>
  );
}
