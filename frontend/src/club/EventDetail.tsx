import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ErrorNotice } from '../auth/components';
import { useRequest } from '../auth/useRequest';
import { useDialogBackdropDismiss } from '../app/useDialogBackdropDismiss';
import { useLoad } from '../admin/data';
import { fieldLabels } from '../admin/changes';
import { dateLabel } from '../admin/time';
import type { Event, Match, RegistrationSummary, Revision } from '../admin/types';
import { Badge, Confirm, Empty, LoadState, Notice } from '../admin/ui';
import { dayLabel, parisDay, timeRange } from './calendar';
import { PersonName, useClub, type Follow, type Thread } from './context';
import { EventEditor } from './EventEditor';
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
  'referent_id',
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
          />
        ))}
    </dialog>
  );
}

function EventBody({
  event,
  onEdit,
  onChanged,
}: {
  event: Event;
  onEdit: () => void;
  onChanged: () => void;
}) {
  const { admin, account } = useClub();
  const place = usePlace();
  const sectionNames = useSectionNames();
  const referent = event.referent_id === account.id;
  const [history, setHistory] = useState(false);
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
        <div>
          <dt>Référent</dt>
          <dd>
            {event.referent_id ? <PersonName id={event.referent_id} /> : 'À réattribuer'}
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
      </div>
      <Questions event={event} />
      {history && <History event={event} onChanged={onChanged} />}
    </>
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

function Registrations({ event, onChanged }: { event: Event; onChanged: () => void }) {
  const { api, admin } = useClub();
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
  const [removing, setRemoving] = useState<{ user_id: string; first_name: string } | null>(null);
  const summary = result.data;
  const started = Date.parse(event.starts_at) <= Date.now();
  const full = !!summary && summary.limit !== null && summary.count >= summary.limit;
  function refresh() {
    result.reload();
    onChanged();
  }
  function toggle(registered: boolean) {
    void request.run(async (signal) => {
      await api.request(
        `/events/${event.id}/registration`,
        registered ? 'DELETE' : 'POST',
        registered ? undefined : {},
        signal,
      );
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
          </p>
          {summary.registered ? (
            <div className="admin-actions club-detail-actions">
              <Badge tone="good">Vous êtes inscrit</Badge>
              {!started && (
                <button
                  type="button"
                  className="admin-button"
                  disabled={request.pending}
                  onClick={() => toggle(true)}
                >
                  Se désinscrire
                </button>
              )}
            </div>
          ) : summary.open && summary.eligible && !event.cancelled && !started ? (
            <div className="admin-actions club-detail-actions">
              <button
                type="button"
                className="admin-button primary"
                disabled={request.pending || full}
                onClick={() => toggle(false)}
              >
                {full ? 'Séance complète' : 'S’inscrire'}
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
          {request.error && <ErrorNotice message={request.error} />}
          {summary.participants &&
            (summary.participants.length ? (
              <ul className="club-plain-list club-participants">
                {summary.participants.map((participant) => (
                  <li key={participant.user_id}>
                    <span>
                      {participant.first_name} · inscrit le {dateLabel(participant.created_at)}
                    </span>
                    {admin && (
                      <button
                        type="button"
                        className="admin-button danger"
                        onClick={() => setRemoving(participant)}
                      >
                        Retirer
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <Empty>Aucun inscrit pour le moment.</Empty>
            ))}
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

const origins: Record<string, string> = { human: 'Action manuelle', ffvb: 'Synchronisation FFVB' };
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
