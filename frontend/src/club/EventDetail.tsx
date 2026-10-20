import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ErrorNotice } from '../auth/components';
import { useRequest } from '../auth/useRequest';
import { useDialogBackdropDismiss } from '../app/useDialogBackdropDismiss';
import { useLoad } from '../admin/data';
import { fieldLabels } from '../admin/changes';
import { dateLabel } from '../admin/time';
import type {
  Assignment,
  Event,
  Match,
  Participant,
  RegistrationStatus,
  RegistrationSummary,
  Revision,
  Team,
} from '../admin/types';
import { Badge, Confirm, Empty, EntityForm, LoadState, Notice, str } from '../admin/ui';
import { dayLabel, parisDay, timeRange } from './calendar';
import { PersonName, PersonNames, useClub, type Follow, type Thread } from './context';
import { EventEditor } from './EventEditor';
import { RequestForm } from './StaffRequests';
import { kindLabels, registrationOpen, usePlace, useSectionNames, useTeamNames } from './events';

// Champs que l’API accepte de restaurer depuis l’historique.
const restorable = [
  'title',
  'section_ids',
  'gymnasium_id',
  'location',
  'starts_at',
  'ends_at',
  'courts',
  'referent_ids',
  'direct_edit',
  'cancelled',
  'match_courts',
  'before_minutes',
  'after_minutes',
  'kickoff_at',
  'description',
  'registration_section_ids',
  'registration_team_ids',
  'registration_limit',
];

/** Fenêtre de détail d’un événement, ouverte par le paramètre « event » de l’URL. */
export function EventDetail({
  id,
  onClose,
  onChanged,
}: {
  id: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const backdropDismiss = useDialogBackdropDismiss(onClose);
  const titleId = useId();
  const { api } = useClub();
  const loader = useCallback(
    (signal: AbortSignal) => api.request<Event>(`/events/${id}`, 'GET', undefined, signal),
    [api, id],
  );
  const result = useLoad(loader);
  const [editing, setEditing] = useState(false);
  const [notice, setNotice] = useState('');
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  const event = result.data;
  return (
    <dialog
      {...backdropDismiss}
      ref={dialog}
      className="admin-dialog club-detail"
      aria-labelledby={titleId}
      onCancel={(change) => {
        change.preventDefault();
        onClose();
      }}
    >
      <div className="club-detail-head">
        <h2 id={titleId}>{event?.title ?? 'Événement'}</h2>
        <button type="button" className="admin-button" onClick={onClose}>
          Fermer
        </button>
      </div>
      <LoadState result={result} />
      {notice && <Notice>{notice}</Notice>}
      {event &&
        (editing ? (
          <EventEditor
            key={event.version}
            event={event}
            onCancel={() => setEditing(false)}
            onDone={(message) => {
              setEditing(false);
              setNotice(message);
              result.reload();
              onChanged();
            }}
          />
        ) : (
          <EventBody
            event={event}
            onEdit={() => {
              setNotice('');
              setEditing(true);
            }}
            onChanged={() => {
              result.reload();
              onChanged();
            }}
            onDeleted={() => {
              onChanged();
              onClose();
            }}
          />
        ))}
    </dialog>
  );
}

function EventBody({
  event,
  onEdit,
  onChanged,
  onDeleted,
}: {
  event: Event;
  onEdit: () => void;
  onChanged: () => void;
  onDeleted: () => void;
}) {
  const { admin, account } = useClub();
  const place = usePlace();
  const sectionNames = useSectionNames();
  const teamNames = useTeamNames();
  const referent = event.referent_ids.includes(account.id);
  const [history, setHistory] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [asking, setAsking] = useState(false);
  const [asked, setAsked] = useState('');
  const staff = admin || account.roles.includes('coach');
  return (
    <>
      <div className="club-detail-badges">
        <Badge>{kindLabels[event.kind]}</Badge>
        {event.cancelled && <Badge tone="danger">Annulé</Badge>}
        {event.series_id && <Badge>Série hebdomadaire</Badge>}
        {event.exception && <Badge>Occurrence modifiée</Badge>}
        <Badge>{event.ffvb_match_id ? 'Match FFVB' : 'Événement local'}</Badge>
        {event.occupancy_unknown && <Badge tone="warning">Occupation locale indéterminée</Badge>}
        {registrationOpen(event) && <Badge tone="good">Ouvert aux inscriptions</Badge>}
      </div>
      {event.description && <p className="club-description">{event.description}</p>}
      <dl className="admin-changes club-facts">
        <div>
          <dt>Date</dt>
          <dd>{dayLabel(parisDay(event.starts_at))}</dd>
        </div>
        {event.kickoff_at && (
          <div>
            <dt>Coup d’envoi</dt>
            <dd>{dateLabel(event.kickoff_at)}</dd>
          </div>
        )}
        <div>
          <dt>{event.ffvb_match_id ? 'Réservation' : 'Horaires'}</dt>
          <dd>{timeRange(event.starts_at, event.ends_at)}</dd>
        </div>
        <div>
          <dt>Lieu</dt>
          <dd>{place(event)}</dd>
        </div>
        <div>
          <dt>Terrains occupés</dt>
          <dd>{event.courts}</dd>
        </div>
        <div>
          <dt>Sections</dt>
          <dd>{sectionNames(event.section_ids).join(', ')}</dd>
        </div>
        {(event.team_ids?.length ?? 0) > 0 && (
          <div>
            <dt>Équipes organisatrices</dt>
            <dd>{teamNames(event.team_ids!).join(', ')}</dd>
          </div>
        )}
        <div>
          <dt>{event.referent_ids.length > 1 ? 'Référents' : 'Référent'}</dt>
          <dd>
            <PersonNames ids={event.referent_ids} empty="À réattribuer" />
            {event.direct_edit && ' · modification directe autorisée'}
          </dd>
        </div>
      </dl>
      {event.ffvb_match_id && <MatchState event={event} />}
      {(registrationOpen(event) || event.registration_count > 0) && (
        <Registrations event={event} onChanged={onChanged} />
      )}
      <div className="admin-actions club-detail-actions">
        <FollowButtons event={event} />
        {(admin || referent) && (
          <button type="button" className="admin-button primary" onClick={onEdit}>
            {admin || event.direct_edit ? 'Modifier' : 'Proposer une modification'}
          </button>
        )}
        <button type="button" className="admin-button" onClick={() => setHistory(!history)}>
          {history ? 'Masquer l’historique' : 'Historique'}
        </button>
        {staff && (
          <button
            type="button"
            className="admin-button"
            onClick={() => {
              setAsked('');
              setAsking(true);
            }}
          >
            Faire une demande
          </button>
        )}
        {(admin || (referent && account.roles.includes('coach'))) && !event.ffvb_match_id && (
          <button type="button" className="admin-button danger" onClick={() => setDeleting(true)}>
            Supprimer
          </button>
        )}
      </div>
      {asked && <Notice>{asked}</Notice>}
      {asking && (
        <RequestForm
          eventId={event.id}
          eventTitle={event.title}
          onCancel={() => setAsking(false)}
          onDone={(message) => {
            setAsking(false);
            setAsked(message);
          }}
        />
      )}
      {deleting && (
        <DeleteEvent event={event} onClose={() => setDeleting(false)} onDeleted={onDeleted} />
      )}
      <Questions event={event} />
      {history && <History event={event} onChanged={onChanged} />}
    </>
  );
}

function DeleteEvent({
  event,
  onClose,
  onDeleted,
}: {
  event: Event;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const { api } = useClub();
  const [scope, setScope] = useState<'event' | 'following'>('event');
  return (
    <Confirm
      title={`Supprimer « ${event.title} » ?`}
      label="Supprimer"
      onClose={onClose}
      onConfirm={async (signal) => {
        await api.request(`/events/${event.id}?scope=${scope}`, 'DELETE', undefined, signal);
        onDeleted();
      }}
    >
      {event.series_id && (
        <fieldset className="admin-choice-group">
          <legend>Que supprimer ?</legend>
          <label>
            <input
              type="radio"
              name="delete-scope"
              checked={scope === 'event'}
              onChange={() => setScope('event')}
            />
            Cet événement uniquement
          </label>
          <label>
            <input
              type="radio"
              name="delete-scope"
              checked={scope === 'following'}
              onChange={() => setScope('following')}
            />
            Cet événement et tous les suivants de la série
          </label>
        </fieldset>
      )}
      <p>
        La suppression est définitive : historique, questions, suivis et inscriptions sont effacés.
        Les personnes qui suivent l’événement ou y sont inscrites sont prévenues. Pour garder une
        trace, préférez « Événement annulé » dans la modification.
      </p>
    </Confirm>
  );
}

function FollowButtons({ event }: { event: Event }) {
  const { api, follows, setFollows } = useClub();
  const request = useRequest();
  const own = follows.find((follow) => follow.event_id === event.id);
  const series = event.series_id
    ? follows.find((follow) => follow.series_id === event.series_id)
    : undefined;
  function toggle(path: string, current: Follow | undefined) {
    void request.run(async (signal) => {
      if (current) {
        await api.request(path, 'DELETE', undefined, signal);
        setFollows(follows.filter((follow) => follow.id !== current.id));
      } else {
        const created = await api.request<Follow>(path, 'POST', {}, signal);
        setFollows([...follows, created]);
      }
    });
  }
  return (
    <>
      <button
        type="button"
        className={`admin-button${own ? ' selected' : ''}`}
        aria-pressed={!!own}
        disabled={request.pending}
        onClick={() => toggle(`/events/${event.id}/follow`, own)}
      >
        {own ? 'Ne plus suivre' : 'Suivre l’événement'}
      </button>
      {event.series_id && (
        <button
          type="button"
          className={`admin-button${series ? ' selected' : ''}`}
          aria-pressed={!!series}
          disabled={request.pending}
          onClick={() => toggle(`/series/${event.series_id}/follow`, series)}
        >
          {series ? 'Ne plus suivre la série' : 'Suivre la série'}
        </button>
      )}
      {request.error && <ErrorNotice message={request.error} />}
    </>
  );
}

const requestLabels: Record<RegistrationStatus, { label: string; tone: string }> = {
  pending: { label: 'Demande en attente', tone: 'warning' },
  accepted: { label: 'Vous êtes inscrit', tone: 'good' },
  rejected: { label: 'Demande refusée', tone: 'danger' },
};

/** Poste du joueur, de préférence dans une équipe ouverte à l’inscription. */
function defaultPosition(
  event: Pick<Event, 'registration_section_ids' | 'registration_team_ids'>,
  assignments: Assignment[],
  teams: Pick<Team, 'id' | 'section_id'>[],
): string {
  const players = assignments.filter((item) => item.kind === 'player' && item.position_id);
  const open = players.find(
    (item) =>
      event.registration_team_ids?.includes(item.team_id) ||
      event.registration_section_ids.includes(
        teams.find((team) => team.id === item.team_id)?.section_id ?? '',
      ),
  );
  return (open ?? players[0])?.position_id ?? '';
}

function Registrations({ event, onChanged }: { event: Event; onChanged: () => void }) {
  const { api, admin, assignments, teams, positions } = useClub();
  const sectionNames = useSectionNames();
  const teamNames = useTeamNames();
  const loader = useCallback(
    (signal: AbortSignal) =>
      api.request<RegistrationSummary>(
        `/events/${event.id}/registrations`,
        'GET',
        undefined,
        signal,
      ),
    [api, event.id],
  );
  const result = useLoad(loader);
  const request = useRequest();
  const [asking, setAsking] = useState(false);
  const [deciding, setDeciding] = useState<Participant | null>(null);
  const [removing, setRemoving] = useState<{ user_id: string; first_name: string } | null>(null);
  const summary = result.data;
  const started = Date.parse(event.starts_at) <= Date.now();
  const full = !!summary && summary.limit !== null && summary.count >= summary.limit;
  // Les anciennes réponses n’ont que `registered`.
  const status = summary?.status ?? (summary?.registered ? 'accepted' : null);
  const canAsk = !!summary?.open && summary.eligible && !event.cancelled && !started;
  const positionName = (id: string | null) =>
    positions.find((position) => position.id === id)?.name ?? 'poste supprimé';
  function refresh() {
    result.reload();
    onChanged();
  }
  function withdraw() {
    void request.run(async (signal) => {
      await api.request(`/events/${event.id}/registration`, 'DELETE', undefined, signal);
      refresh();
    });
  }
  return (
    <section className="admin-card club-registrations">
      <h3>Inscriptions</h3>
      <LoadState result={result} />
      {summary && (
        <>
          <p>
            {summary.open
              ? [
                  event.registration_section_ids.length > 0 &&
                    `Ouvert aux sections : ${sectionNames(event.registration_section_ids).join(', ')}.`,
                  (event.registration_team_ids?.length ?? 0) > 0 &&
                    `Ouvert aux équipes : ${teamNames(event.registration_team_ids ?? []).join(', ')}.`,
                ]
                  .filter(Boolean)
                  .join(' ')
              : 'Séance fermée aux nouvelles inscriptions.'}{' '}
            <strong>
              {summary.count} inscrit{summary.count > 1 ? 's' : ''}
              {summary.limit !== null && ` sur ${summary.limit}`}
            </strong>
            {full && ' · complet'}
            {(summary.pending ?? 0) > 0 &&
              ` · ${summary.pending} demande${summary.pending > 1 ? 's' : ''} en attente`}
          </p>
          {status ? (
            <div className="admin-actions club-detail-actions">
              <Badge tone={requestLabels[status].tone}>{requestLabels[status].label}</Badge>
              {status === 'pending' && !started && (
                <>
                  <button
                    type="button"
                    className="admin-button"
                    disabled={request.pending}
                    onClick={() => setAsking(true)}
                  >
                    Modifier la demande
                  </button>
                  <button
                    type="button"
                    className="admin-button"
                    disabled={request.pending}
                    onClick={withdraw}
                  >
                    Annuler la demande
                  </button>
                </>
              )}
              {status === 'accepted' && !started && (
                <button
                  type="button"
                  className="admin-button"
                  disabled={request.pending}
                  onClick={withdraw}
                >
                  Se désinscrire
                </button>
              )}
              {status === 'rejected' && canAsk && (
                <button
                  type="button"
                  className="admin-button"
                  disabled={request.pending || full}
                  onClick={() => setAsking(true)}
                >
                  Refaire une demande
                </button>
              )}
            </div>
          ) : canAsk ? (
            <div className="admin-actions club-detail-actions">
              <button
                type="button"
                className="admin-button primary"
                disabled={request.pending || full}
                onClick={() => setAsking(true)}
              >
                {full ? 'Séance complète' : 'Demander l’inscription'}
              </button>
            </div>
          ) : (
            summary.open &&
            !summary.eligible && (
              <p className="admin-hint">
                {event.registration_team_ids?.length
                  ? 'Les inscriptions sont réservées aux adhérents des sections ou équipes indiquées.'
                  : 'Les inscriptions sont réservées aux adhérents des sections indiquées.'}
              </p>
            )
          )}
          {status === 'rejected' && summary.decision && (
            <p className="admin-hint">Motif : {summary.decision}</p>
          )}
          {request.error && <ErrorNotice message={request.error} />}
          {asking && (
            <EntityForm
              title="Demande d’inscription"
              markRequired
              fields={[
                {
                  name: 'position_id',
                  label: 'Poste pour lequel vous voulez vous entraîner',
                  type: 'select',
                  required: true,
                  options: positions.map((position) => ({
                    value: position.id,
                    label: position.name,
                  })),
                },
                {
                  name: 'message',
                  label: 'Message (facultatif)',
                  type: 'textarea',
                  maxLength: 1000,
                  hint: 'Lu par l’administration et le référent de la séance.',
                },
              ]}
              initial={{
                position_id: defaultPosition(event, assignments, teams),
                message: '',
              }}
              submit={status === 'pending' ? 'Modifier la demande' : 'Envoyer la demande'}
              onCancel={() => setAsking(false)}
              onSave={async (values, signal) => {
                await api.request(
                  `/events/${event.id}/registration`,
                  'POST',
                  { position_id: str(values, 'position_id'), message: str(values, 'message') },
                  signal,
                );
                setAsking(false);
                refresh();
              }}
            />
          )}
          {summary.participants &&
            (summary.participants.length ? (
              <ul className="club-plain-list club-participants">
                {summary.participants.map((participant) => (
                  <li key={participant.user_id}>
                    <span>
                      {participant.first_name}
                      {` · ${positionName(participant.position_id)}`}
                      {participant.status === 'pending'
                        ? ` · demande du ${dateLabel(participant.created_at)}`
                        : ` · inscrit le ${dateLabel(participant.created_at)}`}
                    </span>
                    {participant.status === 'pending' && <Badge tone="warning">En attente</Badge>}
                    <span className="admin-actions">
                      {participant.status === 'pending' && (
                        <button
                          type="button"
                          className="admin-button"
                          onClick={() => setDeciding(participant)}
                        >
                          Traiter
                        </button>
                      )}
                      {admin && (
                        <button
                          type="button"
                          className="admin-button danger"
                          onClick={() => setRemoving(participant)}
                        >
                          Retirer
                        </button>
                      )}
                    </span>
                    {participant.message && (
                      <p className="club-participant-message">« {participant.message} »</p>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <Empty>Aucune demande ni inscrit pour le moment.</Empty>
            ))}
          {deciding && (
            <EntityForm
              key={deciding.user_id}
              title={`Demande de ${deciding.first_name} · ${positionName(deciding.position_id)}`}
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
                  label: 'Message au joueur (facultatif)',
                  type: 'textarea',
                  maxLength: 2000,
                },
              ]}
              initial={{ accept: '', reason: '' }}
              submit="Enregistrer la décision"
              onCancel={() => setDeciding(null)}
              onSave={async (values, signal) => {
                await api.request(
                  `/events/${event.id}/registrations/${deciding.user_id}/decision`,
                  'POST',
                  { accept: str(values, 'accept') === 'yes', reason: str(values, 'reason') },
                  signal,
                );
                setDeciding(null);
                refresh();
              }}
            >
              {deciding.message && <p className="club-wide">Message : {deciding.message}</p>}
            </EntityForm>
          )}
        </>
      )}
      {removing && (
        <Confirm
          title="Retirer l’inscription"
          label="Retirer"
          onClose={() => setRemoving(null)}
          onConfirm={async (signal) => {
            await api.request(
              `/events/${event.id}/registrations/${removing.user_id}`,
              'DELETE',
              undefined,
              signal,
            );
            refresh();
          }}
        >
          <p>
            {removing.first_name} ne sera plus inscrit à « {event.title} » et en sera notifié.
          </p>
        </Confirm>
      )}
    </section>
  );
}

function MatchState({ event }: { event: Event }) {
  const { api } = useClub();
  const loader = useCallback(
    (signal: AbortSignal) => api.list<Match>(`/ffvb/matches?event_id=${event.id}`, false, signal),
    [api, event.id],
  );
  const result = useLoad(loader);
  const match = result.data?.[0];
  return (
    <section className="admin-card club-match">
      <h3>Synchronisation FFVB</h3>
      <LoadState result={result} />
      {match && (
        <>
          <p>
            Match {match.match_code} · dernière vérification réussie :{' '}
            {dateLabel(match.last_verified_at)}
          </p>
          <p>Dernier changement officiel : {dateLabel(match.last_changed_at)}</p>
          {match.missing && <Badge tone="warning">Absent du calendrier officiel</Badge>}
          {match.disabled && <Badge tone="warning">Vérification désactivée</Badge>}
          {match.suspended_until && (
            <Badge tone="warning">Suspendu jusqu’au {dateLabel(match.suspended_until)}</Badge>
          )}
          {Object.keys(match.protected).length > 0 && (
            <p className="admin-hint">
              Valeurs modifiées localement et protégées :{' '}
              {Object.keys(match.protected)
                .map((key) => fieldLabels[key] ?? key)
                .join(', ')}
              .
            </p>
          )}
        </>
      )}
    </section>
  );
}

function Questions({ event }: { event: Event }) {
  const { api, account, admin } = useClub();
  const loader = useCallback(
    (signal: AbortSignal) => api.list<Thread>(`/questions?event_id=${event.id}`, true, signal),
    [api, event.id],
  );
  const result = useLoad(loader);
  const request = useRequest();
  const [body, setBody] = useState('');
  const [sent, setSent] = useState<Thread | null>(null);
  const canAsk = account.roles.includes('member') && account.messaging_allowed;
  const threads = result.data ?? [];
  const own = sent ?? threads.find((thread) => thread.user_id === account.id);
  if (!admin && !canAsk && !own) return null;
  return (
    <section className="admin-card club-questions">
      <h3>Questions</h3>
      {admin ? (
        threads.length ? (
          <ul className="club-plain-list">
            {threads.map((thread) => (
              <li key={thread.id}>
                <Link to={`/app/messagerie?thread=${thread.id}`}>
                  Question de <PersonName id={thread.user_id} />
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <Empty>Aucune question sur cet événement.</Empty>
        )
      ) : (
        <>
          {own && (
            <p>
              <Link to={`/app/messagerie?thread=${own.id}`}>
                Voir mon échange avec les administrateurs
              </Link>
            </p>
          )}
          {canAsk ? (
            <form
              className="club-ask"
              onSubmit={(change) => {
                change.preventDefault();
                void request.run(async (signal) => {
                  const thread = await api.request<Thread>(
                    `/events/${event.id}/questions`,
                    'POST',
                    { body: body.trim() },
                    signal,
                  );
                  setSent(thread);
                  setBody('');
                });
              }}
            >
              <label htmlFor={`question-${event.id}`}>Poser une question aux administrateurs</label>
              <textarea
                id={`question-${event.id}`}
                value={body}
                maxLength={5000}
                required
                onChange={(change) => setBody(change.target.value)}
              />
              <p className="admin-hint">Seuls vous et les administrateurs voyez cet échange.</p>
              <ErrorNotice message={request.error} />
              {sent && <Notice>Question envoyée.</Notice>}
              <div className="admin-actions">
                <button
                  className="admin-button primary"
                  type="submit"
                  disabled={request.pending || !body.trim()}
                >
                  {request.pending ? 'Envoi…' : 'Envoyer la question'}
                </button>
              </div>
            </form>
          ) : (
            <p className="admin-hint">Votre droit d’écrire a été retiré par un administrateur.</p>
          )}
        </>
      )}
    </section>
  );
}

const origins: Record<string, string> = {
  human: 'Action manuelle',
  ffvb: 'Synchronisation FFVB',
  unavailability: 'Annulation : gymnase indisponible',
};
function History({ event, onChanged }: { event: Event; onChanged: () => void }) {
  const { api, admin } = useClub();
  const loader = useCallback(
    (signal: AbortSignal) => api.list<Revision>(`/events/${event.id}/history`, true, signal),
    [api, event.id],
  );
  const result = useLoad(loader);
  const [restoring, setRestoring] = useState<Revision | null>(null);
  const revisions = [...(result.data ?? [])].reverse();
  return (
    <section className="admin-card club-history">
      <h3>Historique</h3>
      <LoadState result={result} />
      {result.loaded && !revisions.length && <Empty>Aucune modification enregistrée.</Empty>}
      <ol className="club-plain-list">
        {revisions.map((revision) => {
          const fields = Object.keys(revision.before).filter((key) => restorable.includes(key));
          return (
            <li key={revision.id} className="club-revision">
              <p>
                <strong>{dateLabel(revision.created_at)}</strong> ·{' '}
                {revision.actor_name || 'Système'} · {origins[revision.origin] ?? revision.origin}
                {revision.forced && <Badge tone="warning">Capacité forcée</Badge>}
              </p>
              {revision.decision_reason && <p>Motif : {revision.decision_reason}</p>}
              {Object.keys(revision.after).length > 0 && (
                <p className="admin-hint">
                  {Object.keys(revision.after)
                    .map((key) => fieldLabels[key] ?? key)
                    .join(', ')}
                </p>
              )}
              {admin && fields.length > 0 && (
                <button
                  type="button"
                  className="admin-button"
                  onClick={() => setRestoring(revision)}
                >
                  Restaurer les valeurs précédentes
                </button>
              )}
            </li>
          );
        })}
      </ol>
      {restoring && (
        <Confirm
          title="Restaurer ces valeurs ?"
          label="Restaurer"
          onClose={() => setRestoring(null)}
          onConfirm={async (signal) => {
            await api.request(
              `/events/${event.id}/history/${restoring.id}/restore`,
              'POST',
              {
                base_version: event.version,
                fields: Object.keys(restoring.before).filter((key) => restorable.includes(key)),
                acknowledge_ffvb: !!event.ffvb_match_id,
              },
              signal,
            );
            result.reload();
            onChanged();
          }}
        >
          Les champs{' '}
          {Object.keys(restoring.before)
            .filter((key) => restorable.includes(key))
            .map((key) => fieldLabels[key] ?? key)
            .join(', ')}{' '}
          retrouveront leur valeur d’avant cette modification. L’action est historisée.
          {event.ffvb_match_id &&
            ' Pour un match FFVB, les horaires et lieux restaurés deviennent des valeurs locales protégées.'}
        </Confirm>
      )}
    </section>
  );
}

/** Affiche le détail demandé par l’URL et retire le paramètre à la fermeture. */
export function DetailHost({ onChanged }: { onChanged: () => void }) {
  const [search, setSearch] = useSearchParams();
  const id = search.get('event');
  if (!id) return null;
  return (
    <EventDetail
      key={id}
      id={id}
      onChanged={onChanged}
      onClose={() =>
        setSearch((previous) => {
          const next = new URLSearchParams(previous);
          next.delete('event');
          return next;
        })
      }
    />
  );
}
