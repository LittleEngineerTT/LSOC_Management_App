import { useState } from 'react';
import { useDecisionTarget } from './decisionTarget';
import { Link } from 'react-router-dom';
import { Changes } from './changes';
import { useAdmin, useResource } from './data';
import { dateLabel } from './time';
import type { EventRequest } from './types';
import { Badge, checked, Empty, EntityForm, LoadState, Notice, str } from './ui';

export function EventRequestsPanel({ status }: { status: string }) {
  const { api, catalog } = useAdmin();
  const result = useResource<EventRequest>(`/event-requests?status=${status}`, true);
  const { decision, open, close, alreadyDecided } = useDecisionTarget(result.data);
  const [notice, setNotice] = useState('');
  return (
    <>
      <LoadState result={result} />
      <button className="admin-button" onClick={result.reload}>
        Actualiser
      </button>
      {notice && <Notice>{notice}</Notice>}
      {alreadyDecided && (
        <p className="admin-hint">Cette demande a déjà été traitée par un administrateur.</p>
      )}
      {result.loaded && !result.data?.length && !result.error && (
        <Empty>Aucune demande dans cet état.</Empty>
      )}
      {decision && (
        <EntityForm
          key={decision.id}
          title={`Décision pour la demande de ${decision.actor_name}`}
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
            },
            {
              name: 'reason',
              label: 'Message au référent',
              type: 'textarea',
              required: true,
              maxLength: 2000,
              hint: 'Envoyé au référent de l’événement avec la décision.',
            },
            {
              name: 'force',
              label: 'Confirmer le dépassement de capacité si nécessaire',
              type: 'checkbox',
            },
          ]}
          initial={{ accept: '', reason: '', force: false }}
          submit="Enregistrer la décision"
          onCancel={() => close()}
          onSave={async (values, signal) => {
            await api.request(
              `/event-requests/${decision.id}/decision`,
              'POST',
              {
                accept: str(values, 'accept') === 'yes',
                reason: str(values, 'reason'),
                force: checked(values, 'force'),
                acknowledge_ffvb: false,
              },
              signal,
            );
            close();
            setNotice('Décision enregistrée.');
            result.reload();
          }}
        >
          <h4>Proposition : {decision.proposal.title}</h4>
          <Changes values={decision.proposal} />
          {decision.note && <p className="club-wide">Commentaire : {decision.note}</p>}
          <p className="admin-hint club-wide">
            L’acceptation crée l’événement après vérification du rattachement coach et des
            disponibilités actuelles.
          </p>
        </EntityForm>
      )}
      <div className="admin-list">
        {result.data?.map((item) => (
          <article className="admin-card" key={item.id}>
            <div className="admin-row">
              <div>
                <h3>{item.proposal.title}</h3>
                <p>
                  Demande de {item.actor_name} ·{' '}
                  {catalog.teams.find((team) => team.id === item.team_id)?.name ??
                    'Équipe supprimée'}{' '}
                  · {dateLabel(item.created_at)}
                </p>
                <Badge>
                  {(
                    {
                      pending: 'À valider',
                      accepted: 'Acceptée',
                      rejected: 'Refusée',
                      withdrawn: 'Retirée',
                    } as Record<string, string>
                  )[item.status] ?? item.status}
                </Badge>
              </div>
              {item.status === 'pending' && (
                <button
                  className="admin-button"
                  onClick={() => {
                    setNotice('');
                    open(item);
                  }}
                >
                  Examiner
                </button>
              )}
            </div>
            <Changes values={item.proposal} />
            {item.note && <p>{item.note}</p>}
            {item.decided_at && (
              <p>
                Décision : {item.decision || 'Sans motif'} · {item.decider_name} ·{' '}
                {dateLabel(item.decided_at)}
              </p>
            )}
            {item.event_id && (
              <Link to={`/app/planning?event=${encodeURIComponent(item.event_id)}`}>
                Voir l’événement
              </Link>
            )}
          </article>
        ))}
      </div>
    </>
  );
}
