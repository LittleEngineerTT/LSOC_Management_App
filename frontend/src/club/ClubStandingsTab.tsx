import { useCallback, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useLoad } from '../admin/data';
import { Badge, Empty, LoadState } from '../admin/ui';
import { dayLabel, parisDay, timeLabel } from './calendar';
import { useClub } from './context';

interface Standing {
  rank: number;
  team: string;
  points: number;
  played: number;
  won: number;
  lost: number;
  forfeits: number;
  wins_3_0: number;
  wins_3_1: number;
  wins_3_2: number;
  losses_2_3: number;
  losses_1_3: number;
  losses_0_3: number;
}
interface TeamMatch {
  match_code: string;
  kickoff_at: string;
  home_team: string;
  away_team: string;
  /** Absent d’un match joué avant le premier import : la FFVB n’en affiche plus que le score. */
  location: string | null;
  score: {
    home_sets: number;
    away_sets: number;
    /** Points de l’équipe à domicile en premier : « 25:21 ». */
    set_scores: string[];
    points: string;
  } | null;
}
export interface TeamStandings {
  source_id: string;
  season: string;
  pool: string;
  /** Intitulé FFVB de la compétition ; absent tant que le classement n’a pas été relevé. */
  title: string | null;
  /** Nom de l’équipe du club sur la FFVB. */
  club_team: string;
  team_id: string;
  team_name: string;
  section_id: string;
  section_name: string;
  /** Dernier relevé du classement, une fois par jour et le soir des matchs. */
  updated_at: string | null;
  rows: Standing[];
  /** Matchs de l’équipe sur la saison, du plus ancien au plus récent. */
  matches: TeamMatch[];
}

// Même comparaison que le backend : sans accents, sans casse, espaces réduits.
const normalize = (value: string) =>
  value.normalize('NFKD').replace(/\p{M}/gu, '').toUpperCase().replace(/\s+/g, ' ').trim();

// Colonnes après le rang et l’équipe : intitulé affiché, intitulé lu et valeur.
const columns: { label: string; title: string; value: (row: Standing) => number }[] = [
  { label: 'Pts', title: 'Points', value: (row) => row.points },
  { label: 'J', title: 'Matchs joués', value: (row) => row.played },
  { label: 'G', title: 'Matchs gagnés', value: (row) => row.won },
  { label: 'P', title: 'Matchs perdus', value: (row) => row.lost },
  { label: '3-0', title: 'Victoires 3-0', value: (row) => row.wins_3_0 },
  { label: '3-1', title: 'Victoires 3-1', value: (row) => row.wins_3_1 },
  { label: '3-2', title: 'Victoires 3-2', value: (row) => row.wins_3_2 },
  { label: '2-3', title: 'Défaites 2-3', value: (row) => row.losses_2_3 },
  { label: '1-3', title: 'Défaites 1-3', value: (row) => row.losses_1_3 },
  { label: '0-3', title: 'Défaites 0-3', value: (row) => row.losses_0_3 },
];

/** Classement d’une équipe : la poule entière, l’équipe du club mise en avant. */
function StandingsTable({ item }: { item: TeamStandings }) {
  if (!item.rows.length) return <p className="club-day-empty">Classement pas encore disponible.</p>;
  const club = normalize(item.club_team);
  return (
    <>
      <p className="admin-hint">
        {item.title ?? item.pool} · saison {item.season}
        {item.updated_at &&
          ` · mis à jour le ${dayLabel(parisDay(item.updated_at))} à ${timeLabel(item.updated_at)}`}
      </p>
      <div className="club-standings-scroll">
        <table className="club-standings">
          <caption className="visually-hidden">Classement {item.team_name}</caption>
          <thead>
            <tr>
              <th scope="col">
                <abbr title="Rang">#</abbr>
              </th>
              <th scope="col">Équipe</th>
              {columns.map((column) => (
                <th key={column.label} scope="col">
                  <abbr title={column.title}>{column.label}</abbr>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {item.rows.map((row) => {
              const own = normalize(row.team) === club;
              return (
                <tr
                  key={`${row.rank}:${row.team}`}
                  className={own ? 'club-standings-own' : undefined}
                  aria-current={own ? 'true' : undefined}
                >
                  <td>{row.rank}</td>
                  <th scope="row">{row.team}</th>
                  {columns.map((column) => (
                    <td key={column.label}>{column.value(row) || '–'}</td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

/** Un match : date et heure, équipes et score, puis lieu et détail des sets. */
function MatchRow({ match, club }: { match: TeamMatch; club: string }) {
  const home = normalize(match.home_team) === club;
  const score = match.score;
  const won =
    score && (home ? score.home_sets > score.away_sets : score.away_sets > score.home_sets);
  const details = [
    match.location && `Lieu : ${match.location}`,
    score && `Sets : ${score.set_scores.join(' · ')}`,
    score?.points && `points ${score.points.replace('-', ' – ')}`,
  ].filter(Boolean);
  return (
    <li className="club-result">
      <span className="club-result-date">
        {dayLabel(parisDay(match.kickoff_at))} · {timeLabel(match.kickoff_at)}
      </span>
      <span className="club-result-teams">
        <span className={home ? 'club-result-club' : undefined}>{match.home_team}</span>{' '}
        {score ? (
          <strong aria-label={`${score.home_sets} sets à ${score.away_sets}`}>
            {score.home_sets} – {score.away_sets}
          </strong>
        ) : (
          <span aria-hidden="true">/</span>
        )}{' '}
        <span className={home ? undefined : 'club-result-club'}>{match.away_team}</span>
      </span>
      {score ? (
        <Badge tone={won ? 'good' : 'danger'}>{won ? 'Victoire' : 'Défaite'}</Badge>
      ) : (
        <Badge>{home ? 'Domicile' : 'Extérieur'}</Badge>
      )}
      {details.length > 0 && <span className="club-result-sets">{details.join(' · ')}</span>}
    </li>
  );
}

/** Matchs de l’équipe sous son classement : à venir (le plus proche d’abord), puis joués (le
 * plus récent d’abord). Un match passé sans score attend son résultat parmi les matchs à venir. */
function TeamMatches({ item }: { item: TeamStandings }) {
  const club = normalize(item.club_team);
  const upcoming = item.matches.filter((match) => !match.score);
  const played = item.matches.filter((match) => match.score).reverse();
  const group = (title: string, matches: TeamMatch[], empty: string) => (
    <section className="club-team-matches" aria-label={title}>
      <h5>{title}</h5>
      {matches.length ? (
        <ul className="club-plain-list club-results-list">
          {matches.map((match) => (
            <MatchRow key={match.match_code} match={match} club={club} />
          ))}
        </ul>
      ) : (
        <p className="club-day-empty">{empty}</p>
      )}
    </section>
  );
  return (
    <>
      {group('Matchs à venir', upcoming, 'Aucun match à venir.')}
      {group('Matchs joués', played, 'Aucun match joué pour le moment.')}
    </>
  );
}

/** Section du club : ses équipes à choisir et le classement de l’équipe choisie, propre à la
 * section ; `initial` (l’équipe de l’adresse) n’est retenue que si elle en fait partie. */
function SectionStandings({
  name,
  teams,
  initial,
}: {
  name: string;
  teams: TeamStandings[];
  initial: string | null;
}) {
  const [selected, setSelected] = useState(initial);
  const current = teams.find((item) => item.team_id === selected) ?? teams[0];
  if (!current) return null;
  const titleId = `club-standings-${current.section_id}`;
  return (
    <section className="admin-card club-standings-section" aria-labelledby={titleId}>
      <h3 id={titleId}>{name}</h3>
      {teams.length > 1 && (
        <nav className="club-page-team-switch" aria-label={`Équipes ${name}`}>
          {teams.map((item) => (
            <button
              key={item.team_id}
              type="button"
              className={item === current ? 'active' : undefined}
              aria-pressed={item === current}
              onClick={() => setSelected(item.team_id)}
            >
              {item.team_name}
            </button>
          ))}
        </nav>
      )}
      <h4>{current.team_name}</h4>
      <StandingsTable item={current} />
      <TeamMatches item={current} />
    </section>
  );
}

/** Onglet « Résultats des équipes » de Notre club : classement FFVB de chaque équipe dotée
 * d’une source, groupé par section. `?equipe=` ouvre directement le classement d’une équipe.
 */
export function ClubStandingsTab() {
  const { api, guest } = useClub();
  const [search] = useSearchParams();
  const loader = useCallback(
    (signal: AbortSignal) =>
      api.list<TeamStandings>(`${guest ? '/public' : ''}/ffvb/standings`, false, signal),
    [api, guest],
  );
  const result = useLoad(loader);
  const items = result.data ?? [];
  // Sections dans l’ordre alphabétique, équipes de chacune aussi.
  const sections = [...new Map(items.map((item) => [item.section_id, item.section_name]))]
    .sort((left, right) => left[1].localeCompare(right[1], 'fr'))
    .map(([id, name]) => ({
      id,
      name,
      teams: items
        .filter((item) => item.section_id === id)
        .sort((left, right) => left.team_name.localeCompare(right.team_name, 'fr')),
    }));
  return (
    <>
      <LoadState result={result} />
      {result.loaded && !result.error && !sections.length && (
        <Empty>Aucune équipe n’a encore de classement FFVB.</Empty>
      )}
      {sections.map((section) => (
        <SectionStandings
          key={section.id}
          name={section.name}
          teams={section.teams}
          initial={search.get('equipe')}
        />
      ))}
    </>
  );
}
