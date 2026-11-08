import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { ErrorNotice } from '../auth/components';
import { useRequest } from '../auth/useRequest';
import { FrenchDateField, FrenchTimeField } from '../admin/FrenchDateTimeField';
import { toLocal } from '../admin/time';
import { Empty, PanelHeading } from '../admin/ui';
import { dayLabel, mondayOf, timeLabel } from './calendar';
import { useClub } from './context';
import { useCoachedTeams } from './EventProposalForm';

/** Recherche envoyée à \`/slot-search\` : sans \`end\`, l’heure de début est précise. */
export interface SlotQuery {
  /** Période ; nulle : d’aujourd’hui au 31 juillet (absente des anciennes recherches). */
  from_date?: string | null;
  to_date?: string | null;
  weekdays: number[];
  start: string;
  end: string | null;
  duration_minutes: number;
  gymnasium_ids: string[];
  courts: number;
}
interface Slot {
  day: string;
  gymnasium_id: string;
  first_start: string;
  last_start: string;
}

const WEEKDAYS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];
const HISTORY_SIZE = 3;
const historyKey = (account: string) => `lsoc:slot-search:${account}`;

// Historique propre au navigateur : une commodité, illisible en navigation privée.
function readHistory(account: string): SlotQuery[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(historyKey(account)) ?? '[]');
    return Array.isArray(value) ? (value as SlotQuery[]).slice(0, HISTORY_SIZE) : [];
  } catch {
    return [];
  }
}
function writeHistory(account: string, history: SlotQuery[]) {
  try {
    localStorage.setItem(historyKey(account), JSON.stringify(history));
  } catch {
    // Stockage indisponible : l’historique n’est simplement pas conservé.
  }
}

function durationLabel(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours ? `${hours} h${rest ? ` ${String(rest).padStart(2, '0')}` : ''}` : `${rest} min`;
}

/** Recherche de créneau : jours d’ici au 31 juillet où un événement de la durée et du nombre
 * de terrains voulus tient sans conflit dans un gymnase. Un créneau trouvé ouvre la création
 * de l’événement, préremplie ; les trois dernières recherches se relancent d’un clic. */
export function SlotFinder() {
  const { api, account, admin, gymnasiums } = useClub();
  const coached = useCoachedTeams();
  // Un administrateur crée l’événement ; un coach ou un référent d’équipe le demande.
  const canCreate = admin || account.roles.includes('coach') || coached.length > 0;
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [weekdays, setWeekdays] = useState<number[]>([]);
  const [mode, setMode] = useState<'exact' | 'window'>('exact');
  const [start, setStart] = useState('19:00');
  const [end, setEnd] = useState('22:00');
  const [duration, setDuration] = useState('120');
  const [gyms, setGyms] = useState<string[]>([]);
  const [courts, setCourts] = useState('1');
  const [history, setHistory] = useState<SlotQuery[]>(() => readHistory(account.id));
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [searched, setSearched] = useState<SlotQuery | null>(null);
  const [invalid, setInvalid] = useState('');
  const request = useRequest();
  const gymName = (id: string) => gymnasiums.find((gym) => gym.id === id)?.name ?? 'Gymnase';

  function describe(query: SlotQuery) {
    const days = query.weekdays.length
      ? query.weekdays.map((day) => WEEKDAYS[day]!.slice(0, 3)).join(', ')
      : 'Tous les jours';
    const hours = query.end ? `de ${query.start} à ${query.end}` : `à ${query.start}`;
    const places = query.gymnasium_ids.length
      ? query.gymnasium_ids.map(gymName).join(', ')
      : 'tous les gymnases';
    const short = (day: string) => day.split('-').reverse().slice(0, 2).join('/');
    const period =
      query.from_date || query.to_date
        ? ` · ${query.from_date ? `du ${short(query.from_date)}` : 'dès aujourd’hui'}${query.to_date ? ` au ${short(query.to_date)}` : ''}`
        : '';
    return `${days} ${hours}${period} · ${durationLabel(query.duration_minutes)} · ${query.courts} terrain${query.courts > 1 ? 's' : ''} · ${places}`;
  }

  function run(query: SlotQuery) {
    setInvalid('');
    void request.run(async (signal) => {
      const found = await api.request<Slot[]>('/slot-search', 'POST', query, signal);
      setSlots(found);
      setSearched(query);
      // La recherche remonte en tête de l’historique, sans doublon.
      const next = [
        query,
        ...history.filter((item) => JSON.stringify(item) !== JSON.stringify(query)),
      ].slice(0, HISTORY_SIZE);
      setHistory(next);
      writeHistory(account.id, next);
    });
  }
  function relaunch(query: SlotQuery) {
    setFromDate(query.from_date ?? '');
    setToDate(query.to_date ?? '');
    setWeekdays(query.weekdays);
    setMode(query.end ? 'window' : 'exact');
    setStart(query.start);
    if (query.end) setEnd(query.end);
    setDuration(String(query.duration_minutes));
    setGyms(query.gymnasium_ids);
    setCourts(String(query.courts));
    run(query);
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    const minutes = Number(duration);
    const count = Number(courts);
    if (!Number.isInteger(minutes) || minutes < 15 || minutes > 720)
      return setInvalid('La durée va de 15 minutes à 12 heures.');
    if (!Number.isInteger(count) || count < 1) return setInvalid('Indiquez au moins un terrain.');
    if (fromDate && toDate && toDate < fromDate)
      return setInvalid('La date de fin précède la date de début.');
    if (mode === 'window') {
      const [sh, sm] = start.split(':').map(Number);
      const [eh, em] = end.split(':').map(Number);
      if (eh! * 60 + em! - (sh! * 60 + sm!) < minutes)
        return setInvalid('La plage horaire est plus courte que la durée demandée.');
    }
    run({
      from_date: fromDate || null,
      to_date: toDate || null,
      weekdays: [...weekdays].sort(),
      start,
      end: mode === 'window' ? end : null,
      duration_minutes: minutes,
      gymnasium_ids: gyms,
      courts: count,
    });
  }
  function createLink(slot: Slot) {
    const begin = new Date(slot.first_start);
    const finish = new Date(begin.getTime() + (searched?.duration_minutes ?? 0) * 60_000);
    const params = new URLSearchParams({
      onglet: 'club',
      semaine: mondayOf(slot.day),
      jour: slot.day,
      creneau_debut: toLocal(begin.toISOString()),
      creneau_fin: toLocal(finish.toISOString()),
      creneau_gymnase: slot.gymnasium_id,
      creneau_terrains: String(searched?.courts ?? 1),
    });
    return `/app/planning?${params.toString()}`;
  }
  const toggle = (list: string[] | number[], value: string | number) =>
    (list as (string | number)[]).includes(value)
      ? (list as (string | number)[]).filter((item) => item !== value)
      : [...list, value];

  return (
    <>
      <PanelHeading
        title="Recherche de créneau"
        description="Trouvez, d’ici au 31 juillet ou sur la période choisie, les jours où un gymnase peut accueillir votre événement sans conflit : jours de la semaine, heure ou plage horaire, durée, gymnases et terrains nécessaires."
      />
      {history.length > 0 && (
        <section className="admin-card slot-history" aria-label="Dernières recherches">
          <h3>Dernières recherches</h3>
          <ul>
            {history.map((query) => (
              <li key={JSON.stringify(query)}>
                <button
                  type="button"
                  className="admin-button"
                  disabled={request.pending}
                  onClick={() => relaunch(query)}
                >
                  Relancer
                </button>
                <span>{describe(query)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <form className="admin-form slot-form" aria-label="Recherche de créneau" onSubmit={submit}>
        <div className="admin-fields">
          <FrenchDateField id="slot-from" label="Du" value={fromDate} onChange={setFromDate} />
          <FrenchDateField id="slot-to" label="Au" value={toDate} onChange={setToDate} />
          <p className="admin-hint">
            Facultatif : sans date, la recherche va d’aujourd’hui au 31 juillet.
          </p>
        </div>
        <fieldset className="admin-choice-group">
          <legend>Jours de la semaine</legend>
          {WEEKDAYS.map((label, index) => (
            <label key={label}>
              <input
                type="checkbox"
                checked={weekdays.includes(index)}
                onChange={() => setWeekdays(toggle(weekdays, index) as number[])}
              />
              {label}
            </label>
          ))}
          <p className="admin-hint">Aucun jour coché : tous les jours.</p>
        </fieldset>
        <fieldset className="admin-choice-group">
          <legend>Horaire</legend>
          <label>
            <input
              type="radio"
              name="slot-mode"
              checked={mode === 'exact'}
              onChange={() => setMode('exact')}
            />
            Heure de début précise
          </label>
          <label>
            <input
              type="radio"
              name="slot-mode"
              checked={mode === 'window'}
              onChange={() => setMode('window')}
            />
            Plage horaire (début au plus tôt, fin au plus tard)
          </label>
        </fieldset>
        <div className="admin-fields">
          {/* Heures en 24 h et minutes au quart d’heure, quelle que soit la langue du navigateur. */}
          <FrenchTimeField
            id="slot-start"
            label={mode === 'exact' ? 'Heure de début' : 'De'}
            required
            value={start}
            onChange={setStart}
          />
          {mode === 'window' && (
            <FrenchTimeField id="slot-end" label="À" required value={end} onChange={setEnd} />
          )}
          <div className="admin-field">
            <label htmlFor="slot-duration">Durée (minutes)</label>
            <input
              id="slot-duration"
              type="number"
              min={15}
              max={720}
              step={15}
              required
              value={duration}
              onChange={(change) => setDuration(change.target.value)}
            />
          </div>
          <div className="admin-field">
            <label htmlFor="slot-courts">Terrains nécessaires</label>
            <input
              id="slot-courts"
              type="number"
              min={1}
              max={100}
              required
              value={courts}
              onChange={(change) => setCourts(change.target.value)}
            />
          </div>
        </div>
        <fieldset className="admin-choice-group">
          <legend>Gymnases</legend>
          <label>
            <input type="checkbox" checked={!gyms.length} onChange={() => setGyms([])} />
            Tous les gymnases
          </label>
          {gymnasiums.map((gym) => (
            <label key={gym.id}>
              <input
                type="checkbox"
                checked={gyms.includes(gym.id)}
                onChange={() => setGyms(toggle(gyms, gym.id) as string[])}
              />
              {gym.name} ({gym.capacity} terrains)
            </label>
          ))}
        </fieldset>
        <ErrorNotice message={invalid || request.error} />
        <div className="admin-actions">
          <button type="submit" className="admin-button primary" disabled={request.pending}>
            {request.pending ? 'Recherche…' : 'Rechercher'}
          </button>
        </div>
      </form>
      {slots && searched && (
        <section className="admin-card slot-results" aria-label="Créneaux trouvés">
          <h3>
            {slots.length
              ? `${slots.length} créneau${slots.length > 1 ? 'x' : ''} trouvé${slots.length > 1 ? 's' : ''}`
              : 'Aucun créneau'}
          </h3>
          <p className="admin-hint">{describe(searched)}</p>
          {!slots.length && <Empty>Aucun jour ne convient sur cette période.</Empty>}
          <ul className="slot-list">
            {slots.map((slot) => (
              <li key={`${slot.day}:${slot.gymnasium_id}`}>
                <span className="slot-day">{dayLabel(slot.day)}</span>
                <span>
                  {gymName(slot.gymnasium_id)} · à partir de {timeLabel(slot.first_start)}
                  {slot.last_start !== slot.first_start &&
                    ` (début possible jusqu’à ${timeLabel(slot.last_start)})`}
                </span>
                {canCreate ? (
                  <Link className="admin-button primary" to={createLink(slot)}>
                    {admin ? 'Créer l’événement' : 'Demander l’événement'}
                  </Link>
                ) : (
                  <Link
                    className="admin-button"
                    to={`/app/planning?onglet=gymnases&gymnase=${slot.gymnasium_id}&jour=${slot.day}&semaine=${mondayOf(slot.day)}`}
                  >
                    Voir le gymnase
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
