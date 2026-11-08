import { ErrorNotice } from '../auth/components';
import { useRequest } from '../auth/useRequest';
import { useAdmin } from './data';
import type { Catalog, Team } from './types';

/** Équipes sans source FFVB dont l’avertissement n’a pas été ignoré : sources à configurer. */
export function missingSources(catalog: Pick<Catalog, 'teams' | 'sources'>): Team[] {
  return catalog.teams.filter(
    (team) =>
      !team.ffvb_source_warning_ignored &&
      !catalog.sources.some((source) => source.team_id === team.id),
  );
}

export function TeamSourceWarningPreference({ team, ignored }: { team: Team; ignored: boolean }) {
  const { api, reloadCatalog } = useAdmin();
  const request = useRequest();
  return (
    <>
      <button
        className="admin-button"
        disabled={request.pending}
        aria-label={
          ignored ? `Réactiver l’avertissement pour ${team.name}` : `Ignorer pour ${team.name}`
        }
        onClick={() =>
          void request.run(async (signal) => {
            await api.request(
              `/teams/${team.id}/ffvb-warning`,
              'PUT',
              { ignored: !ignored },
              signal,
            );
            reloadCatalog();
          })
        }
      >
        {ignored ? 'Réactiver l’avertissement' : 'Ignorer cet avertissement'}
      </button>
      <ErrorNotice message={request.error} />
    </>
  );
}

/** Encadrés des sources FFVB manquantes, affichés dans l’onglet FFVB seulement ; « Créer une
 * source » ouvre la sous-vue Sources. */
export function SourceWarnings({ onCreate }: { onCreate: () => void }) {
  const { catalog } = useAdmin();
  const missing = missingSources(catalog);
  if (!missing.length) return null;
  return (
    <section className="admin-notice" aria-label="Équipes sans source FFVB">
      <h3>Sources FFVB manquantes</h3>
      {missing.map((team) => (
        <div key={team.id} className="admin-row">
          <p className="admin-row-copy">Aucune source FFVB créée pour l’équipe {team.name}.</p>
          <div className="admin-actions">
            <button type="button" className="admin-button" onClick={onCreate}>
              Créer une source
            </button>
            <TeamSourceWarningPreference team={team} ignored={false} />
          </div>
        </div>
      ))}
    </section>
  );
}
