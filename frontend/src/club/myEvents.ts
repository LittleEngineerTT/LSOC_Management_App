import { useCallback } from 'react';
import { useLoad } from '../admin/data';
import type { Event, Registration } from '../admin/types';
import { daysBetween, horizonEnd, rangeQuery, today } from './calendar';
import { isFollowed, useClub, useMySections } from './context';

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
        event.registration_team_ids?.some((id) => teamIds.has(id)) ||
        event.registration_quotas?.some((quota) => sectionIds.has(quota.section_id))
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
