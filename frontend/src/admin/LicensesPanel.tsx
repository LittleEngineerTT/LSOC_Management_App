import { useEffect, useId, useRef, useState } from 'react';
import { ErrorNotice } from '../auth/components';
import { useDialogBackdropDismiss } from '../app/useDialogBackdropDismiss';
import { useAdmin, useResource } from './data';
import { dateLabel } from './time';
import { Badge, Confirm, Empty, EntityForm, LoadState, Notice, PanelHeading, str } from './ui';

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
  /** URL publique du PDF, lue directement dans le stockage S3. */
  file_url?: string | null;
  file_uploaded_at?: string | null;
}
const MAX_FILE_BYTES = 10 * 1024 * 1024;

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
  const { api, catalog, reloadCatalog, admin, scope } = useAdmin();
  const [kind, setKind] = useState<Kind>('player');
  const [section, setSection] = useState('');
  const [team, setTeam] = useState('');
  const [missing, setMissing] = useState(false);
  const [editing, setEditing] = useState<License | null>(null);
  const [notice, setNotice] = useState('');
  const [viewing, setViewing] = useState<License | null>(null);
  const [removing, setRemoving] = useState<License | null>(null);
  const [uploading, setUploading] = useState('');
  const [uploadError, setUploadError] = useState('');
  const query = new URLSearchParams();
  if (kind === 'coach') query.set('kind', 'coach');
  if (section) query.set('section_id', section);
  if (team) query.set('team_id', team);
  if (missing) query.set('missing', 'true');
  const result = useResource<License>(`/licenses${query.size ? `?${query}` : ''}`);
  // Un coach ne filtre que parmi ses équipes et leurs sections.
  const reachable = catalog.teams.filter((item) => !scope || scope.includes(item.id));
  const sections = catalog.sections.filter((item) =>
    reachable.some((team) => team.section_id === item.id),
  );
  const teams = reachable.filter((item) => !section || item.section_id === section);
  const teamName = (id: string) => catalog.teams.find((item) => item.id === id)?.name ?? 'Équipe';
  const rows = result.data ?? [];
  const missingCount = rows.filter((item) => item.missing).length;
  return (
    <>
      <PanelHeading
        title="Licences"
        description={
          admin
            ? 'Un numéro par personne, commun à ses licences joueur et coach. Une licence manque pour un joueur ou un coach rattaché à une équipe tant qu’elle n’est pas active.'
            : 'Licences des équipes dont vous êtes référent ou coach, en consultation seule.'
        }
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
            {sections.map((item) => (
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
      <ErrorNotice message={uploadError} />
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
          {admin || scope?.length
            ? missing
              ? 'Aucune licence manquante.'
              : kind === 'coach'
                ? 'Aucun coach dans ce périmètre.'
                : 'Aucun adhérent dans ce périmètre.'
            : 'Vous n’êtes référent ou coach d’aucune équipe.'}
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
              <p className="admin-hint">
                {item.file_url
                  ? `PDF déposé${item.file_uploaded_at ? ` le ${dateLabel(item.file_uploaded_at)}` : ''}`
                  : 'Aucun PDF déposé'}
              </p>
            </div>
            <div className="admin-actions">
              {item.file_url && (
                <button
                  className="admin-button"
                  aria-label={`Voir la licence de ${item.first_name}`}
                  onClick={() => setViewing(item)}
                >
                  Voir licence
                </button>
              )}
              {admin && (
                <>
                  <label
                    className={`admin-button admin-file${uploading ? ' disabled' : ''}`}
                    aria-disabled={uploading ? true : undefined}
                  >
                    {uploading === item.user_id
                      ? 'Dépôt…'
                      : item.file_url
                        ? 'Remplacer le PDF'
                        : 'Déposer le PDF'}
                    <input
                      type="file"
                      accept="application/pdf,.pdf"
                      disabled={Boolean(uploading)}
                      aria-label={`PDF de la licence de ${item.first_name}`}
                      onChange={(change) => {
                        const file = change.target.files?.[0];
                        change.target.value = '';
                        if (!file) return;
                        setNotice('');
                        setUploadError('');
                        if (file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name)) {
                          setUploadError('La licence doit être un fichier PDF.');
                          return;
                        }
                        if (file.size > MAX_FILE_BYTES) {
                          setUploadError('Le PDF dépasse 10 Mo.');
                          return;
                        }
                        setUploading(item.user_id);
                        api
                          .request(
                            `/licenses/${encodeURIComponent(item.user_id)}/file`,
                            'PUT',
                            file.slice(0, file.size, 'application/pdf'),
                          )
                          .then(() => {
                            setNotice(`PDF de la licence de ${item.first_name} déposé.`);
                            result.reload();
                          })
                          .catch((error: unknown) =>
                            setUploadError(
                              error instanceof Error ? error.message : 'Dépôt impossible.',
                            ),
                          )
                          .finally(() => setUploading(''));
                      }}
                    />
                  </label>
                  {item.file_url && (
                    <button
                      className="admin-button danger"
                      aria-label={`Supprimer le PDF de ${item.first_name}`}
                      onClick={() => setRemoving(item)}
                    >
                      Supprimer le PDF
                    </button>
                  )}
                  <button
                    className="admin-button"
                    onClick={() => {
                      setNotice('');
                      setEditing(item);
                    }}
                  >
                    Gérer la licence
                  </button>
                </>
              )}
            </div>
          </article>
        ))}
      </div>
      {viewing?.file_url && (
        <LicenseViewer
          name={viewing.first_name}
          url={viewing.file_url}
          onClose={() => setViewing(null)}
        />
      )}
      {removing && (
        <Confirm
          title={`Supprimer le PDF de ${removing.first_name} ?`}
          label="Supprimer le PDF"
          onClose={() => setRemoving(null)}
          onConfirm={async (signal) => {
            await api.request(
              `/licenses/${encodeURIComponent(removing.user_id)}/file`,
              'DELETE',
              undefined,
              signal,
            );
            setNotice(`PDF de la licence de ${removing.first_name} supprimé.`);
            result.reload();
          }}
        >
          <p>
            Le fichier est effacé du stockage. Le statut et le numéro de licence ne changent pas.
          </p>
        </Confirm>
      )}
    </>
  );
}

/** Affiche le PDF directement depuis le stockage S3 public. */
function LicenseViewer({ name, url, onClose }: { name: string; url: string; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const backdropDismiss = useDialogBackdropDismiss(onClose);
  const id = useId();
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  return (
    <dialog
      ref={dialog}
      {...backdropDismiss}
      className="admin-dialog license-viewer"
      aria-labelledby={id}
      onCancel={onClose}
    >
      <h3 id={id}>Licence de {name}</h3>
      <iframe src={url} title={`Licence de ${name}`} />
      <div className="admin-actions">
        <a className="admin-button" href={url} target="_blank" rel="noreferrer">
          Ouvrir dans un nouvel onglet
        </a>
        <button type="button" className="admin-button primary" autoFocus onClick={onClose}>
          Fermer
        </button>
      </div>
    </dialog>
  );
}
