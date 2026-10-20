import { useCallback, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { ErrorNotice } from '../auth/components';
import { useRequest } from '../auth/useRequest';
import { useLoad } from '../admin/data';
import { dateLabel } from '../admin/time';
import { Badge, Confirm, EntityForm, LoadState, Notice, PanelHeading, str } from '../admin/ui';
import { useClub } from './context';

export type DocumentKind = 'medical_certificate' | 'identity' | 'reduction_proof';
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
  documents: {
    kind: DocumentKind;
    status: DocumentStatus;
    file_name: string | null;
    uploaded_at: string | null;
    decision: string;
    /** Le fichier disparaît à la clôture du dossier. */
    has_file: boolean;
  }[];
}

export const documentLabels: Record<DocumentKind, string> = {
  medical_certificate: 'Certificat médical',
  identity: 'Carte d’identité ou passeport',
  reduction_proof: 'Justificatif de réduction',
};
const documentHints: Record<DocumentKind, string> = {
  medical_certificate: '',
  identity: '',
  reduction_proof: 'QR code ou code de réduction, en image ou en PDF.',
};
const statusLabels: Record<DocumentStatus, { label: string; tone: string }> = {
  requested: { label: 'À déposer', tone: 'warning' },
  submitted: { label: 'Déposée, en vérification', tone: '' },
  validated: { label: 'Validée', tone: 'good' },
  rejected: { label: 'À déposer de nouveau', tone: 'danger' },
};
const ACCEPT = 'application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png';
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const fileUrl = (dossier: Dossier, kind: DocumentKind) =>
  `/api/v1/dossiers/${dossier.id}/documents/${kind}/file`;

/** Étapes terminées sur étapes demandées : pièces validées et paiement reçu. */
export function progress(dossier: Dossier): [number, number] {
  const done =
    dossier.documents.filter((item) => item.status === 'validated').length +
    (dossier.payment_validated_at ? 1 : 0);
  return [done, dossier.documents.length + (dossier.payment_requested ? 1 : 0)];
}

/** Demande de pièces : ouvre un dossier, ou ajoute des étapes au dossier en cours. */
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
  const { api } = useClub();
  const present = new Set(dossier?.documents.map((item) => item.kind));
  const kinds = (Object.keys(documentLabels) as DocumentKind[]).filter(
    (kind) => !present.has(kind),
  );
  return (
    <EntityForm
      title={
        dossier ? `Compléter le dossier de ${user.first_name}` : `Dossier de ${user.first_name}`
      }
      fields={[
        {
          name: 'documents',
          label: 'Pièces à déposer par le joueur',
          type: 'choices',
          options: kinds.map((kind) => ({ value: kind, label: documentLabels[kind] })),
          hint: 'Chaque étape est facultative.',
        },
        ...(dossier?.payment_requested
          ? []
          : [
              {
                name: 'payment',
                label: 'Paiement à régler auprès du club',
                type: 'checkbox' as const,
                hint: 'Le paiement se fait hors de la plateforme ; un administrateur valide sa réception.',
              },
            ]),
        ...(dossier
          ? []
          : [
              {
                name: 'note',
                label: 'Message au joueur (facultatif)',
                type: 'textarea' as const,
                maxLength: 2000,
              },
            ]),
      ]}
      initial={{ documents: [], payment: false, note: '' }}
      submit={dossier ? 'Ajouter au dossier' : 'Envoyer la demande'}
      onCancel={onCancel}
      onSave={async (values, signal) => {
        const documents = Array.isArray(values.documents) ? values.documents : [];
        const payment = values.payment === true;
        if (!documents.length && !payment)
          throw new Error('Choisissez au moins une pièce ou le paiement.');
        if (dossier)
          await api.request(`/dossiers/${dossier.id}`, 'PATCH', { documents, payment }, signal);
        else
          await api.request(
            '/dossiers',
            'POST',
            { user_id: user.user_id, documents, payment, note: str(values, 'note') },
            signal,
          );
        onDone(`Demande envoyée à ${user.first_name}.`);
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
  const [rejecting, setRejecting] = useState<DocumentKind | null>(null);
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
          <li key={item.kind}>
            <span>
              {documentLabels[item.kind]}
              {item.uploaded_at && ` · déposée le ${dateLabel(item.uploaded_at)}`}
            </span>
            <span className="admin-actions">
              <Badge tone={statusLabels[item.status].tone}>{statusLabels[item.status].label}</Badge>
              {admin && item.has_file && (
                <a className="admin-button" href={fileUrl(dossier, item.kind)} download>
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
                        `/documents/${item.kind}/decision`,
                        { accept: true, reason: '' },
                        `${documentLabels[item.kind]} validé.`,
                      )
                    }
                  >
                    Valider
                  </button>
                  <button
                    type="button"
                    className="admin-button danger"
                    disabled={request.pending}
                    onClick={() => setRejecting(item.kind)}
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
      {request.error && <ErrorNotice message={request.error} />}
      {rejecting && (
        <EntityForm
          title={`Refuser : ${documentLabels[rejecting]}`}
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
              `/dossiers/${dossier.id}/documents/${rejecting}/decision`,
              'POST',
              { accept: false, reason: str(values, 'reason') },
              signal,
            );
            setRejecting(null);
            onChanged(`${documentLabels[rejecting]} refusé ; le joueur est prévenu.`);
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
export function MyDossier() {
  const { api } = useClub();
  const loader = useCallback(
    (signal: AbortSignal) => api.request<Dossier | null>('/dossiers/me', 'GET', undefined, signal),
    [api],
  );
  const result = useLoad(loader);
  const [uploading, setUploading] = useState<DocumentKind | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const dossier = result.data;
  // Sans dossier en cours, l’application reste fermée au joueur.
  if (result.loaded && !result.error && !dossier?.id) return <Navigate to="/app" replace />;
  function send(kind: DocumentKind, file: File) {
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
    setUploading(kind);
    api
      .request(`/dossiers/${dossier!.id}/documents/${kind}/file`, 'PUT', file)
      .then(() => {
        setNotice(`${documentLabels[kind]} déposé.`);
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
              <li key={item.kind}>
                <span>
                  <strong>{documentLabels[item.kind]}</strong>
                  {documentHints[item.kind] && (
                    <span className="admin-hint"> · {documentHints[item.kind]}</span>
                  )}
                </span>
                <span className="admin-actions">
                  <Badge tone={statusLabels[item.status].tone}>
                    {statusLabels[item.status].label}
                  </Badge>
                  {item.has_file && (
                    <a className="admin-button" href={fileUrl(dossier, item.kind)} download>
                      Voir mon fichier
                    </a>
                  )}
                  {item.status !== 'validated' && (
                    <label className="admin-button">
                      {uploading === item.kind
                        ? 'Envoi…'
                        : item.has_file
                          ? 'Remplacer le fichier'
                          : 'Déposer un fichier'}
                      <input
                        type="file"
                        className="visually-hidden"
                        accept={ACCEPT}
                        disabled={uploading !== null}
                        aria-label={`Fichier : ${documentLabels[item.kind]}`}
                        onChange={(change) => {
                          const file = change.target.files?.[0];
                          change.target.value = '';
                          if (file) send(item.kind, file);
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
