import { useCallback } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useLoad } from '../admin/data';
import type { Block, Capacity, Event } from '../admin/types';
import { Empty, LoadState, PanelHeading } from '../admin/ui';
import { range, rangeQuery } from './calendar';
import { CalendarNavigation, useCalendarPeriod } from './CalendarNavigation';
import { GymAvailabilityCalendar, GymCalendarLegend } from './GymAvailabilityCalendar';
import { useClub } from './context';
import { DetailHost } from './EventDetail';

/** Gymnase choisi par le paramètre « gymnase » de l’URL, sinon le premier. */
export function useSelectedGym() {
  const { gymnasiums } = useClub();
  const [search] = useSearchParams();
  return gymnasiums.find((gym) => gym.id === search.get('gymnase')) ?? gymnasiums[0] ?? null;
}

/** Choix du gymnase affiché ; sa capacité n’est indiquée que si elle est connue (pas aux invités). */
export function GymPicker() {
  const { gymnasiums } = useClub();
  const [search] = useSearchParams();
  const selected = useSelectedGym();
  function gymLink(id: string) {
    const next = new URLSearchParams(search);
    next.set('gymnase', id);
    next.delete('event');
    return `?${next.toString()}`;
  }
  if (!gymnasiums.length) return <Empty>Aucun gymnase n’est encore configuré.</Empty>;
  return (
    <nav className="club-gyms" aria-label="Gymnases">
      {gymnasiums.map((gym) => (
        <Link
          key={gym.id}
          to={gymLink(gym.id)}
          className={gym.id === selected?.id ? 'active' : ''}
          aria-current={gym.id === selected?.id ? 'page' : undefined}
        >
          <strong>{gym.name}</strong>
          {gym.capacity > 0 && (
            <span>
              {gym.capacity} terrain{gym.capacity > 1 ? 's' : ''}
            </span>
          )}
        </Link>
      ))}
    </nav>
  );
}

export function GymnasiumsPage() {
  const { admin } = useClub();
  const selected = useSelectedGym();
  return (
    <>
      <PanelHeading
        title="Planning des gymnases"
        description="Occupation des terrains et disponibilités de chaque gymnase, créneau par créneau."
      >
        {admin && (
          <Link className="admin-button" to="/app/administration?tab=blocks">
            Gérer les indisponibilités
          </Link>
        )}
      </PanelHeading>
      <GymPicker />
      {selected && <GymWeek key={selected.id} id={selected.id} capacity={selected.capacity} />}
    </>
  );
}

function GymWeek({ id, capacity }: { id: string; capacity: number }) {
  const { api } = useClub();
  const { mode, anchor, days } = useCalendarPeriod();
  const first = days[0]!;
  const length = days.length;
  const loader = useCallback(
    async (signal: AbortSignal) => {
      const period = range(first, length);
      const query = rangeQuery(first, length);
      const [availability, events, blocks] = await Promise.all([
        api.request<Capacity>(`/gymnasiums/${id}/availability?${query}`, 'GET', undefined, signal),
        api.list<Event>(`/events?gymnasium_id=${id}&${query}`, true, signal),
        api.list<Block>(`/availability-blocks?gymnasium_id=${id}`, true, signal),
      ]);
      return {
        availability,
        events,
        blocks: blocks.filter(
          (block) =>
            block.gymnasium_id === id &&
            Date.parse(block.ends_at) > Date.parse(period.starts_at) &&
            Date.parse(block.starts_at) < Date.parse(period.ends_at),
        ),
      };
    },
    [api, id, first, length],
  );
  const result = useLoad(loader);
  return (
    <>
      <GymCalendarLegend mode={mode} />
      <CalendarNavigation mode={mode} anchor={anchor} />
      <LoadState result={result} />
      {result.data && (
        <GymAvailabilityCalendar
          key={`${id}-${mode}-${first}`}
          {...result.data}
          capacity={capacity}
          days={days}
          mode={mode}
          anchor={anchor}
        />
      )}
      <DetailHost onChanged={result.reload} />
    </>
  );
}
