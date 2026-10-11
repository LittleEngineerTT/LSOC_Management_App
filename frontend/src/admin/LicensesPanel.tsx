import { useState } from 'react';
import { useAdmin, useResource } from './data';
import { dateLabel } from './time';
import { Badge, Empty, EntityForm, LoadState, Notice, PanelHeading, str } from './ui';

export type LicenseStatus = 'none' | 'in_progress' | 'payment_pending' | 'active';
type Kind = 'player' | 'coach';
export interface License {
  user_id: string;
  first_name: string;
  username: string | null;
  /** Numéro unique de la personne, commun aux licences joueur et coach. */
  number: string | null;
  status: LicenseStatus;
  coach_status: LicenseStatus;
  updated_at: string | null;
  teams: { team_id: string; kind: Kind }[];
  coach: boolean;
  missing: boolean;
}

export const licenseLabels: Record<LicenseStatus, string> = {
  none: 'Pas de licence',
  in_progress: 'En cours',
  payment_pending: 'Paiement en attente',
  active: 'Active',
};
export const licenseTones: Record<LicenseStatus, string> = {
  none: 'danger',
  in_progress: 'warning',
  payment_pending: 'warning',
  active: 'good',
};
// La licence coach n’a pas d’étape de paiement.
const steps: Record<Kind, LicenseStatus[]> = {
  player: ['none', 'in_progress', 'payment_pending', 'active'],
  coach: ['none', 'in_progress', 'active'],
};
const field: Record<Kind, 'status' | 'coach_status'> = { player: 'status', coach: 'coach_status' };

/** Gestion des licences : numéros, statuts et licences manquantes par section ou équipe. */
export function LicensesPanel() {
  const { api, catalog, reloadCatalog } = useAdmin();
  const [kind, setKind] = useState<Kind>('player');
  const [section, setSection] = useState('');
  const [team, setTeam] = useState('');
  const [missing, setMissing] = useState(false);
  const [editing, setEditing] = useState<License | null>(null);
  const [notice, setNotice] = useState('');
  const query = new URLSearchParams();
  if (kind === 'coach') query.set('kind', 'coach');
  if (section) query.set('section_id', section);
  if (team) query.set('team_id', team);
  if (missing) query.set('missing', 'true');
  const result = useResource<License>(`/licenses${query.size ? `?${query}` : ''}`);
  const teams = catalog.teams.filter((item) => !section || item.section_id === section);
  const teamName = (id: string) => catalog.teams.find((item) => item.id === id)?.name ?? 'Équipe';
  const rows = result.data ?? [];
  const missingCount = rows.filter((item) => item.missing).length;
  return (
    <>
      <PanelHeading
        title="Licences"
        description="Un numéro par personne, commun à ses licences joueur et coach. Une licence manque pour un joueur ou un coach rattaché à une équipe tant qu’elle n’est pas active."
      />
      <div className="admin-subtabs" role="group" aria-label="Type de licence">
        {(['player', 'coach'] as const).map((value) => (
          <button
            key={value}
            className={`admin-button${kind === value ? ' selected' : ''}`}
            aria-pressed={kind === value}
            onClick={() => {
              setKind(value);
              setEditing(null);
              setNotice('');
            }}
          >
            {value === 'player' ? 'Joueurs' : 'Coachs'}
          </button>
        ))}
      </div>
      <div className="admin-toolbar">
        <label>
          Section
          <select
            value={section}
            onChange={(change) => {
              setSection(change.target.value);
              setTeam('');
            }}
          >
            <option value="">Toutes les sections</option>
            {catalog.sections.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Équipe
          <select value={team} onChange={(change) => setTeam(change.target.value)}>
            <option value="">Toutes les équipes</option>
            {teams.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <label className="admin-check">
          <input
            type="checkbox"
            checked={missing}
            onChange={(change) => setMissing(change.target.checked)}
          />
          Licences manquantes uniquement
        </label>
      </div>
      {result.data && (
        <p className="admin-license-summary" aria-live="polite">
          <strong>{missingCount}</strong> licence{missingCount > 1 ? 's' : ''} manquante
          {missingCount > 1 ? 's' : ''}
          {!missing &&
            steps[kind].map((status) => {
              const count = rows.filter((item) => item[field[kind]] === status).length;
              return count ? (
                <span key={status}>
                  {' · '}
                  {count} {licenseLabels[status].toLowerCase()}
                </span>
              ) : null;
            })}
        </p>
      )}
      {notice && <Notice>{notice}</Notice>}
      <LoadState result={result} />
      {editing && (
        <EntityForm
          key={editing.user_id}
          title={`Licence ${kind === 'coach' ? 'coach' : 'joueur'} de ${editing.first_name}`}
          fields={[
            {
              name: 'number',
              label: 'Numéro de licence',
              maxLength: 40,
              pattern: '[A-Za-z0-9\\-]+',
              hint: 'Commun aux licences joueur et coach ; obligatoire pour une licence active.',
            },
            {
              name: 'status',
              label: 'Statut',
              type: 'select',
              required: true,
              // Tout statut, « Active » compris, peut être choisi directement.
              options: steps[kind].map((status) => ({
                value: status,
                label: licenseLabels[status],
              })),
              hint:
                kind === 'coach'
                  ? 'Licence coach : pas d’étape de paiement. « Active » exige un numéro.'
                  : '« Active » peut être choisi directement ; un numéro de licence est alors requis.',
            },
          ]}
          initial={{ number: editing.number ?? '', status: editing[field[kind]] }}
          onCancel={() => setEditing(null)}
          onSave={async (values, signal) => {
            const status = str(values, 'status') as LicenseStatus;
            if (status === 'active' && !str(values, 'number'))
              throw new Error('Indiquez le numéro de licence pour l’activer.');
            await api.request(
              `/licenses/${editing.user_id}`,
              'PUT',
              { number: str(values, 'number') || null, [field[kind]]: status },
              signal,
            );
            setNotice(`Licence de ${editing.first_name} : ${licenseLabels[status]}.`);
            setEditing(null);
            result.reload();
            // Le numéro de licence devient l’identifiant du compte.
            reloadCatalog();
          }}
        />
      )}
      {result.loaded && !rows.length && (
        <Empty>
          {missing
            ? 'Aucune licence manquante.'
            : kind === 'coach'
              ? 'Aucun coach dans ce périmètre.'
              : 'Aucun adhérent dans ce périmètre.'}
        </Empty>
      )}
      <div className="admin-list">
        {rows.map((item) => (
          <article className="admin-row" key={item.user_id}>
            <div className="admin-row-copy">
              <h3>
                {item.first_name}
                {item.username && <span className="admin-hint"> · {item.username}</span>}
              </h3>
              <p>
                {item.teams.length
                  ? item.teams
                      .map(
                        (entry) =>
                          `${teamName(entry.team_id)} (${entry.kind === 'coach' ? 'coach' : 'joueur'})`,
                      )
                      .join(', ')
                  : 'Aucune équipe'}
              </p>
              <p>
                <Badge tone={licenseTones[item[field[kind]]]}>
                  {licenseLabels[item[field[kind]]]}
                </Badge>
                {item.missing && <Badge tone="danger">Licence manquante</Badge>}
                {item.number ? ` N° ${item.number}` : ' Sans numéro'}
                {kind === 'player' && item.coach && (
                  <span className="admin-hint">
                    {' · '}licence coach : {licenseLabels[item.coach_status].toLowerCase()}
                  </span>
                )}
                {kind === 'coach' && (
                  <span className="admin-hint">
                    {' · '}licence joueur : {licenseLabels[item.status].toLowerCase()}
                  </span>
                )}
                {item.updated_at && (
                  <span className="admin-hint"> · mise à jour {dateLabel(item.updated_at)}</span>
                )}
              </p>
            </div>
            <div className="admin-actions">
              <button
                className="admin-button"
                onClick={() => {
                  setNotice('');
                  setEditing(item);
                }}
              >
                Gérer la licence
              </button>
            </div>
          </article>
        ))}
      </div>
    </>
  );
}
