import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ErrorNotice } from '../auth/components';
import { useRequest } from '../auth/useRequest';
import { useLoad } from '../admin/data';
import { dateLabel } from '../admin/time';
import type { Event } from '../admin/types';
import { Empty, LoadState, PanelHeading } from '../admin/ui';
import { dayLabel, parisDay } from './calendar';
import { PersonName, useClub, type Message, type Thread } from './context';
import { useUnread } from '../app/unread';

interface Conversation extends Thread {
  event: Event | null;
}

export function MessagingPage() {
  const { api, admin } = useClub();
  const { threads: unreadThreads } = useUnread();
  const [search] = useSearchParams();
  const loader = useCallback(
    async (signal: AbortSignal): Promise<Conversation[]> => {
      const threads = await api.list<Thread>('/questions', true, signal);
      const ids = [...new Set(threads.map((thread) => thread.event_id))];
      const events = new Map(
        await Promise.all(
          ids.map(async (id) => {
            const event = await api
              .request<Event>(`/events/${id}`, 'GET', undefined, signal)
              .catch(() => null);
            return [id, event] as const;
          }),
        ),
      );
      return threads
        .map((thread) => ({ ...thread, event: events.get(thread.event_id) ?? null }))
        .sort((left, right) =>
          (right.event?.starts_at ?? '').localeCompare(left.event?.starts_at ?? ''),
        );
    },
    [api],
  );
  const result = useLoad(loader);
  const conversations = result.data ?? [];
  const selected = conversations.find((item) => item.id === search.get('thread'));
  return (
    <>
      <PanelHeading
        title="Messagerie"
        description={
          admin
            ? 'Questions des adhérents sur les événements. Chaque échange reste privé entre l’adhérent et les administrateurs.'
            : 'Vos questions aux administrateurs. Pour en poser une nouvelle, ouvrez l’événement concerné dans le planning.'
        }
      />
      <LoadState result={result} />
      {result.data && !conversations.length && (
        <Empty>
          {admin ? (
            'Aucune question pour le moment.'
          ) : (
            <>
              Aucune question pour le moment. <Link to="/app/planning">Ouvrir le planning</Link>
            </>
          )}
        </Empty>
      )}
      {conversations.length > 0 && (
        <div className={`club-messaging${selected ? ' has-selection' : ''}`}>
          <nav className="club-threads" aria-label="Conversations">
            {conversations.map((item) => (
              <Link
                key={item.id}
                to={`?thread=${item.id}`}
                className={item.id === selected?.id ? 'active' : ''}
                aria-current={item.id === selected?.id ? 'page' : undefined}
              >
                <strong>
                  {item.event?.title ?? 'Événement indisponible'}
                  {unreadThreads.includes(item.id) && item.id !== selected?.id && (
                    <span className="club-unread">
                      {admin ? 'Nouvelle question' : 'Nouvelle réponse'}
                    </span>
                  )}
                </strong>
                <span>
                  {item.event && dayLabel(parisDay(item.event.starts_at))}
                  {admin && (
                    <>
                      {' · '}
                      <PersonName id={item.user_id} />
                    </>
                  )}
                </span>
              </Link>
            ))}
          </nav>
          {selected ? (
            <ThreadView key={selected.id} conversation={selected} />
          ) : (
            <p className="club-thread-placeholder">Sélectionnez une conversation.</p>
          )}
        </div>
      )}
    </>
  );
}

function ThreadView({ conversation }: { conversation: Conversation }) {
  const { api, account, admin } = useClub();
  const { refresh } = useUnread();
  const loader = useCallback(
    (signal: AbortSignal) =>
      api.list<Message>(`/questions/${conversation.id}/messages`, true, signal),
    [api, conversation.id],
  );
  const result = useLoad(loader);
  const request = useRequest();
  const [body, setBody] = useState('');
  const end = useRef<HTMLDivElement>(null);
  const messages = result.data ?? [];
  const unread = messages.some((message) => message.author_id !== account.id && !message.read_at);
  const canWrite = admin || (account.roles.includes('member') && account.messaging_allowed);
  useEffect(() => {
    end.current?.scrollIntoView?.({ block: 'nearest' });
  }, [messages.length]);
  useEffect(() => {
    if (!unread) return;
    const controller = new AbortController();
    api
      .request(`/questions/${conversation.id}/read`, 'POST', {}, controller.signal)
      .then(refresh)
      .catch(() => undefined);
    return () => controller.abort();
  }, [api, conversation.id, unread, refresh]);
  return (
    <section className="club-thread" aria-label="Conversation">
      <header>
        <Link className="club-back admin-button" to="?">
          <span aria-hidden="true">←</span> Conversations
        </Link>
        <h3>{conversation.event?.title ?? 'Événement indisponible'}</h3>
        {conversation.event && (
          <Link
            to={`/app/planning?semaine=${parisDay(conversation.event.starts_at)}&event=${conversation.event.id}`}
          >
            Voir l’événement
          </Link>
        )}
      </header>
      <LoadState result={result} />
      <ol className="club-messages">
        {messages.map((message) => {
          const mine = message.author_id === account.id;
          return (
            <li key={message.id} className={mine ? 'mine' : ''}>
              <span className="club-message-meta">
                {mine ? (
                  'Vous'
                ) : message.author_id === conversation.user_id ? (
                  <PersonName id={message.author_id} />
                ) : (
                  <>
                    <PersonName id={message.author_id} /> · administrateur
                  </>
                )}{' '}
                · {dateLabel(message.created_at)}
                {mine && message.read_at && ' · lu'}
              </span>
              <p>{message.body}</p>
            </li>
          );
        })}
      </ol>
      <div ref={end} />
      {canWrite ? (
        <form
          className="club-ask"
          onSubmit={(change) => {
            change.preventDefault();
            void request.run(async (signal) => {
              await api.request(
                `/questions/${conversation.id}/messages`,
                'POST',
                { body: body.trim() },
                signal,
              );
              setBody('');
              result.reload();
            });
          }}
        >
          <label htmlFor={`reply-${conversation.id}`}>
            {admin && conversation.user_id !== account.id ? 'Répondre' : 'Votre message'}
          </label>
          <textarea
            id={`reply-${conversation.id}`}
            value={body}
            maxLength={5000}
            required
            onChange={(change) => setBody(change.target.value)}
          />
          <ErrorNotice message={request.error} />
          <div className="admin-actions">
            <button
              className="admin-button primary"
              type="submit"
              disabled={request.pending || !body.trim()}
            >
              {request.pending ? 'Envoi…' : 'Envoyer'}
            </button>
          </div>
        </form>
      ) : (
        <p className="admin-hint">
          Votre droit d’écrire a été retiré ; vous pouvez toujours lire les réponses reçues.
        </p>
      )}
    </section>
  );
}
