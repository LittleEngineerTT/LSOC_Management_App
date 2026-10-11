import { useState } from 'react';
import { useAdmin, useResource } from './data';
import { dateLabel } from './time';
import { Badge, Empty, EntityForm, LoadState, Notice, PanelHeading, str } from './ui';

export type LicenseStatus = 'none' | 'in_progress' | 'payment_pending' | 'active';
export interface License {
  user_id: string;
  first_name: string;
  username: string | null;
  number: string | null;
  status: LicenseStatus;
  updated_at: string | null;
  teams: { team_id: string; kind: 'player' | 'coach' }[];
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
const order: LicenseStatus[] = ['none', 'in_progress', 'payment_pending', 'active'];

/** Gestion des licences : numéros, statuts et licences manquantes par section ou équipe. */
export function LicensesPanel() {
  const { api, catalog } = useAdmin();
  const [section, setSection] = useState('');
  const [team, setTeam] = useState('');
  const [missing, setMissing] = useState(false);
  const [editing, setEditing] = useState<License | null>(null);
  const [notice, setNotice] = useState('');
  const query = new URLSearchParams();
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
        description="Numéros et statuts des licences. Une licence manque pour un joueur rattaché à une équipe tant qu’elle n’est pas active."
      />
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
            order.map((status) => {
              const count = rows.filter((item) => item.status === status).length;
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
          title={`Licence de ${editing.first_name}`}
          fields={[
            {
              name: 'number',
              label: 'Numéro de licence',
              maxLength: 40,
              pattern: '[A-Za-z0-9\\-]+',
              hint: 'Obligatoire pour une licence active. Lettres, chiffres et tirets.',
            },
            {
              name: 'status',
              label: 'Statut',
              type: 'select',
              required: true,
              // « Active » n’est proposé qu’après « Paiement en attente ».
              options: order
                .filter(
                  (status) =>
                    status !== 'active' ||
                    editing.status === 'payment_pending' ||
                    editing.status === 'active',
                )
                .map((status) => ({ value: status, label: licenseLabels[status] })),
              hint: 'Étapes : en cours, paiement en attente, puis active.',
            },
          ]}
          initial={{ number: editing.number ?? '', status: editing.status }}
          onCancel={() => setEditing(null)}
          onSave={async (values, signal) => {
            const status = str(values, 'status') as LicenseStatus;
            if (status === 'active' && !str(values, 'number'))
              throw new Error('Indiquez le numéro de licence pour l’activer.');
            await api.request(
              `/licenses/${editing.user_id}`,
              'PUT',
              { number: str(values, 'number') || null, status },
              signal,
            );
            setNotice(`Licence de ${editing.first_name} : ${licenseLabels[status]}.`);
            setEditing(null);
            result.reload();
          }}
        />
      )}
      {result.loaded && !rows.length && (
        <Empty>{missing ? 'Aucune licence manquante.' : 'Aucun adhérent dans ce périmètre.'}</Empty>
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
                <Badge tone={licenseTones[item.status]}>{licenseLabels[item.status]}</Badge>
                {item.missing && <Badge tone="danger">Licence manquante</Badge>}
                {item.number ? ` N° ${item.number}` : ' Sans numéro'}
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
