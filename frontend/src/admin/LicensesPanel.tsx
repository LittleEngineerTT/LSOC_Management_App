import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { ErrorNotice } from '../auth/components';
import { useDialogBackdropDismiss } from '../app/useDialogBackdropDismiss';
import { useSession } from '../auth/session';
import { TeamOptions } from '../club/teamOrder';
import { useAdmin, useResource } from './data';
import { dateLabel } from './time';
import { Badge, Confirm, Empty, LoadState, Notice, PanelHeading } from './ui';

export type LicenseStatus = 'none' | 'in_progress' | 'payment_pending' | 'active';
type Kind = 'player' | 'coach';
export interface License {
  user_id: string;
  first_name: string;
  username: string | null;
  /** Numéro de la licence joueur, qui sert d’identifiant au compte. */
  number: string | null;
  status: LicenseStatus;
  /** Numéro de la licence coach, éventuellement le même ; absent d’une API antérieure. */
  coach_number?: string | null;
  coach_status: LicenseStatus;
  updated_at: string | null;
  teams: { team_id: string; kind: Kind }[];
  coach: boolean;
  missing: boolean;
  /** URL publique du PDF, lue directement dans le stockage S3. */
  file_url?: string | null;
  file_uploaded_at?: string | null;
  /** PDF de la licence coach. */
  coach_file_url?: string | null;
  coach_file_uploaded_at?: string | null;
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

// Chaque licence a son numéro et son PDF.
const numberOf = (item: License, kind: Kind) =>
  (kind === 'coach' ? item.coach_number : item.number) ?? null;
const fileOf = (item: License, kind: Kind) =>
  kind === 'coach'
    ? { url: item.coach_file_url ?? null, at: item.coach_file_uploaded_at ?? null }
    : { url: item.file_url ?? null, at: item.file_uploaded_at ?? null };
const fileLabel = (item: License, kind: Kind) => {
  const file = fileOf(item, kind);
  return file.url ? `PDF déposé${file.at ? ` le ${dateLabel(file.at)}` : ''}` : 'Aucun PDF déposé';
};
const kindLabel = (kind: Kind) => (kind === 'coach' ? 'coach' : 'joueur');
type FileTarget = { license: License; kind: Kind };

/** Gestion des licences : numéros, statuts et licences manquantes par section ou équipe. Un clic
 * sur un adhérent ouvre sa fiche, avec un onglet par licence (joueur, et coach s’il l’est). */
export function LicensesPanel() {
  const { api, catalog, reloadCatalog, admin, scope } = useAdmin();
  const accountId = useSession().account?.id;
  const [kind, setKind] = useState<Kind>('player');
  const [section, setSection] = useState('');
  const [team, setTeam] = useState('');
  const [missing, setMissing] = useState(false);
  // Fiche ouverte, par compte : elle prend la place de sa ligne dans la liste.
  const [editing, setEditing] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [viewing, setViewing] = useState<FileTarget | null>(null);
  const [removing, setRemoving] = useState<FileTarget | null>(null);
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
  function open(item: License) {
    setNotice('');
    setEditing(item.user_id);
  }
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
            // Ces boutons ne font que filtrer les adhérents affichés.
            onClick={() => {
              setKind(value);
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
            <TeamOptions teams={teams} accountId={accountId} />
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
        {rows.map((item) =>
          editing === item.user_id ? (
            <div key={item.user_id} className="user-row-card">
              <LicenseCard
                license={item}
                initialTab={kind}
                editable={admin}
                teamName={teamName}
                onView={(kind) => setViewing({ license: item, kind })}
                onRemoveFile={(kind) => setRemoving({ license: item, kind })}
                onClose={() => setEditing(null)}
                onSaved={(message) => {
                  setNotice(message);
                  setEditing(null);
                  result.reload();
                  // Le numéro de licence devient l’identifiant du compte.
                  reloadCatalog();
                }}
                onFile={(message) => {
                  setNotice(message);
                  result.reload();
                }}
              />
            </div>
          ) : (
            <article
              className="admin-row user-row"
              key={item.user_id}
              // Toute la ligne ouvre la fiche ; le bouton du nom le permet au clavier.
              onClick={(event) => {
                if (!(event.target as HTMLElement).closest('button, a, label')) open(item);
              }}
            >
              <div className="admin-row-copy">
                <h3>
                  <button type="button" className="user-row-open" onClick={() => open(item)}>
                    {item.first_name}
                  </button>
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
                  {numberOf(item, kind) ? ` N° ${numberOf(item, kind)}` : ' Sans numéro'}
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
                <p className="admin-hint">{fileLabel(item, kind)}</p>
              </div>
              {fileOf(item, kind).url && (
                <div className="admin-actions">
                  <button
                    className="admin-button"
                    aria-label={`Voir la licence${kind === 'coach' ? ' coach' : ''} de ${item.first_name}`}
                    onClick={() => setViewing({ license: item, kind })}
                  >
                    Voir licence
                  </button>
                </div>
              )}
            </article>
          ),
        )}
      </div>
      {viewing && fileOf(viewing.license, viewing.kind).url && (
        <LicenseViewer
          name={viewing.license.first_name}
          kind={viewing.kind}
          url={fileOf(viewing.license, viewing.kind).url!}
          onClose={() => setViewing(null)}
        />
      )}
      {removing && (
        <Confirm
          title={`Supprimer le PDF de la licence ${kindLabel(removing.kind)} de ${removing.license.first_name} ?`}
          label="Supprimer le PDF"
          onClose={() => setRemoving(null)}
          onConfirm={async (signal) => {
            await api.request(
              `/licenses/${encodeURIComponent(removing.license.user_id)}/file${removing.kind === 'coach' ? '?kind=coach' : ''}`,
              'DELETE',
              undefined,
              signal,
            );
            setNotice(
              `PDF de la licence ${kindLabel(removing.kind)} de ${removing.license.first_name} supprimé.`,
            );
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

/** Fiche des licences d’un adhérent : un onglet par licence (joueur, et coach pour un coach),
 * chacun avec son numéro, son PDF et son statut. Le PDF se dépose aussitôt ; numéros et statuts
 * s’enregistrent ensemble. */
function LicenseCard({
  license,
  initialTab,
  editable,
  teamName,
  onView,
  onRemoveFile,
  onClose,
  onSaved,
  onFile,
}: {
  license: License;
  initialTab: Kind;
  editable: boolean;
  teamName: (id: string) => string;
  onView: (kind: Kind) => void;
  onRemoveFile: (kind: Kind) => void;
  onClose: () => void;
  onSaved: (message: string) => void;
  onFile: (message: string) => void;
}) {
  const { api } = useAdmin();
  const id = useId();
  const kinds: Kind[] = license.coach ? ['player', 'coach'] : ['player'];
  const [tab, setTab] = useState<Kind>(kinds.includes(initialTab) ? initialTab : 'player');
  const [numbers, setNumbers] = useState<Record<Kind, string>>({
    player: license.number ?? '',
    coach: license.coach_number ?? '',
  });
  const [statuses, setStatuses] = useState<Record<Kind, LicenseStatus>>({
    player: license.status,
    coach: license.coach_status,
  });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);
  const title = `Licences de ${license.first_name}`;
  const file = fileOf(license, tab);

  async function save(event: FormEvent) {
    event.preventDefault();
    for (const kind of kinds) {
      const value = numbers[kind].trim();
      if (value && !/^[A-Za-z0-9-]+$/.test(value)) {
        setTab(kind);
        return setError('Le numéro ne contient que des lettres, des chiffres et des tirets.');
      }
      if (statuses[kind] === 'active' && !value) {
        setTab(kind);
        return setError(`Indiquez le numéro de la licence ${kindLabel(kind)} pour l’activer.`);
      }
    }
    const changed = kinds.filter((kind) => statuses[kind] !== license[field[kind]]);
    setError('');
    setPending(true);
    try {
      await api.request(`/licenses/${encodeURIComponent(license.user_id)}`, 'PUT', {
        number: numbers.player.trim() || null,
        ...(license.coach ? { coach_number: numbers.coach.trim() || null } : {}),
        ...Object.fromEntries(changed.map((kind) => [field[kind], statuses[kind]])),
      });
      onSaved(
        changed.length === 1
          ? `Licence de ${license.first_name} : ${licenseLabels[statuses[changed[0]!]]}.`
          : `Licences de ${license.first_name} enregistrées.`,
      );
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Enregistrement impossible.');
    } finally {
      setPending(false);
    }
  }

  function upload(kind: Kind, picked: File) {
    setError('');
    if (picked.type !== 'application/pdf' && !/\.pdf$/i.test(picked.name))
      return setError('La licence doit être un fichier PDF.');
    if (picked.size > MAX_FILE_BYTES) return setError('Le PDF dépasse 10 Mo.');
    setUploading(true);
    api
      .request(
        `/licenses/${encodeURIComponent(license.user_id)}/file${kind === 'coach' ? '?kind=coach' : ''}`,
        'PUT',
        picked.slice(0, picked.size, 'application/pdf'),
      )
      .then(() => onFile(`PDF de la licence ${kindLabel(kind)} de ${license.first_name} déposé.`))
      .catch((failure: unknown) =>
        setError(failure instanceof Error ? failure.message : 'Dépôt impossible.'),
      )
      .finally(() => setUploading(false));
  }

  // Libellés accessibles : la licence joueur garde ses anciens noms.
  const fileName =
    tab === 'coach' ? `licence coach de ${license.first_name}` : `licence de ${license.first_name}`;

  return (
    <section className="admin-card user-card" aria-labelledby={`${id}-title`}>
      <header className="user-card-head">
        <h3 id={`${id}-title`}>{title}</h3>
        <button type="button" className="admin-button" onClick={onClose}>
          Fermer
        </button>
      </header>
      <p className="admin-hint">
        {license.username && `${license.username} · `}
        {license.teams.length
          ? license.teams
              .map((entry) => `${teamName(entry.team_id)} (${kindLabel(entry.kind)})`)
              .join(', ')
          : 'Aucune équipe'}
      </p>
      <div className="user-card-tabs" role="tablist" aria-label={title}>
        {kinds.map((kind) => (
          <button
            key={kind}
            type="button"
            role="tab"
            id={`${id}-${kind}`}
            aria-selected={kind === tab}
            aria-controls={`${id}-panel`}
            className={kind === tab ? 'selected' : undefined}
            onClick={() => setTab(kind)}
          >
            {kind === 'coach' ? 'Licence coach' : 'Licence joueur'}
          </button>
        ))}
      </div>
      <div
        className="user-card-panel"
        role="tabpanel"
        id={`${id}-panel`}
        aria-labelledby={`${id}-${tab}`}
      >
        <p>
          <Badge tone={licenseTones[license[field[tab]]]}>
            {licenseLabels[license[field[tab]]]}
          </Badge>
          {license.updated_at && (
            <span className="admin-hint"> · mise à jour {dateLabel(license.updated_at)}</span>
          )}
        </p>
        {/* Le PDF se consulte même en lecture seule : hors du formulaire désactivé. */}
        <div
          className="admin-field license-file"
          role="group"
          aria-label={`Fichier de la ${fileName}`}
        >
          <span className="license-file-title">PDF de la licence {kindLabel(tab)}</span>
          <p className="admin-hint">{fileLabel(license, tab)}</p>
          <div className="admin-actions">
            {file.url && (
              <button
                type="button"
                className="admin-button"
                aria-label={`Voir la ${fileName}`}
                onClick={() => onView(tab)}
              >
                Voir licence
              </button>
            )}
            {editable && (
              <>
                <label className={`admin-button admin-file${uploading ? ' disabled' : ''}`}>
                  {uploading ? 'Dépôt…' : file.url ? 'Remplacer le PDF' : 'Déposer le PDF'}
                  <input
                    type="file"
                    accept="application/pdf,.pdf"
                    disabled={uploading}
                    aria-label={`PDF de la ${fileName}`}
                    onChange={(change) => {
                      const picked = change.target.files?.[0];
                      change.target.value = '';
                      if (picked) upload(tab, picked);
                    }}
                  />
                </label>
                {file.url && (
                  <button
                    type="button"
                    className="admin-button danger"
                    aria-label={`Supprimer le PDF de la ${fileName}`}
                    onClick={() => onRemoveFile(tab)}
                  >
                    Supprimer le PDF
                  </button>
                )}
              </>
            )}
          </div>
        </div>
        <form onSubmit={(event) => void save(event)} aria-label={title}>
          <fieldset disabled={!editable || pending} className="user-card-body">
            <div className="admin-fields">
              <div className="admin-field">
                <label htmlFor={`${id}-${tab}-number`}>Numéro de licence</label>
                <input
                  id={`${id}-${tab}-number`}
                  maxLength={40}
                  value={numbers[tab]}
                  onChange={(change) => setNumbers({ ...numbers, [tab]: change.target.value })}
                />
                <p className="admin-hint">
                  {tab === 'coach'
                    ? 'Propre à la licence coach, éventuellement le même que la licence joueur ; obligatoire pour l’activer.'
                    : 'Sert d’identifiant au compte ; obligatoire pour activer la licence joueur.'}
                </p>
              </div>
              <div className="admin-field">
                <label htmlFor={`${id}-${tab}-status`}>Statut</label>
                <select
                  id={`${id}-${tab}-status`}
                  value={statuses[tab]}
                  onChange={(change) =>
                    setStatuses({ ...statuses, [tab]: change.target.value as LicenseStatus })
                  }
                >
                  {/* Tout statut, « Active » compris, peut être choisi directement. */}
                  {steps[tab].map((status) => (
                    <option key={status} value={status}>
                      {licenseLabels[status]}
                    </option>
                  ))}
                </select>
                <p className="admin-hint">
                  {tab === 'coach'
                    ? 'Licence coach : pas d’étape de paiement.'
                    : '« Active » peut être choisi directement.'}
                </p>
              </div>
            </div>
            <ErrorNotice message={error} />
            {editable && (
              <div className="admin-actions user-card-actions">
                <span />
                <button type="submit" className="admin-button primary">
                  {pending ? 'Enregistrement…' : 'Enregistrer'}
                </button>
              </div>
            )}
          </fieldset>
        </form>
      </div>
    </section>
  );
}

/** Affiche le PDF directement depuis le stockage S3 public. */
function LicenseViewer({
  name,
  kind,
  url,
  onClose,
}: {
  name: string;
  kind: Kind;
  url: string;
  onClose: () => void;
}) {
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
      <h3 id={id}>{kind === 'coach' ? `Licence coach de ${name}` : `Licence de ${name}`}</h3>
      <iframe
        src={url}
        title={kind === 'coach' ? `Licence coach de ${name}` : `Licence de ${name}`}
      />
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
