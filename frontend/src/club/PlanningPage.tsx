import { useCallback, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useLoad } from '../admin/data';
import type { Event, Registration } from '../admin/types';
import { LoadState, Notice, PanelHeading } from '../admin/ui';
import { addDays, mondayOf, rangeQuery, today, validDay, weekLabel } from './calendar';
import { isFollowed, useClub } from './context';
import { DetailHost } from './EventDetail';
import { EventEditor } from './EventEditor';
import { CalendarLegend, CalendarView } from './CalendarView';
import { CalendarNavigation, useCalendarPeriod, useSelectedDay } from './CalendarNavigation';
import { CoachEventRequests } from './CoachEventRequests';
import { AWAY, concernsTeam } from './events';
import { EventProposalForm, useCoachedTeams } from './EventProposalForm';
import { MyRequests } from './MyRequests';
import { TeamOptions } from './teamOrder';
import type { SlotPreset } from './schedule';

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
  const { api, admin, account, sections, teams, gymnasiums, follows, assignments } = useClub();
  const coached = useCoachedTeams();
  // Un coach voit toujours le bouton ; le formulaire exige une équipe dont il est référent
  // ou à laquelle il est rattaché comme coach. Un référent d’équipe le voit aussi.
  const coach = !admin && (account.roles.includes('coach') || coached.length > 0);
  const [search, setSearch] = useSearchParams();
  const { mode, anchor, days } = useCalendarPeriod();
  const firstDay = days[0]!;
  // Un nouvel événement est proposé le jour choisi dans le calendrier.
  const { selected } = useSelectedDay(days, anchor);
  const section = search.get('section') ?? '';
  const gym = search.get('gymnase') ?? '';
  // Les équipes proposées suivent la section choisie ; une équipe inconnue est ignorée.
  const teamChoices = teams.filter((item) => !section || item.section_id === section);
  const team = teamChoices.some((item) => item.id === search.get('equipe'))
    ? (search.get('equipe') ?? '')
    : '';
  const selectedTeam = teams.find((item) => item.id === team);
  // Les annulations restent visibles, en rouge, sauf choix contraire ; les conflits, toujours.
  const cancelled = search.get('annules') !== '0';
  // « Mon planning » : séances de mes équipes ou ouvertes à leur inscription, favoris,
  // ceux dont je suis référent ou que j’encadre comme coach, et ceux où je suis inscrit.
  const mine = search.get('mon') === '1';
  // Créneau choisi dans la recherche de créneau : la création s’ouvre, préremplie.
  const slotStart = search.get('creneau_debut');
  const preset: SlotPreset | undefined = slotStart
    ? {
        starts_at: slotStart,
        ends_at: search.get('creneau_fin') ?? slotStart,
        gymnasium_id: search.get('creneau_gymnase') ?? '',
        courts: Number(search.get('creneau_terrains') ?? 1) || 1,
      }
    : undefined;
  const [creating, setCreating] = useState(admin && !!preset);
  const [proposing, setProposing] = useState(coach && !!preset);
  // Le créneau ne sert qu’une fois : il quitte l’adresse à la fermeture du formulaire.
  function closeSlot() {
    if (!slotStart) return;
    setSearch((previous) => {
      const next = new URLSearchParams(previous);
      for (const name of ['creneau_debut', 'creneau_fin', 'creneau_gymnase', 'creneau_terrains'])
        next.delete(name);
      return next;
    });
  }
  const [requestRevision, setRequestRevision] = useState(0);
  const [notice, setNotice] = useState('');
  const loader = useCallback(
    (signal: AbortSignal) => {
      const filters = [
        rangeQuery(firstDay, days.length),
        section && `section_id=${encodeURIComponent(section)}`,
        gym === AWAY ? 'away=true' : gym && `gymnasium_id=${encodeURIComponent(gym)}`,
        cancelled && 'include_cancelled=true',
      ].filter(Boolean);
      return api.list<Event>(`/events?${filters.join('&')}`, true, signal);
    },
    [api, firstDay, days.length, section, gym, cancelled],
  );
  const result = useLoad(loader);
  const registrationsLoader = useCallback(
    (signal: AbortSignal) =>
      mine ? api.list<Registration>('/registrations', true, signal) : Promise.resolve([]),
    [api, mine],
  );
  const registrations = useLoad(registrationsLoader);
  // Mes équipes : celles où je joue ou que j’encadre, et celles dont je suis référent.
  const assigned = new Set(assignments.map((assignment) => assignment.team_id));
  const myTeams = teams.filter(
    (item) => assigned.has(item.id) || item.referent_ids.includes(account.id),
  );
  const registered = new Set(
    (registrations.data ?? [])
      .filter((item) => item.status === 'accepted')
      .map((item) => item.event_id),
  );
  const myTeamIds = new Set(myTeams.map((item) => item.id));
  const mySectionIds = new Set(myTeams.map((item) => item.section_id));
  const isMine = (event: Event) =>
    registered.has(event.id) ||
    event.registration_team_ids?.some((id) => myTeamIds.has(id)) ||
    event.registration_section_ids.some((id) => mySectionIds.has(id)) ||
    event.registration_quotas?.some((quota) => mySectionIds.has(quota.section_id)) ||
    isFollowed(follows, event) ||
    event.referent_ids.includes(account.id) ||
    myTeams.some((item) => concernsTeam(event, item));
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
        {coach && (
          <button
            className="admin-button primary"
            onClick={() => {
              setNotice('');
              setProposing(true);
            }}
          >
            Nouvel événement
          </button>
        )}
      </PanelHeading>
      {proposing && coach && !coached.length && (
        <div className="admin-notice" role="alert">
          Pour proposer un événement, vous devez être référent d’une équipe ou y être rattaché comme
          coach. Demandez à un administrateur de vous désigner référent de l’équipe ou d’ajouter ce
          rattachement dans Administration.
          <button type="button" className="admin-button" onClick={() => setProposing(false)}>
            Fermer
          </button>
        </div>
      )}
      {proposing && coached.length > 0 && (
        <EventProposalForm
          defaultDay={selected}
          preset={preset}
          onCancel={() => {
            setProposing(false);
            closeSlot();
          }}
          onDone={() => {
            setProposing(false);
            closeSlot();
            setNotice('Demande envoyée aux administrateurs pour validation.');
            setRequestRevision((value) => value + 1);
          }}
        />
      )}
      {creating && (
        <EventEditor
          defaultDay={selected}
          preset={preset}
          onCancel={() => {
            setCreating(false);
            closeSlot();
          }}
          onDone={(message, created) => {
            setCreating(false);
            closeSlot();
            setNotice(message);
            result.reload();
            if (created) filter('event', created.id);
          }}
        />
      )}
      {notice && <Notice>{notice}</Notice>}
      <div className="admin-toolbar">
        <label className="club-check">
          <input
            type="checkbox"
            checked={mine}
            onChange={(change) => filter('mon', change.target.checked ? '1' : '')}
          />
          Mon planning
        </label>
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
          Équipe
          <select value={team} onChange={(change) => filter('equipe', change.target.value)}>
            <option value="">Toutes les équipes</option>
            <TeamOptions teams={teamChoices} accountId={account.id} />
          </select>
        </label>
        <label>
          Gymnase
          <select value={gym} onChange={(change) => filter('gymnase', change.target.value)}>
            <option value="">Tous les lieux</option>
            <option value={AWAY}>À l’extérieur</option>
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
            onChange={(change) => filter('annules', change.target.checked ? '' : '0')}
          />
          Afficher les annulations
        </label>
      </div>
      <CalendarLegend />
      <CalendarNavigation mode={mode} anchor={anchor} />
      <LoadState result={result} />
      {mine && <LoadState result={registrations} />}
      {result.data && (!mine || registrations.data) && (
        <CalendarView
          events={result.data.filter(
            (event) =>
              (!mine || isMine(event)) && (!selectedTeam || concernsTeam(event, selectedTeam)),
          )}
          days={days}
          mode={mode}
          anchor={anchor}
          empty={
            mine
              ? 'Rien de prévu pour vous sur cette période. Changez de période ou retirez le filtre Mon planning.'
              : 'Aucun événement sur cette période avec ces filtres.'
          }
        />
      )}
      <CoachEventRequests revision={requestRevision} />
      {mine && <MyRequests />}
      <DetailHost onChanged={result.reload} />
    </>
  );
}
