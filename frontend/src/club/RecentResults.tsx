import { useCallback } from 'react';
import { useLoad } from '../admin/data';
import { Badge, LoadState } from '../admin/ui';
import { dayLabel, parisDay } from './calendar';
import { Carousel } from './Carousel';
import { useClub } from './context';

interface FFVBResult {
  match_code: string;
  kickoff_at: string;
  home_team: string;
  away_team: string;
  home_sets: number;
  away_sets: number;
  /** Points de l’équipe à domicile en premier : « 25:21 ». */
  set_scores: string[];
  points: string;
}
interface SourceResults {
  source_id: string;
  season: string;
  pool: string;
  /** Nom de l’équipe du club sur la FFVB. */
  club_team: string;
  team_id: string;
  team_name: string;
  section_id: string;
  section_name: string;
  results: FFVBResult[];
}

// Carte « Toutes les sections » : deux dernières semaines ; cartes par section : la saison.
const RECENT_DAYS = 14;
const SEASON_DAYS = 365;
// Même comparaison que le backend : sans accents, sans casse, espaces réduits.
const normalize = (value: string) =>
  value.normalize('NFKD').replace(/\p{M}/gu, '').toUpperCase().replace(/\s+/g, ' ').trim();

interface Played {
  source: SourceResults;
  match: FFVBResult;
}

/** Un match : date, équipe du club, domicile, score, extérieur, sets et victoire ou défaite. */
function ResultRow({ source, match }: Played) {
  const home = normalize(match.home_team) === normalize(source.club_team);
  const won = home ? match.home_sets > match.away_sets : match.away_sets > match.home_sets;
  return (
    <li className="club-result">
      <span className="club-result-date">{dayLabel(parisDay(match.kickoff_at))}</span>
      <span className="admin-hint">{source.team_name}</span>
      <span className="club-result-teams">
        <span className={home ? 'club-result-club' : undefined}>{match.home_team}</span>{' '}
        <strong aria-label={`${match.home_sets} sets à ${match.away_sets}`}>
          {match.home_sets} – {match.away_sets}
        </strong>{' '}
        <span className={home ? undefined : 'club-result-club'}>{match.away_team}</span>
      </span>
      <Badge tone={won ? 'good' : 'danger'}>{won ? 'Victoire' : 'Défaite'}</Badge>
      <span className="club-result-sets">
        Sets : {match.set_scores.join(' · ')}
        {match.points && ` · points ${match.points.replace('-', ' – ')}`}
      </span>
    </li>
  );
}

/** Carte de l’encart : un titre et ses matchs, du plus récent au plus ancien. */
function ResultsCard({
  title,
  hint,
  played,
  empty,
}: {
  title: string;
  hint: string;
  played: Played[];
  empty: string;
}) {
  return (
    <div className="club-results-card">
      <h4>
        {title} <span className="admin-hint">· {hint}</span>
      </h4>
      {played.length ? (
        <ul className="club-plain-list club-results-list">
          {played.map(({ source, match }) => (
            <ResultRow
              key={`${source.source_id}:${match.match_code}`}
              source={source}
              match={match}
            />
          ))}
        </ul>
      ) : (
        <p className="club-day-empty">{empty}</p>
      )}
    </div>
  );
}

/** Résultats FFVB : toutes les sections sur deux semaines, puis une carte par section. */
export function RecentResults() {
  const { api, guest } = useClub();
  const loader = useCallback(
    (signal: AbortSignal) =>
      api.list<SourceResults>(
        `${guest ? '/public' : ''}/ffvb/results?days=${SEASON_DAYS}&limit=50`,
        false,
        signal,
      ),
    [api, guest],
  );
  const result = useLoad(loader);
  const sources = result.data ?? [];
  // Sans source FFVB, la section n’a rien à montrer.
  if (result.loaded && !result.error && !sources.length) return null;
  const newest = (left: Played, right: Played) =>
    right.match.kickoff_at.localeCompare(left.match.kickoff_at);
  const played = sources
    .flatMap((source) => source.results.map((match) => ({ source, match })))
    .sort(newest);
  const since = new Date(Date.now() - RECENT_DAYS * 86_400_000).toISOString();
  // Une carte par section, dans l’ordre alphabétique.
  const sections = [...new Map(sources.map((item) => [item.section_id, item.section_name]))].sort(
    (left, right) => left[1].localeCompare(right[1], 'fr'),
  );
  const cards = [
    <ResultsCard
      key="all"
      title="Toutes les sections"
      hint={`${RECENT_DAYS} derniers jours`}
      played={played.filter((item) => item.match.kickoff_at >= since)}
      empty="Aucun match joué ces deux dernières semaines."
    />,
    ...sections.map(([id, name]) => (
      <ResultsCard
        key={id}
        title={name}
        hint="tous les résultats de la saison"
        played={played.filter((item) => item.source.section_id === id)}
        empty="Aucun match joué pour le moment."
      />
    )),
  ];
  return (
    <section className="admin-card club-results" aria-label="Résultats des matchs">
      <h3>Résultats des matchs</h3>
      <LoadState result={result} />
      {result.loaded && !result.error && <Carousel label="Résultats par section" slides={cards} />}
    </section>
  );
}
