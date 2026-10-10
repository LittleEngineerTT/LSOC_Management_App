import { useState } from 'react';
import { useAdmin, useResource } from './data';
import type { ChangeRequest, EmailJob, Event } from './types';
import { dateLabel } from './time';
import { Badge, checked, Empty, EntityForm, LoadState, Notice, PanelHeading, str } from './ui';
import { Changes } from './changes';
import { useRequest } from '../auth/useRequest';
import { ErrorNotice } from '../auth/components';

export function EmailsPanel() {
  const [status, setStatus] = useState('pending');
  return (
    <>
      <PanelHeading
        title="E-mails"
        description="Suivez les envois du worker et relancez un message non livré après correction de sa cause."
      />
      <div className="admin-toolbar">
        <label>
          État des envois
          <select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="pending">En attente</option>
            <option value="failed">En échec</option>
            <option value="sent">Envoyés</option>
          </select>
        </label>
      </div>
      <EmailList key={status} status={status} />
    </>
  );
}
function EmailList({ status }: { status: string }) {
  const { api, catalog } = useAdmin();
  const result = useResource<EmailJob>(`/admin/email-jobs?status=${status}`, true);
  const request = useRequest();
  const [notice, setNotice] = useState('');
  return (
    <>
      <LoadState result={result} />
      <div className="admin-actions">
        <button className="admin-button" onClick={result.reload}>
          Actualiser
        </button>
      </div>
      <ErrorNotice message={request.error} />
      {notice && <Notice>{notice}</Notice>}
      {result.loaded && !result.data?.length && <Empty>Aucun envoi dans cet état.</Empty>}
      <div className="admin-list">
        {result.data?.map((job) => (
          <article className="admin-row" key={job.id}>
            <div className="admin-row-copy">
              <h3>
                {catalog.users.find((user) => user.id === job.user_id)?.first_name ??
                  'Compte supprimé'}
              </h3>
              <p>
                {job.attempts} tentative(s) ·{' '}
                {job.sent_at
                  ? `Envoyé le ${dateLabel(job.sent_at)}`
                  : `Prochaine tentative : ${dateLabel(job.due_at)}`}
              </p>
              <Badge tone={job.sent_at ? 'good' : job.attempts >= 8 ? 'warning' : ''}>
                {job.sent_at ? 'Envoyé' : job.attempts >= 8 ? 'En échec' : 'En attente'}
              </Badge>
            </div>
            {!job.sent_at && (
              <button
                className="admin-button"
                disabled={request.pending}
                onClick={() => {
                  void request.run(async (signal) => {
                    await api.request(`/admin/email-jobs/${job.id}/retry`, 'POST', {}, signal);
                    setNotice('Envoi relancé. Le worker reprendra la livraison.');
                    result.reload();
                  });
                }}
              >
                Relancer l’envoi
              </button>
            )}
          </article>
        ))}
      </div>
    </>
  );
}
export function RequestsPanel() {
  const [status, setStatus] = useState('pending');
  return (
    <>
      <PanelHeading
        title="Validations"
        description="Examinez les modifications proposées par les référents et consignez votre décision."
      />
      <div className="admin-toolbar">
        <label>
          État des demandes
          <select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="pending">À valider</option>
            <option value="accepted">Acceptées</option>
            <option value="rejected">Refusées</option>
            <option value="withdrawn">Retirées</option>
            <option value="">Toutes</option>
          </select>
        </label>
      </div>
      <RequestList key={status} status={status} />
    </>
  );
}
function RequestList({ status }: { status: string }) {
  const { api } = useAdmin();
  const result = useResource<ChangeRequest>(`/change-requests?status=${status}`, true);
  const events = useResource<Event>('/events?include_cancelled=true', true);
  const [decision, setDecision] = useState<ChangeRequest | null>(null);
  const [notice, setNotice] = useState('');
  return (
    <>
      <LoadState result={result} />
      <LoadState result={events} />
      <button
        className="admin-button"
        onClick={() => {
          result.reload();
          events.reload();
        }}
      >
        Actualiser
      </button>
      {notice && <Notice>{notice}</Notice>}
      {result.loaded && !result.data?.length && <Empty>Aucune demande dans cet état.</Empty>}
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
            { name: 'reason', label: 'Motif de la décision', type: 'textarea', maxLength: 2000 },
            {
              name: 'force',
              label: 'Confirmer le dépassement de capacité si nécessaire',
              type: 'checkbox',
            },
            {
              name: 'acknowledge_ffvb',
              label: 'Confirmer les conséquences d’une modification manuelle FFVB',
              type: 'checkbox',
            },
          ]}
          initial={{ accept: '', reason: '', force: false, acknowledge_ffvb: false }}
          submit="Enregistrer la décision"
          onCancel={() => setDecision(null)}
          onSave={async (values, signal) => {
            await api.request(
              `/change-requests/${decision.id}/decision`,
              'POST',
              {
                accept: str(values, 'accept') === 'yes',
                reason: str(values, 'reason'),
                force: checked(values, 'force'),
                acknowledge_ffvb: checked(values, 'acknowledge_ffvb'),
              },
              signal,
            );
            setDecision(null);
            setNotice('Décision enregistrée.');
            result.reload();
            events.reload();
          }}
        >
          <h4>
            {events.data?.find((event) => event.id === decision.event_id)?.title ??
              'Événement concerné'}
          </h4>
          <p className="admin-hint">
            Version proposée : {decision.base_version}. Une demande obsolète devra être réexaminée ;
            elle ne sera pas appliquée automatiquement.
          </p>
          {events.data?.find((event) => event.id === decision.event_id)?.version !==
            decision.base_version && (
            <p className="admin-warning">
              Vérifiez la version actuelle avant d’accepter : l’événement peut avoir changé depuis
              cette demande.
            </p>
          )}
          <h4>Valeurs actuelles</h4>
          <Changes
            values={Object.fromEntries(
              Object.keys(decision.changes).map((key) => [
                key,
                events.data?.find((event) => event.id === decision.event_id)?.[
                  key as keyof Event
                ] ?? null,
              ]),
            )}
          />
          <h4>Changements proposés</h4>
          <Changes values={decision.changes} />
        </EntityForm>
      )}
      <div className="admin-list">
        {result.data?.map((item) => (
          <article className="admin-card" key={item.id}>
            <div className="admin-row">
              <div>
                <h3>Demande de {item.actor_name}</h3>
                <p>
                  {events.data?.find((event) => event.id === item.event_id)?.title ??
                    'Événement concerné'}
                </p>
                <p>
                  {dateLabel(item.created_at)} · Version {item.base_version}
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
                <button className="admin-button" onClick={() => setDecision(item)}>
                  Examiner
                </button>
              )}
            </div>
            <Changes values={item.changes} />
            {item.decision && (
              <p>
                Décision : {item.decision} · {item.decider_name} · {dateLabel(item.decided_at)}
              </p>
            )}
          </article>
        ))}
      </div>
    </>
  );
}
