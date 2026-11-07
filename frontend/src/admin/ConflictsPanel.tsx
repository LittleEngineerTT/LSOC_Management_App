import { Link } from 'react-router-dom';
import { mondayOf, parisDay } from '../club/calendar';
import { useAdmin, useResource } from './data';
import type { EventConflict, EventProblem } from './types';
import { dateLabel } from './time';
import { Badge, Empty, LoadState, PanelHeading } from './ui';

// Le dépassement de capacité est un conflit ; les autres anomalies sont des erreurs à corriger.
const tones: Record<EventProblem['code'], string> = {
  capacity_exceeded: 'danger',
  missing_gymnasium: 'warning',
  no_referent: 'warning',
  ffvb_divergence: 'warning',
  ffvb_missing: 'warning',
};

/** Onglet « Conflits » : les événements à venir en conflit de capacité ou erronés. */
export function ConflictsPanel() {
  const { catalog } = useAdmin();
  const result = useResource<EventConflict>('/event-conflicts');
  const place = (conflict: EventConflict) =>
    catalog.gymnasiums.find((gym) => gym.id === conflict.event.gymnasium_id)?.name ??
    (conflict.event.location || 'Lieu non renseigné');
  return (
    <>
      <PanelHeading
        title="Conflits"
        description="Événements à venir dont la capacité du gymnase est dépassée ou qui comportent une erreur : match à domicile sans gymnase, référent manquant, écart avec le calendrier FFVB."
      >
        <button className="admin-button" onClick={result.reload}>
          Actualiser
        </button>
      </PanelHeading>
      <LoadState result={result} />
      {result.loaded && !result.data?.length && <Empty>Aucun événement en conflit.</Empty>}
      <div className="admin-list">
        {result.data?.map((conflict) => (
          <article className="admin-row" key={conflict.event.id}>
            <div className="admin-row-copy">
              <h3>{conflict.event.title}</h3>
              <p>
                {dateLabel(conflict.event.starts_at)} → {dateLabel(conflict.event.ends_at)} ·{' '}
                {place(conflict)}
              </p>
              <ul className="admin-problems" aria-label={`Problèmes de ${conflict.event.title}`}>
                {conflict.problems.map((problem) => (
                  <li key={problem.code}>
                    <Badge tone={tones[problem.code]}>{problem.message}</Badge>
                  </li>
                ))}
              </ul>
            </div>
            <div className="admin-actions">
              <Link
                className="admin-button"
                to={`/app/planning?semaine=${mondayOf(parisDay(conflict.event.starts_at))}&event=${encodeURIComponent(conflict.event.id)}`}
              >
                Ouvrir l’événement
              </Link>
              {conflict.problems.some(
                (problem) => problem.code === 'ffvb_divergence' || problem.code === 'ffvb_missing',
              ) && (
                <Link className="admin-button" to="?tab=ffvb&vue=conflicts">
                  Voir dans FFVB
                </Link>
              )}
            </div>
          </article>
        ))}
      </div>
    </>
  );
}
