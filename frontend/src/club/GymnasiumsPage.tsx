import { useCallback } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useLoad } from '../admin/data';
import type { Block, Capacity, Event } from '../admin/types';
import { Badge, Empty, LoadState, PanelHeading } from '../admin/ui';
import { addDays, dayLabel, parisDay, range, rangeQuery, timeRange } from './calendar';
import { useClub } from './context';
import { DetailHost } from './EventDetail';
import { useEventLink } from './events';
import { WeekNavigation, useWeek } from './PlanningPage';

export function GymnasiumsPage() {
  const { gymnasiums, admin } = useClub();
  const [search] = useSearchParams();
  const selected =
    gymnasiums.find((gym) => gym.id === search.get('gymnase')) ?? gymnasiums[0] ?? null;
  return (
    <>
      <PanelHeading
        title="Gymnases"
        description="Occupation des terrains et disponibilités de chaque gymnase, créneau par créneau."
      >
        {admin && (
          <Link className="admin-button" to="/app/administration?tab=blocks">
            Gérer les indisponibilités
          </Link>
        )}
      </PanelHeading>
      {!gymnasiums.length ? (
        <Empty>Aucun gymnase n’est encore configuré.</Empty>
      ) : (
        <nav className="club-gyms" aria-label="Gymnases">
          {gymnasiums.map((gym) => (
            <Link
              key={gym.id}
              to={`?gymnase=${gym.id}${search.get('semaine') ? `&semaine=${search.get('semaine')}` : ''}`}
              className={gym.id === selected?.id ? 'active' : ''}
              aria-current={gym.id === selected?.id ? 'page' : undefined}
            >
              <strong>{gym.name}</strong>
              <span>
                {gym.capacity} terrain{gym.capacity > 1 ? 's' : ''}
              </span>
            </Link>
          ))}
        </nav>
      )}
      {selected && <GymWeek key={selected.id} id={selected.id} capacity={selected.capacity} />}
    </>
  );
}

function GymWeek({ id, capacity }: { id: string; capacity: number }) {
  const { api } = useClub();
  const monday = useWeek();
  const link = useEventLink();
  const loader = useCallback(
    async (signal: AbortSignal) => {
      const week = range(monday, 7);
      const [availability, events, blocks] = await Promise.all([
        api.request<Capacity>(
          `/gymnasiums/${id}/availability?${rangeQuery(monday, 7)}`,
          'GET',
          undefined,
          signal,
        ),
        api.list<Event>(`/events?gymnasium_id=${id}&${rangeQuery(monday, 7)}`, true, signal),
        api.list<Block>(`/availability-blocks?gymnasium_id=${id}`, true, signal),
      ]);
      return {
        availability,
        events,
        blocks: blocks.filter(
          (block) => block.ends_at > week.starts_at && block.starts_at < week.ends_at,
        ),
      };
    },
    [api, id, monday],
  );
  const result = useLoad(loader);
  const days = Array.from({ length: 7 }, (_, index) => addDays(monday, index));
  const data = result.data;
  return (
    <>
      <WeekNavigation monday={monday} />
      <LoadState result={result} />
      {data && (
        <div className="club-agenda">
          {days.map((day) => {
            const segments = data.availability.segments.filter(
              (segment) =>
                parisDay(segment.starts_at) === day && (segment.occupied > 0 || segment.excess > 0),
            );
            const events = data.events.filter((event) => parisDay(event.starts_at) === day);
            const blocks = data.blocks.filter(
              // Intervalles [début, fin) : une fin à minuit ne déborde pas sur le jour suivant.
              (block) =>
                parisDay(block.starts_at) <= day &&
                parisDay(new Date(Date.parse(block.ends_at) - 1)) >= day,
            );
            return (
              <section className="club-day" key={day}>
                <h3>{dayLabel(day)}</h3>
                {!segments.length && !events.length && !blocks.length && (
                  <p className="club-day-empty">
                    Tous les terrains sont libres ({capacity} disponible{capacity > 1 ? 's' : ''}).
                  </p>
                )}
                {segments.length > 0 && (
                  <ul className="club-occupancy" aria-label={`Occupation le ${dayLabel(day)}`}>
                    {segments.map((segment) => (
                      <li key={segment.starts_at} className={segment.excess ? 'excess' : ''}>
                        <span className="club-occupancy-time">
                          {timeRange(segment.starts_at, segment.ends_at)}
                        </span>
                        <span
                          className="club-meter"
                          role="img"
                          aria-label={`${segment.occupied} terrains occupés sur ${capacity}`}
                        >
                          <span
                            style={{
                              width: `${Math.min(100, (segment.occupied / capacity) * 100)}%`,
                            }}
                          />
                        </span>
                        <span>
                          {segment.excess
                            ? `Complet · ${segment.excess} terrain${segment.excess > 1 ? 's' : ''} en excès`
                            : segment.available
                              ? `${segment.available} libre${segment.available > 1 ? 's' : ''} sur ${capacity}`
                              : 'Complet'}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                {(events.length > 0 || blocks.length > 0) && (
                  <ul className="club-plain-list club-gym-items">
                    {blocks.map((block) => (
                      <li key={block.id}>
                        <Badge tone="warning">Indisponible</Badge> {block.title} ·{' '}
                        {timeRange(block.starts_at, block.ends_at)} · {block.courts} terrain
                        {block.courts > 1 ? 's' : ''}
                      </li>
                    ))}
                    {events.map((event) => (
                      <li key={event.id}>
                        <Link to={link(event.id)}>{event.title}</Link> ·{' '}
                        {timeRange(event.starts_at, event.ends_at)} · {event.courts} terrain
                        {event.courts > 1 ? 's' : ''}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      )}
      <DetailHost onChanged={result.reload} />
    </>
  );
}
