import { useCallback, useState } from 'react';
import { Link } from 'react-router-dom';
import { ErrorNotice } from '../auth/components';
import { useRequest } from '../auth/useRequest';
import { useLoad } from '../admin/data';
import { dateLabel } from '../admin/time';
import { Badge, Empty, EntityForm, LoadState, Notice, str } from '../admin/ui';
import { useLiveReload } from '../app/unread';
import { useClub } from './context';
import { pieceName, type DocumentKind } from './dossiers';

type RequestKind = 'event_change' | 'slot' | 'document' | 'other' | 'registration';
type RequestStatus = 'pending' | 'accepted' | 'rejected' | 'withdrawn';
export interface StaffRequest {
  id: string;
  kind: RequestKind;
  title: string;
  description: string;
  event_id: string | null;
  actor_id: string | null;
  actor_name: string;
  status: RequestStatus;
  decision: string;
  decider_name: string | null;
  decided_at: string | null;
  created_at: string;
  thread_id: string | null;
  player_id: string | null;
  documents: { kind: DocumentKind; label: string }[];
  /** Écran où la demande se traite. */
  link: string;
  /** Demande d’inscription : poste demandé différent du poste en équipe. */
  position_warning?: boolean;
}

export const requestKinds: Record<RequestKind, string> = {
  event_change: 'Modification d’événement',
  slot: 'Demande de créneau',
  document: 'Demande de pièces',
  other: 'Autre',
  registration: 'Demande d’inscription',
};
const requestStatuses: Record<RequestStatus, { label: string; tone: string }> = {
  pending: { label: 'À traiter', tone: 'warning' },
  accepted: { label: 'Acceptée', tone: 'good' },
  rejected: { label: 'Refusée', tone: 'danger' },
  withdrawn: { label: 'Retirée', tone: '' },
};
// Créneaux et modifications se décident dans l’écran de validation de l’administration ;
// une inscription se décide ici comme sur l’événement, par la même route.
const decidedHere: RequestKind[] = ['document', 'other', 'registration'];
// Seules les demandes libres ou de pièces se retirent ici, par leur auteur.
const withdrawnHere: RequestKind[] = ['document', 'other'];
/** Route de décision : celle de l’événement pour une inscription. */
function decisionPath(item: StaffRequest) {
  return item.kind === 'registration'
    ? `/events/${item.event_id}/registrations/${item.actor_id}/decision`
    : `/requests/${item.id}/decision`;
}

/** Demande libre aux administrateurs, liée à un événement ou non. */
export function RequestForm({
  eventId,
  eventTitle,
  onDone,
  onCancel,
}: {
  eventId?: string;
  eventTitle?: string;
  onDone: (message: string) => void;
  onCancel: () => void;
}) {
  const { api } = useClub();
  return (
    <EntityForm
      title={eventTitle ? `Demande sur « ${eventTitle} »` : 'Nouvelle demande'}
      markRequired
      fields={[
        { name: 'title', label: 'Titre', required: true, maxLength: 200 },
        { name: 'description', label: 'Description', type: 'textarea', maxLength: 4000 },
      ]}
      initial={{ title: '', description: '' }}
      submit="Envoyer aux administrateurs"
      onCancel={onCancel}
      onSave={async (values, signal) => {
        await api.request(
          '/requests',
          'POST',
          {
            kind: 'other',
            title: str(values, 'title'),
            description: str(values, 'description'),
            event_id: eventId ?? null,
          },
          signal,
        );
        onDone('Demande envoyée ; la conversation est ouverte dans la messagerie.');
      }}
    />
  );
}

/** Liste unique des demandes : toutes pour un administrateur, les siennes sinon. */
export function RequestsList() {
  const { api, admin, account } = useClub();
  const staff = account.roles.some((role) => role === 'admin' || role === 'coach');
  const [status, setStatus] = useState<RequestStatus | ''>('pending');
  const [creating, setCreating] = useState(false);
  const [deciding, setDeciding] = useState<StaffRequest | null>(null);
  const [notice, setNotice] = useState('');
  const request = useRequest();
  const loader = useCallback(
    (signal: AbortSignal) =>
      api.list<StaffRequest>(`/requests${status ? `?status=${status}` : ''}`, false, signal),
    [api, status],
  );
  const result = useLoad(loader);
  useLiveReload(result.refresh);
  const items = result.data ?? [];
  function done(message: string) {
    setCreating(false);
    setDeciding(null);
    setNotice(message);
    result.reload();
  }
  return (
    <section className="admin-card club-requests" aria-label="Demandes">
      <h3>Demandes</h3>
      <p className="admin-hint">
        {admin
          ? 'Toutes les demandes des coachs, des référents et des joueurs. Les créneaux et modifications se valident dans l’administration ; une inscription se décide ici ou sur l’événement.'
          : 'Vos demandes aux administrateurs et leur suivi, et les demandes d’inscription aux événements dont vous êtes référent : à décider ici ou sur l’événement.'}
      </p>
      <div className="admin-toolbar">
        <label>
          État
          <select
            value={status}
            onChange={(change) => setStatus(change.target.value as RequestStatus | '')}
          >
            <option value="pending">À traiter</option>
            <option value="accepted">Acceptées</option>
            <option value="rejected">Refusées</option>
            <option value="withdrawn">Retirées</option>
            <option value="">Toutes</option>
          </select>
        </label>
        {staff && (
          <button
            type="button"
            className="admin-button primary"
            onClick={() => {
              setNotice('');
              setCreating(true);
            }}
          >
            Nouvelle demande
          </button>
        )}
      </div>
      {notice && <Notice>{notice}</Notice>}
      <ErrorNotice message={request.error} />
      {creating && <RequestForm onDone={done} onCancel={() => setCreating(false)} />}
      <LoadState result={result} />
      {result.loaded && !result.error && !items.length && <Empty>Aucune demande.</Empty>}
      <ul className="club-plain-list club-participants">
        {items.map((item) => (
          <li key={`${item.kind}:${item.id}`}>
            <span>
              <Badge>{requestKinds[item.kind]}</Badge> <strong>{item.title}</strong>
              <span className="admin-hint">
                {' '}
                · {admin && `${item.actor_name} · `}
                {dateLabel(item.created_at)}
              </span>
            </span>
            <span className="admin-actions">
              <Badge tone={requestStatuses[item.status].tone}>
                {requestStatuses[item.status].label}
              </Badge>
              {item.position_warning && <Badge tone="warning">Autre poste qu’en équipe</Badge>}
              <Link className="admin-button" to={item.link}>
                {item.thread_id
                  ? 'Conversation'
                  : item.kind === 'registration'
                    ? 'Événement'
                    : admin
                      ? 'Traiter'
                      : 'Voir'}
              </Link>
              {(admin || item.kind === 'registration') &&
                item.status === 'pending' &&
                decidedHere.includes(item.kind) && (
                  <button type="button" className="admin-button" onClick={() => setDeciding(item)}>
                    Décider
                  </button>
                )}
              {!admin &&
                item.status === 'pending' &&
                withdrawnHere.includes(item.kind) &&
                item.actor_id === account.id && (
                  <button
                    type="button"
                    className="admin-button"
                    disabled={request.pending}
                    onClick={() =>
                      void request.run(async (signal) => {
                        await api.request(`/requests/${item.id}/withdraw`, 'POST', {}, signal);
                        done('Demande retirée.');
                      })
                    }
                  >
                    Retirer
                  </button>
                )}
            </span>
            {(item.documents.length > 0 || item.description || item.decision) && (
              <p className="club-request-detail">
                {item.documents.length > 0 &&
                  `Pièces : ${item.documents.map(pieceName).join(', ')}. `}
                {item.description}
                {item.decision && ` Décision : ${item.decision}`}
              </p>
            )}
            {deciding?.id === item.id && (
              <EntityForm
                title={`Décision : ${item.title}`}
                fields={[
                  {
                    name: 'accept',
                    label: 'Décision',
                    type: 'select',
                    required: true,
                    options: [
                      { value: 'yes', label: 'Accepter' },
                      { value: 'no', label: 'Refuser' },
                    ],
                    hint:
                      item.kind === 'document'
                        ? 'Accepter ouvre ou complète le dossier du joueur avec ces pièces.'
                        : undefined,
                  },
                  {
                    name: 'reason',
                    label:
                      item.kind === 'registration'
                        ? 'Message au joueur (facultatif)'
                        : 'Message au demandeur (facultatif)',
                    type: 'textarea',
                    maxLength: 2000,
                  },
                ]}
                initial={{ accept: '', reason: '' }}
                submit="Enregistrer la décision"
                onCancel={() => setDeciding(null)}
                onSave={async (values, signal) => {
                  await api.request(
                    decisionPath(item),
                    'POST',
                    { accept: str(values, 'accept') === 'yes', reason: str(values, 'reason') },
                    signal,
                  );
                  done(
                    item.kind === 'registration'
                      ? 'Décision enregistrée ; le joueur est notifié.'
                      : 'Décision enregistrée ; elle est écrite dans la conversation.',
                  );
                }}
              />
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
