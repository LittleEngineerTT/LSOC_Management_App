import { useCallback, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { ErrorNotice } from '../auth/components';
import { useRequest } from '../auth/useRequest';
import { useLoad } from '../admin/data';
import { dateLabel } from '../admin/time';
import {
  Badge,
  checked,
  Confirm,
  EntityForm,
  LoadState,
  Notice,
  PanelHeading,
  str,
  type FormValues,
} from '../admin/ui';
import { useClub } from './context';

export type DocumentKind = 'medical_certificate' | 'identity' | 'reduction_proof' | 'other';
type DocumentStatus = 'requested' | 'submitted' | 'validated' | 'rejected';
export interface Dossier {
  id: string;
  user_id: string;
  first_name: string;
  opened_by: string | null;
  note: string;
  payment_requested: boolean;
  payment_validated_at: string | null;
  created_at: string;
  closed_at: string | null;
  documents: DossierDocument[];
}
interface DossierDocument {
  id: string;
  kind: DocumentKind;
  /** Nom d’une pièce « Autre ». */
  label: string;
  status: DocumentStatus;
  file_name: string | null;
  uploaded_at: string | null;
  decision: string;
  /** Le fichier disparaît à la clôture du dossier. */
  has_file: boolean;
}

export const documentLabels: Record<Exclude<DocumentKind, 'other'>, string> = {
  medical_certificate: 'Certificat médical',
  identity: 'Carte d’identité ou passeport',
  reduction_proof: 'Justificatif de réduction',
};
const documentHints: Record<DocumentKind, string> = {
  medical_certificate: '',
  identity: '',
  reduction_proof: 'QR code ou code de réduction, en image ou en PDF.',
  other: '',
};
/** Nom d’une pièce : le libellé choisi pour une pièce « Autre ». */
export const pieceName = (item: { kind: DocumentKind; label?: string }) =>
  item.kind === 'other' ? (item.label ?? 'Autre pièce') : documentLabels[item.kind];
const statusLabels: Record<DocumentStatus, { label: string; tone: string }> = {
  requested: { label: 'À déposer', tone: 'warning' },
  submitted: { label: 'Déposée, en vérification', tone: '' },
  validated: { label: 'Validée', tone: 'good' },
  rejected: { label: 'À déposer de nouveau', tone: 'danger' },
};
const ACCEPT = 'application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png';
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const fileUrl = (dossier: Dossier, item: DossierDocument) =>
  `/api/v1/dossiers/${dossier.id}/documents/${item.id}/file`;

/** Étapes terminées sur étapes demandées : pièces validées et paiement reçu. */
export function progress(dossier: Dossier): [number, number] {
  const done =
    dossier.documents.filter((item) => item.status === 'validated').length +
    (dossier.payment_validated_at ? 1 : 0);
  return [done, dossier.documents.length + (dossier.payment_requested ? 1 : 0)];
}

/** Pièces voulues dans un formulaire : cases prédéfinies et pièce « Autre » nommée. */
function requestedDocuments(values: FormValues) {
  const documents: { kind: DocumentKind; label?: string }[] = (
    Array.isArray(values.documents) ? values.documents : []
  ).map((kind) => ({ kind: kind as DocumentKind }));
  if (checked(values, 'other')) {
    const label = str(values, 'other_label');
    if (!label) throw new Error('Nommez la pièce « Autre ».');
    documents.push({ kind: 'other', label });
  }
  return documents;
}

/** Demande de pièces à un joueur.
 *
 * Un administrateur ouvre ou complète directement son dossier ; un coach adresse la demande
 * aux administrateurs, qui l’acceptent ou la refusent.
 */
export function DossierRequestForm({
  user,
  dossier,
  onDone,
  onCancel,
}: {
  user: { user_id: string; first_name: string };
  dossier: Dossier | undefined;
  onDone: (message: string) => void;
  onCancel: () => void;
}) {
  const { api, admin } = useClub();
  const present = new Set(dossier?.documents.map((item) => item.kind));
  const kinds = (Object.keys(documentLabels) as Exclude<DocumentKind, 'other'>[]).filter(
    (kind) => !present.has(kind),
  );
  return (
    <EntityForm
      title={
        admin
          ? dossier
            ? `Compléter le dossier de ${user.first_name}`
            : `Dossier de ${user.first_name}`
          : `Demander des pièces pour ${user.first_name}`
      }
      fields={[
        {
          name: 'documents',
          label: 'Pièces à déposer par le joueur',
          type: 'choices',
          options: kinds.map((kind) => ({ value: kind, label: documentLabels[kind] })),
          hint: 'Chaque étape est facultative.',
        },
        { name: 'other', label: 'Autre pièce', type: 'checkbox' },
        {
          name: 'other_label',
          label: 'Nom de la pièce',
          maxLength: 120,
          visibleWhen: 'other',
        },
        ...(admin && !dossier?.payment_requested
          ? [
              {
                name: 'payment',
                label: 'Paiement à régler auprès du club',
                type: 'checkbox' as const,
                hint: 'Le paiement se fait hors de la plateforme ; un administrateur valide sa réception.',
              },
            ]
          : []),
        {
          name: 'note',
          label: admin ? 'Message au joueur (facultatif)' : 'Description (facultative)',
          type: 'textarea' as const,
          maxLength: 2000,
          hint: admin
            ? undefined
            : 'Lue par les administrateurs, qui transmettront la demande au joueur.',
        },
      ]}
      initial={{ documents: [], other: false, other_label: '', payment: false, note: '' }}
      submit={
        admin
          ? dossier
            ? 'Ajouter au dossier'
            : 'Envoyer la demande'
          : 'Envoyer aux administrateurs'
      }
      onCancel={onCancel}
      onSave={async (values, signal) => {
        const documents = requestedDocuments(values);
        const payment = checked(values, 'payment');
        if (!documents.length && !payment)
          throw new Error('Choisissez au moins une pièce ou le paiement.');
        if (admin) {
          await api.request(
            '/dossiers',
            'POST',
            { user_id: user.user_id, documents, payment, note: str(values, 'note') },
            signal,
          );
          onDone(`Demande envoyée à ${user.first_name}.`);
        } else {
          await api.request(
            '/requests',
            'POST',
            {
              kind: 'document',
              player_id: user.user_id,
              documents,
              description: str(values, 'note'),
            },
            signal,
          );
          onDone(`Demande transmise aux administrateurs pour ${user.first_name}.`);
        }
      }}
    />
  );
}

/** Dossier vu par l’administration ou un coach ; seuls les administrateurs ouvrent les pièces. */
export function DossierCard({
  dossier,
  onChanged,
}: {
  dossier: Dossier;
  onChanged: (message: string) => void;
}) {
  const { api, admin } = useClub();
  const request = useRequest();
  const [rejecting, setRejecting] = useState<DossierDocument | null>(null);
  const [closing, setClosing] = useState(false);
  function act(path: string, body: object, message: string) {
    void request.run(async (signal) => {
      await api.request(`/dossiers/${dossier.id}${path}`, 'POST', body, signal);
      onChanged(message);
    });
  }
  const [done, total] = progress(dossier);
  return (
    <div className="club-dossier">
      <p className="admin-hint">
        Dossier ouvert le {dateLabel(dossier.created_at)} · étapes terminées : {done}/{total}
        {dossier.note && ` · « ${dossier.note} »`}
      </p>
      <ul className="club-plain-list club-participants">
        {dossier.documents.map((item) => (
          <li key={item.id}>
            <span>
              {pieceName(item)}
              {item.uploaded_at && ` · déposée le ${dateLabel(item.uploaded_at)}`}
            </span>
            <span className="admin-actions">
              <Badge tone={statusLabels[item.status].tone}>{statusLabels[item.status].label}</Badge>
              {admin && item.has_file && (
                <a className="admin-button" href={fileUrl(dossier, item)} download>
                  Ouvrir
                </a>
              )}
              {admin && item.status === 'submitted' && (
                <>
                  <button
                    type="button"
                    className="admin-button"
                    disabled={request.pending}
                    onClick={() =>
                      act(
                        `/documents/${item.id}/decision`,
                        { accept: true, reason: '' },
                        `${pieceName(item)} validé.`,
                      )
                    }
                  >
                    Valider
                  </button>
                  <button
                    type="button"
                    className="admin-button danger"
                    disabled={request.pending}
                    onClick={() => setRejecting(item)}
                  >
                    Refuser
                  </button>
                </>
              )}
            </span>
          </li>
        ))}
        {dossier.payment_requested && (
          <li>
            <span>Paiement, réglé hors de la plateforme</span>
            <span className="admin-actions">
              <Badge tone={dossier.payment_validated_at ? 'good' : 'warning'}>
                {dossier.payment_validated_at
                  ? `Reçu le ${dateLabel(dossier.payment_validated_at)}`
                  : 'En attente'}
              </Badge>
              {admin && !dossier.payment_validated_at && (
                <button
                  type="button"
                  className="admin-button"
                  disabled={request.pending}
                  onClick={() => act('/payment', {}, 'Paiement validé.')}
                >
                  Valider le paiement
                </button>
              )}
            </span>
          </li>
        )}
      </ul>
      {admin && (
        <div className="admin-actions">
          <button
            type="button"
            className="admin-button"
            disabled={request.pending}
            onClick={() => setClosing(true)}
          >
            Clore le dossier
          </button>
        </div>
      )}
      {request.error && <ErrorNotice message={request.error} />}
      {rejecting && (
        <EntityForm
          title={`Refuser : ${pieceName(rejecting)}`}
          fields={[
            {
              name: 'reason',
              label: 'Motif, transmis au joueur',
              type: 'textarea',
              required: true,
              maxLength: 2000,
            },
          ]}
          initial={{ reason: '' }}
          submit="Refuser la pièce"
          onCancel={() => setRejecting(null)}
          onSave={async (values, signal) => {
            await api.request(
              `/dossiers/${dossier.id}/documents/${rejecting.id}/decision`,
              'POST',
              { accept: false, reason: str(values, 'reason') },
              signal,
            );
            setRejecting(null);
            onChanged(`${pieceName(rejecting)} refusé ; le joueur est prévenu.`);
          }}
        />
      )}
      {closing && (
        <Confirm
          title="Clore le dossier"
          label="Clore"
          onClose={() => setClosing(false)}
          onConfirm={async (signal) => {
            await api.request(`/dossiers/${dossier.id}/close`, 'POST', {}, signal);
            onChanged(`Dossier de ${dossier.first_name} clos.`);
          }}
        >
          <p>
            Les fichiers déposés seront définitivement effacés ; seul l’état des pièces est
            conservé. {dossier.first_name} n’aura plus accès à l’application Inscriptions.
          </p>
        </Confirm>
      )}
    </div>
  );
}

/** Application Inscriptions d’un joueur : son dossier en cours et le dépôt des pièces. */
export function MyDossier({ embedded = false }: { embedded?: boolean }) {
  const { api } = useClub();
  const loader = useCallback(
    (signal: AbortSignal) => api.request<Dossier | null>('/dossiers/me', 'GET', undefined, signal),
    [api],
  );
  const result = useLoad(loader);
  const [uploading, setUploading] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const dossier = result.data;
  // Sans dossier en cours, l’application reste fermée au joueur.
  if (!embedded && result.loaded && !result.error && !dossier?.id)
    return <Navigate to="/app" replace />;
  function send(item: DossierDocument, file: File) {
    setError('');
    setNotice('');
    if (!ACCEPT.split(',').includes(file.type)) {
      setError('Déposez un fichier PDF, JPEG ou PNG.');
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      setError('Le fichier dépasse 10 Mo.');
      return;
    }
    setUploading(item.id);
    api
      .request(`/dossiers/${dossier!.id}/documents/${item.id}/file`, 'PUT', file)
      .then(() => {
        setNotice(`${pieceName(item)} déposé.`);
        result.reload();
      })
      .catch((reason: unknown) =>
        setError(reason instanceof Error ? reason.message : 'Dépôt impossible.'),
      )
      .finally(() => setUploading(null));
  }
  const [done, total] = dossier?.id ? progress(dossier) : [0, 0];
  return (
    <>
      <PanelHeading
        title="Mon inscription"
        description="Les pièces que le club vous demande et l’avancée de votre dossier."
      />
      <LoadState result={result} />
      {notice && <Notice>{notice}</Notice>}
      <ErrorNotice message={error} />
      {dossier?.id && (
        <section className="admin-card club-dossier">
          <h3>
            Étapes terminées : {done}/{total}
          </h3>
          {dossier.note && <p>Message du club : {dossier.note}</p>}
          <ul className="club-plain-list club-participants">
            {dossier.documents.map((item) => (
              <li key={item.id}>
                <span>
                  <strong>{pieceName(item)}</strong>
                  {documentHints[item.kind] && (
                    <span className="admin-hint"> · {documentHints[item.kind]}</span>
                  )}
                </span>
                <span className="admin-actions">
                  <Badge tone={statusLabels[item.status].tone}>
                    {statusLabels[item.status].label}
                  </Badge>
                  {item.has_file && (
                    <a className="admin-button" href={fileUrl(dossier, item)} download>
                      Voir mon fichier
                    </a>
                  )}
                  {item.status !== 'validated' && (
                    <label className="admin-button">
                      {uploading === item.id
                        ? 'Envoi…'
                        : item.has_file
                          ? 'Remplacer le fichier'
                          : 'Déposer un fichier'}
                      <input
                        type="file"
                        className="visually-hidden"
                        accept={ACCEPT}
                        disabled={uploading !== null}
                        aria-label={`Fichier : ${pieceName(item)}`}
                        onChange={(change) => {
                          const file = change.target.files?.[0];
                          change.target.value = '';
                          if (file) send(item, file);
                        }}
                      />
                    </label>
                  )}
                </span>
                {item.status === 'rejected' && item.decision && (
                  <p className="club-dossier-reason">Motif : {item.decision}</p>
                )}
              </li>
            ))}
            {dossier.payment_requested && (
              <li>
                <span>
                  <strong>Paiement</strong>
                  <span className="admin-hint">
                    {' '}
                    · à régler auprès du club ; un administrateur valide sa réception.
                  </span>
                </span>
                <Badge tone={dossier.payment_validated_at ? 'good' : 'warning'}>
                  {dossier.payment_validated_at
                    ? `Reçu le ${dateLabel(dossier.payment_validated_at)}`
                    : 'En attente'}
                </Badge>
              </li>
            )}
          </ul>
        </section>
      )}
    </>
  );
}
