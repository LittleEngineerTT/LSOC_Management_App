import { useEffect, useRef, type CSSProperties } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { Block, Capacity, Event } from '../admin/types';
import { dayLabel, today, validDay } from './calendar';
import { HOUR_HEIGHT } from './calendarLayout';
import type { CalendarMode } from './CalendarNavigation';
import { EventOrigin, useEventLink } from './events';
import { gymSlotTime, placeGymBookings, splitGymIntervals, type GymDaySlot } from './gymCalendar';
import './calendar.css';
import './gymCalendar.css';

type CapacitySlot = Capacity['segments'][number];
type Booking = { type: 'event'; value: Event } | { type: 'block'; value: Block };
const weekdayFormat = new Intl.DateTimeFormat('fr-FR', { timeZone: 'UTC', weekday: 'short' });
const weekday = (day: string) => weekdayFormat.format(new Date(`${day}T12:00:00Z`));
// La vue mois n’emploie pas la notion « complet » : un créneau plein y reste neutre.
const status = (item: CapacitySlot, mode: CalendarMode) =>
  item.excess ? 'excess' : item.available ? 'free' : mode === 'month' ? 'neutral' : 'full';
const capacityLabel = (item: CapacitySlot, capacity: number, mode: CalendarMode) => {
  const excess = `${item.excess} terrain${item.excess > 1 ? 's' : ''} en excès`;
  if (mode === 'month')
    return item.excess
      ? excess
      : `${item.available} libre${item.available > 1 ? 's' : ''} sur ${capacity}`;
  return item.excess
    ? `Complet · ${excess}`
    : item.available
      ? `${item.available} libre${item.available > 1 ? 's' : ''} sur ${capacity}`
      : 'Complet';
};

export function GymCalendarLegend({ mode }: { mode: CalendarMode }) {
  return (
    <>
      <div className="calendar-legend" aria-label="Légende des disponibilités">
        <span className="gym-free">
          <i className="calendar-dot" />
          Terrains libres
        </span>
        {mode === 'week' && (
          <span className="gym-full">
            <i className="calendar-dot" />
            Complet
          </span>
        )}
        <span className="gym-excess">
          <i className="calendar-dot" />
          Capacité dépassée
        </span>
        <span className="origin-ffvb">
          <i className="calendar-dot" />
          FFVB
        </span>
        <span className="origin-local">
          <i className="calendar-dot" />
          Local
        </span>
        <span className="gym-block">
          <i className="calendar-dot" />
          Indisponibilité
        </span>
      </div>
      <p className="gym-calendar-help">
        Horaires de Paris · nombre de terrains libres par créneau. Sélectionnez un jour pour tous
        ses détails.{' '}
        {mode === 'month' && 'La vue mois indique le minimum de terrains libres dans la journée.'}
      </p>
    </>
  );
}

export function GymAvailabilityCalendar({
  availability,
  capacity,
  events,
  blocks,
  days,
  mode,
  anchor,
}: {
  availability: Capacity;
  capacity: number;
  events: Event[];
  blocks: Block[];
  days: string[];
  mode: CalendarMode;
  anchor: string;
}) {
  const [search, setSearch] = useSearchParams();
  const requested = search.get('jour');
  const selected =
    validDay(requested) && days.includes(requested)
      ? requested
      : days.includes(anchor)
        ? anchor
        : days[0]!;
  const slots = splitGymIntervals(availability.segments, days);
  const bookings = splitGymIntervals(
    [
      ...events.map((value) => ({
        starts_at: value.starts_at,
        ends_at: value.ends_at,
        type: 'event' as const,
        value,
      })),
      ...blocks.map((value) => ({
        starts_at: value.starts_at,
        ends_at: value.ends_at,
        type: 'block' as const,
        value,
      })),
    ],
    days,
  );
  function select(day: string) {
    setSearch((previous) => {
      const next = new URLSearchParams(previous);
      next.set('jour', day);
      return next;
    });
  }
  return (
    <div className="gym-calendar">
      {mode === 'week' ? (
        <GymWeek
          days={days}
          slots={slots}
          bookings={bookings}
          capacity={capacity}
          selected={selected}
          select={select}
        />
      ) : (
        <section className="calendar-month" aria-label="Calendrier de disponibilité du mois">
          <div className="calendar-month-grid">
            {days.slice(0, 7).map((day) => (
              <div key={day} className="calendar-month-weekday">
                {weekday(day)}
              </div>
            ))}
            {days.map((day) => {
              const items = slots.filter((slot) => slot.day === day);
              const min = items.length
                ? Math.min(...items.map((slot) => slot.item.available))
                : null;
              const tone = items.some((slot) => slot.item.excess) ? 'excess' : 'free';
              const dayBookings = bookings.filter((slot) => slot.day === day);
              return (
                <section
                  key={day}
                  className={`calendar-month-day gym-month-day ${day.slice(0, 7) !== anchor.slice(0, 7) ? 'outside' : ''} ${selected === day ? 'selected-day' : ''} ${day === today() ? 'today' : ''}`}
                >
                  <button
                    className="calendar-date-button"
                    aria-pressed={day === selected}
                    aria-label={`Voir les disponibilités du ${dayLabel(day)}${min === null ? ', disponibilité non renseignée' : min > 0 ? `, ${min} terrain${min > 1 ? 's' : ''} libre${min > 1 ? 's' : ''} au minimum` : ''}${tone === 'excess' ? ', capacité dépassée' : ''}`}
                    onClick={() => select(day)}
                  >
                    <strong>{Number(day.slice(8))}</strong>
                    {tone === 'excess' ? (
                      <span className="gym-month-capacity gym-excess">Excès</span>
                    ) : (
                      min !== null &&
                      min > 0 && (
                        <span
                          className="gym-month-capacity gym-free"
                          title="Minimum de terrains libres dans la journée"
                        >
                          {`${min} libre${min > 1 ? 's' : ''}`}
                        </span>
                      )
                    )}
                    <span className="gym-month-dots" aria-hidden="true">
                      {dayBookings.some(
                        (slot) => slot.item.type === 'event' && slot.item.value.ffvb_match_id,
                      ) && <i className="calendar-dot origin-ffvb" />}
                      {dayBookings.some(
                        (slot) => slot.item.type === 'event' && !slot.item.value.ffvb_match_id,
                      ) && <i className="calendar-dot origin-local" />}
                      {dayBookings.some((slot) => slot.item.type === 'block') && (
                        <i className="calendar-dot gym-block" />
                      )}
                    </span>
                  </button>
                  <div className="calendar-month-events">
                    {dayBookings.map((slot) => (
                      <BookingCard key={`${slot.item.type}-${slot.item.value.id}`} slot={slot} />
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        </section>
      )}
      <section
        className="calendar-selected-day club-day gym-selected-day"
        aria-label={`Disponibilités du ${dayLabel(selected)}`}
      >
        <h3>{dayLabel(selected)}</h3>
        <ul className="gym-day-slots" aria-label="Terrains libres par créneau">
          {slots
            .filter((slot) => slot.day === selected)
            .map((slot, index) => (
              <li className={`gym-capacity-detail gym-${status(slot.item, mode)}`} key={index}>
                <span>{gymSlotTime(slot)}</span>
                <strong>{capacityLabel(slot.item, capacity, mode)}</strong>
              </li>
            ))}
        </ul>
        {!slots.some((slot) => slot.day === selected) && (
          <p>Disponibilité non renseignée pour ce jour.</p>
        )}
        <div className="gym-day-bookings">
          {bookings
            .filter((slot) => slot.day === selected)
            .map((slot) => (
              <BookingCard key={`${slot.item.type}-${slot.item.value.id}`} slot={slot} />
            ))}
        </div>
      </section>
    </div>
  );
}

function GymWeek({
  days,
  slots,
  bookings,
  capacity,
  selected,
  select,
}: {
  days: string[];
  slots: GymDaySlot<CapacitySlot>[];
  bookings: GymDaySlot<Booking>[];
  capacity: number;
  selected: string;
  select: (day: string) => void;
}) {
  const scroll = useRef<HTMLDivElement>(null);
  const placed = placeGymBookings(bookings);
  useEffect(() => {
    if (scroll.current) scroll.current.scrollTop = 8 * HOUR_HEIGHT;
  }, []);
  return (
    <section className="calendar-week" aria-label="Calendrier de disponibilité de la semaine">
      <div className="calendar-mobile-days" role="group" aria-label="Choisir un jour">
        {days.map((day) => (
          <button
            className="admin-button"
            key={day}
            aria-pressed={selected === day}
            onClick={() => {
              select(day);
              const container = scroll.current;
              const column = container?.querySelector<HTMLElement>(`[data-gym-day="${day}"]`);
              if (container && column)
                container.scrollTo({ left: column.offsetLeft - 48, behavior: 'smooth' });
            }}
          >
            {weekday(day)} {Number(day.slice(8))}
          </button>
        ))}
      </div>
      <p className="calendar-mobile-hint">
        Faites glisser la grille pour voir les autres jours et horaires.
      </p>
      <div
        className="calendar-week-scroll"
        ref={scroll}
        tabIndex={0}
        aria-label="Grille horaire des disponibilités, défilement horizontal et vertical"
      >
        <div
          className="calendar-week-grid gym-week-grid"
          style={
            {
              '--calendar-height': `${24 * HOUR_HEIGHT + 20}px`,
              '--hour-height': `${HOUR_HEIGHT}px`,
            } as CSSProperties
          }
        >
          <div className="calendar-corner">Paris</div>
          {days.map((day) => (
            <button
              key={day}
              className={`calendar-day-heading gym-day-heading ${day === today() ? 'today' : ''}`}
              aria-label={`Voir les disponibilités du ${dayLabel(day)}`}
              aria-pressed={selected === day}
              onClick={() => select(day)}
            >
              <span>{weekday(day)}</span>
              <strong>{Number(day.slice(8))}</strong>
            </button>
          ))}
          <div className="calendar-hours" aria-hidden="true">
            {Array.from({ length: 25 }, (_, hour) => (
              <span key={hour} style={{ top: hour * HOUR_HEIGHT }}>
                {String(hour).padStart(2, '0')}:00
              </span>
            ))}
          </div>
          {days.map((day) => (
            <section
              key={day}
              className="calendar-time-column gym-time-column"
              aria-label={dayLabel(day)}
              data-gym-day={day}
            >
              <div className="gym-capacity-track">
                {slots
                  .filter((slot) => slot.day === day)
                  .map((slot, index) => (
                    <div
                      key={index}
                      className={`gym-capacity-band gym-${status(slot.item, 'week')}`}
                      style={{
                        top: (slot.startMinute * HOUR_HEIGHT) / 60,
                        height: ((slot.endMinute - slot.startMinute) * HOUR_HEIGHT) / 60,
                      }}
                      title={`${gymSlotTime(slot)} · ${capacityLabel(slot.item, capacity, 'week')}`}
                    >
                      <span>
                        <strong>{capacityLabel(slot.item, capacity, 'week')}</strong>
                        <small>{gymSlotTime(slot)}</small>
                      </span>
                    </div>
                  ))}
              </div>
              <div className="gym-booking-track">
                {placed
                  .filter((slot) => slot.day === day)
                  .map((slot) => (
                    <BookingCard
                      key={`${slot.item.type}-${slot.item.value.id}`}
                      slot={slot}
                      style={{
                        top: (slot.startMinute * HOUR_HEIGHT) / 60,
                        left: `calc(${(slot.lane / slot.lanes) * 100}% + 2px)`,
                        width: `calc(${100 / slot.lanes}% - 4px)`,
                        height:
                          (Math.max(slot.endMinute - slot.startMinute, 150) * HOUR_HEIGHT) / 60,
                      }}
                    />
                  ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </section>
  );
}

function BookingCard({ slot, style }: { slot: GymDaySlot<Booking>; style?: CSSProperties }) {
  const link = useEventLink();
  const item = slot.item.value;
  const contents = (
    <div className="gym-booking-content">
      <span className="calendar-event-meta">
        {slot.item.type === 'event' ? (
          <EventOrigin event={slot.item.value} />
        ) : (
          <span>Indisponible</span>
        )}
        {slot.item.type === 'event' && slot.item.value.cancelled && (
          <span className="calendar-cancelled">Annulé · sans occupation</span>
        )}
      </span>
      <strong>{item.title}</strong>
      <span>{gymSlotTime(slot)}</span>
      <span>
        {item.courts} terrain{item.courts > 1 ? 's' : ''}
      </span>
    </div>
  );
  return slot.item.type === 'event' ? (
    <Link
      to={link(item.id)}
      style={style}
      className={`calendar-event gym-booking origin-${slot.item.value.ffvb_match_id ? 'ffvb' : 'local'} ${slot.item.value.cancelled ? 'cancelled' : ''}`}
      aria-label={`${item.title}, ${slot.item.value.ffvb_match_id ? 'FFVB' : 'Local'}, ${gymSlotTime(slot)}, ${item.courts} terrain${item.courts > 1 ? 's' : ''}${slot.item.value.cancelled ? ', annulé, sans occupation' : ''}`}
    >
      {contents}
    </Link>
  ) : (
    <div className="calendar-event gym-booking gym-block" style={style}>
      {contents}
    </div>
  );
}
