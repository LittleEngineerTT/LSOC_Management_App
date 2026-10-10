import { Link } from 'react-router-dom';
import { ErrorNotice } from '../auth/components';
import { useRequest } from '../auth/useRequest';
import { useAdmin } from './data';
import type { Team } from './types';

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

export function SourceWarnings() {
  const { catalog } = useAdmin();
  const missing = catalog.teams.filter(
    (team) =>
      !team.ffvb_source_warning_ignored &&
      !catalog.sources.some((source) => source.team_id === team.id),
  );
  if (!missing.length) return null;
  return (
    <section className="admin-notice" aria-label="Équipes sans source FFVB">
      <h3>Sources FFVB manquantes</h3>
      {missing.map((team) => (
        <div key={team.id} className="admin-row">
          <p className="admin-row-copy">Aucune source FFVB créée pour l’équipe {team.name}.</p>
          <div className="admin-actions">
            <Link className="admin-button" to="?tab=ffvb">
              Créer une source
            </Link>
            <TeamSourceWarningPreference team={team} ignored={false} />
          </div>
        </div>
      ))}
    </section>
  );
}
