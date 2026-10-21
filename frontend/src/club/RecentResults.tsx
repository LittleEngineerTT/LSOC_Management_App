import { useCallback } from 'react';
import { useLoad } from '../admin/data';
import { Badge, LoadState } from '../admin/ui';
import { dayLabel, parisDay } from './calendar';
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

const DAYS = 30;
// Même comparaison que le backend : sans accents, sans casse, espaces réduits.
const normalize = (value: string) =>
  value.normalize('NFKD').replace(/\p{M}/gu, '').toUpperCase().replace(/\s+/g, ' ').trim();

/** Résultats des matchs FFVB des 30 derniers jours, pour chaque source configurée. */
export function RecentResults() {
  const { api } = useClub();
  const loader = useCallback(
    (signal: AbortSignal) => api.list<SourceResults>(`/ffvb/results?days=${DAYS}`, false, signal),
    [api],
  );
  const result = useLoad(loader);
  const sources = result.data ?? [];
  // Sans source FFVB, la section n’a rien à montrer.
  if (result.loaded && !result.error && !sources.length) return null;
  return (
    <section className="admin-card club-results" aria-label="Résultats récents">
      <h3>Résultats récents</h3>
      <p className="admin-hint">Matchs FFVB des {DAYS} derniers jours, par équipe.</p>
      <LoadState result={result} />
      {sources.map((source) => (
        <div className="club-results-source" key={source.source_id}>
          <h4>
            {source.team_name} <Badge>{source.section_name}</Badge>{' '}
            <span className="admin-hint">
              · poule {source.pool}, saison {source.season}
            </span>
          </h4>
          {source.results.length ? (
            <ul className="club-plain-list">
              {source.results.map((match) => {
                const home = normalize(match.home_team) === normalize(source.club_team);
                const won = home
                  ? match.home_sets > match.away_sets
                  : match.away_sets > match.home_sets;
                return (
                  <li key={match.match_code} className="club-result">
                    <span className="club-result-date">{dayLabel(parisDay(match.kickoff_at))}</span>
                    <span className="club-result-teams">
                      <span className={home ? 'club-result-club' : undefined}>
                        {match.home_team}
                      </span>{' '}
                      <strong aria-label={`${match.home_sets} sets à ${match.away_sets}`}>
                        {match.home_sets} – {match.away_sets}
                      </strong>{' '}
                      <span className={home ? undefined : 'club-result-club'}>
                        {match.away_team}
                      </span>
                    </span>
                    <Badge tone={won ? 'good' : 'danger'}>{won ? 'Victoire' : 'Défaite'}</Badge>
                    <span className="club-result-sets">
                      Sets : {match.set_scores.join(' · ')}
                      {match.points && ` · points ${match.points.replace('-', ' – ')}`}
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="club-day-empty">Aucun match joué sur cette période.</p>
          )}
        </div>
      ))}
    </section>
  );
}
