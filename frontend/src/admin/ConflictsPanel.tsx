import { useState } from 'react';
import { Link } from 'react-router-dom';
import { mondayOf, parisDay } from '../club/calendar';
import { useAdmin, useResource } from './data';
import type { EventConflict, EventProblem } from './types';
import { dateLabel } from './time';
import { Badge, Confirm, Empty, LoadState, Notice, PanelHeading } from './ui';

// Le dépassement de capacité est un conflit ; les autres anomalies sont des erreurs à corriger.
const tones: Record<EventProblem['code'], string> = {
  capacity_exceeded: 'danger',
  missing_gymnasium: 'warning',
  no_referent: 'warning',
  ffvb_divergence: 'warning',
  ffvb_missing: 'warning',
  ffvb_disabled: 'warning',
  ffvb_suspended: 'warning',
};

function has(conflict: EventConflict, ...codes: EventProblem['code'][]) {
  return conflict.problems.some((problem) => codes.includes(problem.code));
}

/** Onglet « Conflits » : les événements à venir en conflit de capacité ou erronés. Un match FFVB
 * désactivé ou suspendu s’y réactive. */
export function ConflictsPanel() {
  const { api, catalog } = useAdmin();
  const result = useResource<EventConflict>('/event-conflicts');
  const [reactivating, setReactivating] = useState<EventConflict | null>(null);
  const [notice, setNotice] = useState('');
  const place = (conflict: EventConflict) =>
    catalog.gymnasiums.find((gym) => gym.id === conflict.event.gymnasium_id)?.name ??
    (conflict.event.location || 'Lieu non renseigné');
  return (
    <>
      <PanelHeading
        title="Conflits"
        description="Événements à venir dont la capacité du gymnase est dépassée ou qui comportent une erreur : match à domicile sans gymnase, référent manquant, écart avec le calendrier FFVB, vérification FFVB désactivée ou suspendue."
      >
        <button className="admin-button" onClick={result.reload}>
          Actualiser
        </button>
      </PanelHeading>
      <LoadState result={result} />
      {notice && <Notice>{notice}</Notice>}
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
              {has(conflict, 'ffvb_divergence') && (
                <Link className="admin-button" to="?tab=ffvb&vue=conflicts">
                  Voir la divergence
                </Link>
              )}
              {conflict.event.ffvb_match_id && has(conflict, 'ffvb_disabled', 'ffvb_suspended') && (
                <button
                  className="admin-button"
                  onClick={() => {
                    setNotice('');
                    setReactivating(conflict);
                  }}
                >
                  Réactiver la vérification FFVB
                </button>
              )}
            </div>
          </article>
        ))}
      </div>
      {reactivating && (
        <Confirm
          title="Réactiver la vérification de ce match ?"
          onClose={() => setReactivating(null)}
          onConfirm={async (signal) => {
            await api.request(
              `/ffvb/matches/${encodeURIComponent(reactivating.event.ffvb_match_id!)}/reactivate`,
              'POST',
              {},
              signal,
            );
            setNotice(`Vérification FFVB réactivée pour ${reactivating.event.title}.`);
            result.reload();
          }}
        >
          <p>
            La vérification FFVB de {reactivating.event.title} reprendra. Une divergence persistante
            avec le calendrier officiel sera de nouveau signalée.
          </p>
        </Confirm>
      )}
    </>
  );
}
