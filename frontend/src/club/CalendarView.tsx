import type { CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import type { Event } from '../admin/types';
import { Empty } from '../admin/ui';
import { dayLabel, timeRange, today } from './calendar';
import { HOUR_HEIGHT, MIN_EVENT_MINUTES, placeSegments, splitEvents } from './calendarLayout';
import { useSelectedDay, type CalendarMode } from './CalendarNavigation';
import { EventRow, EventOrigin, kindLabels, useEventLink, usePlace } from './events';
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
      {!segments.length && <Empty>{empty}</Empty>}
      {mode === 'week' ? (
        <WeekCalendar key={days[0]} days={days} events={events} anchor={anchor} />
      ) : (
        <MonthCalendar key={anchor.slice(0, 7)} days={days} events={events} anchor={anchor} />
      )}
    </>
  );
}

const weekdayFormat = new Intl.DateTimeFormat('fr-FR', { timeZone: 'UTC', weekday: 'short' });
const weekday = (day: string) => weekdayFormat.format(new Date(`${day}T12:00:00Z`));
function WeekCalendar({
  days,
  events,
  anchor,
}: {
  days: string[];
  events: Event[];
  anchor: string;
}) {
  const current = today();
  const { selected, select } = useSelectedDay(days, anchor);
  const segments = placeSegments(splitEvents(events, days));
  const groups = dayGroups(events, days);
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
    <section className="calendar-week planning-week" aria-label="Calendrier de la semaine">
      {/* Sur téléphone, la grille horaire laisse place à ces jours et au détail du jour choisi. */}
      <div className="calendar-mobile-days" role="group" aria-label="Choisir un jour">
        {days.map((day) => {
          const items = groups.get(day) ?? [];
          return (
            <button
              key={day}
              className={`calendar-mobile-day${day === current ? ' today' : ''}`}
              aria-pressed={day === selected}
              aria-label={`${dayLabel(day)}, ${items.length} événement${items.length > 1 ? 's' : ''}`}
              onClick={() => select(day)}
            >
              <span>{weekday(day)}</span>
              <strong>{Number(day.slice(8))}</strong>
              <OriginDots events={items} />
            </button>
          );
        })}
      </div>
      <div className="calendar-week-scroll">
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
            <button
              className={`calendar-day-heading${day === current ? ' today' : ''}${day === selected ? ' selected-day' : ''}`}
              key={day}
              aria-pressed={day === selected}
              aria-label={`Voir le ${dayLabel(day)}`}
              onClick={() => select(day)}
            >
              <span>{weekday(day)}</span>
              <strong>{Number(day.slice(8))}</strong>
              {day === current && <span>Aujourd’hui</span>}
            </button>
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
                className={`calendar-time-column${day === current ? ' today' : ''}${day === selected ? ' selected-day' : ''}`}
                key={day}
                aria-label={dayLabel(day)}
                onClick={() => select(day)}
              >
                {!items.length && <p className="calendar-day-empty">Aucun événement</p>}
                {items.map((item) => (
                  <CalendarEvent
                    key={item.event.id}
                    event={item.event}
                    day={day}
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
      <SelectedDay day={selected} events={groups.get(selected) ?? []} />
    </section>
  );
}

/** Événements de chaque jour affiché, une activité sur plusieurs jours comptant pour chacun. */
function dayGroups(events: Event[], days: string[]): Map<string, Event[]> {
  const segments = splitEvents(events, days);
  return new Map(
    days.map((day) => [day, segments.filter((item) => item.day === day).map((item) => item.event)]),
  );
}

function OriginDots({ events }: { events: Event[] }) {
  return (
    <span className="calendar-month-dots" aria-hidden="true">
      {events.some((item) => item.ffvb_match_id) && <i className="origin-ffvb calendar-dot" />}
      {events.some((item) => !item.ffvb_match_id) && <i className="origin-local calendar-dot" />}
    </span>
  );
}

function SelectedDay({ day, events }: { day: string; events: Event[] }) {
  return (
    <section
      className="calendar-selected-day club-day"
      aria-label={`Événements du ${dayLabel(day)}`}
    >
      <h3>{dayLabel(day)}</h3>
      {events.length ? (
        <ul className="club-events">
          {events.map((event) => (
            <EventRow key={event.id} event={event} />
          ))}
        </ul>
      ) : (
        <Empty>Aucun événement ce jour avec ces filtres.</Empty>
      )}
    </section>
  );
}

function CalendarEvent({
  event,
  day,
  style,
  className = '',
  continuation = false,
}: {
  event: Event;
  /** Jour de la case : ouvrir l’événement sélectionne aussi ce jour. */
  day: string;
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
      to={link(event.id, day)}
      // La case ne doit pas traiter ce clic : sa sélection écraserait l’ouverture de l’événement.
      onClick={(click) => click.stopPropagation()}
      className={`calendar-event origin-${event.ffvb_match_id ? 'ffvb' : 'local'}${event.cancelled ? ' cancelled' : ''} ${className}`}
      style={style}
      aria-label={label}
      title={label}
    >
      <span className="calendar-event-meta">
        <EventOrigin event={event} />
        {event.cancelled && <span className="calendar-cancelled">Annulé</span>}
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
  const { selected, select } = useSelectedDay(days, anchor);
  const groups = dayGroups(events, days);
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
              // Toute la case sélectionne le jour ; le bouton de date reste l’accès au clavier.
              onClick={() => select(day)}
            >
              <button
                className="calendar-date-button"
                aria-pressed={day === selected}
                aria-label={`${dayLabel(day)}, ${items.length} événement${items.length > 1 ? 's' : ''}`}
              >
                <span>{Number(day.slice(8))}</span>
                <span className="calendar-month-count">{items.length > 0 ? items.length : ''}</span>
                <OriginDots events={items} />
              </button>
              <div className="calendar-month-events">
                {items.map((event) => (
                  <CalendarEvent key={event.id} event={event} day={day} />
                ))}
              </div>
            </section>
          );
        })}
      </div>
      <SelectedDay day={selected} events={groups.get(selected) ?? []} />
    </section>
  );
}
