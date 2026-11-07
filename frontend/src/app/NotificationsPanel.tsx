import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ErrorNotice, Icon } from '../auth/components';
import { useSession } from '../auth/session';
import { useRequest } from '../auth/useRequest';
import { createAdminApi } from '../admin/api';
import { useLoad } from '../admin/data';
import { dateLabel } from '../admin/time';
import { LoadState } from '../admin/ui';
import type { Notification } from '../club/context';
import { CountBadge, useLiveReload, useUnread } from './unread';

// Pages qui ouvrent la fiche d’un événement passé en `?event=` ; ailleurs, le planning s’en charge.
const DETAIL_PAGES = ['/app', '/app/planning', '/app/mon-planning', '/app/equipes'];

/** Action proposée par une notification, d’après l’écran où elle se traite. */
export function actionLabel(item: Notification): string | null {
  if (item.link?.includes('tab=requests')) return 'Examiner la demande';
  if (item.link?.startsWith('/app/messagerie')) return 'Voir le message';
  return null;
}

// Le panneau ne présente que les dernières notifications, non lues en tête.
const LIMIT = 20;

/** Cloche du bandeau : pastille des notifications non lues et panneau qui présente les
 * 20 dernières, non lues d’abord. Seul « Marquer comme lu » passe une notification en lue :
 * la suivre vers son écran la laisse non lue. Les lues restent masquées tant que « Tout afficher »
 * n’est pas coché. */
export function NotificationsPanel() {
  const { csrfToken, clear } = useSession();
  const api = useMemo(() => createAdminApi(csrfToken, clear), [csrfToken, clear]);
  const { notifications: total, refresh } = useUnread();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);
  // Lues pendant la session du panneau, avant la relecture de la liste.
  const [read, setRead] = useState<Set<string>>(new Set());
  const control = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const request = useRequest();
  // La liste n’est lue qu’à l’ouverture du panneau, puis à chaque signal du serveur.
  const loader = useCallback(
    (signal: AbortSignal) =>
      open
        ? api.request<Notification[]>(
            `/notifications?unread_first=true&limit=${LIMIT}`,
            'GET',
            undefined,
            signal,
          )
        : Promise.resolve(null),
    [api, open],
  );
  const result = useLoad(loader);
  useLiveReload(result.refresh);
  const isRead = (item: Notification) => Boolean(item.read_at) || read.has(item.id);
  const items = result.data ?? [];
  const unread = items.filter((item) => !isRead(item));
  // Les déjà lues suivent, de la plus récente à la plus ancienne.
  const past = items.filter(isRead).sort((a, b) => b.created_at.localeCompare(a.created_at));
  const count = open && result.data ? Math.max(total, unread.length) : total;

  useEffect(() => {
    if (!open) return;
    function outside(event: PointerEvent) {
      if (event.target instanceof Node && !control.current?.contains(event.target)) setOpen(false);
    }
    function escape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false);
        button.current?.focus();
      }
    }
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  // Chaque notification mène à l’action attendue : lien explicite, sinon l’événement.
  function target(item: Notification) {
    if (item.link) return item.link;
    if (!item.event_id) return null;
    if (!DETAIL_PAGES.includes(location.pathname)) return `/app/planning?event=${item.event_id}`;
    const next = new URLSearchParams(location.search);
    next.set('event', item.event_id);
    return `${location.pathname}?${next.toString()}`;
  }
  function markRead(ids: string[]) {
    void request.run(async (signal) => {
      for (const id of ids) {
        await api.request(`/notifications/${id}/read`, 'POST', {}, signal);
        setRead((previous) => new Set(previous).add(id));
      }
      refresh();
    });
  }

  function row(item: Notification, fresh: boolean) {
    const to = target(item);
    const action = to ? actionLabel(item) : null;
    return (
      <li key={item.id} className={fresh ? 'unread' : 'read'}>
        <div className="notifications-copy">
          <span className="notifications-title">
            {to ? (
              <Link to={to} onClick={() => setOpen(false)}>
                {item.title}
              </Link>
            ) : (
              item.title
            )}
          </span>
          <span className="notifications-date">
            {dateLabel(item.created_at)}
            {!fresh && ' · lue'}
          </span>
          {item.body && <span className="notifications-body">{item.body}</span>}
          {(action || fresh) && (
            <span className="notifications-actions">
              {action && (
                <Link
                  className={`admin-button${fresh ? ' primary' : ''}`}
                  to={to!}
                  onClick={() => setOpen(false)}
                >
                  {action}
                </Link>
              )}
              {fresh && (
                <button
                  type="button"
                  className="admin-button"
                  disabled={request.pending}
                  onClick={() => markRead([item.id])}
                >
                  Marquer comme lu
                </button>
              )}
            </span>
          )}
        </div>
      </li>
    );
  }

  return (
    <div className="notifications-control" ref={control}>
      <button
        ref={button}
        type="button"
        className={`notifications-button${open ? ' active' : ''}`}
        aria-label="Notifications"
        aria-expanded={open}
        aria-controls="notifications-panel"
        onClick={() => setOpen(!open)}
      >
        <Icon name="bell" />
        <CountBadge count={count} label={['notification non lue', 'notifications non lues']} />
      </button>
      {open && (
        <section
          className="notifications-panel"
          id="notifications-panel"
          aria-label="Notifications"
        >
          <header className="notifications-head">
            <h2>
              Notifications
              {count > 0 && <span className="notifications-total">{count}</span>}
            </h2>
            {unread.length > 1 && (
              <button
                type="button"
                className="notifications-link"
                disabled={request.pending}
                onClick={() => markRead(unread.map((item) => item.id))}
              >
                Tout marquer comme lu
              </button>
            )}
          </header>
          <ErrorNotice message={request.error} />
          <div className="notifications-scroll">
            <LoadState result={result} />
            {result.loaded && !result.error && !unread.length && (
              <p className="notifications-empty">
                <Icon name="check" />
                Aucune nouvelle notification.
              </p>
            )}
            {unread.length > 0 && (
              <ul className="notifications-list">{unread.map((item) => row(item, true))}</ul>
            )}
            {showAll && past.length > 0 && (
              <>
                <h3 className="notifications-group">Déjà lues</h3>
                <ul className="notifications-list">{past.map((item) => row(item, false))}</ul>
              </>
            )}
          </div>
          {past.length > 0 && (
            <footer className="notifications-foot">
              <label>
                <input
                  type="checkbox"
                  checked={showAll}
                  onChange={(change) => setShowAll(change.target.checked)}
                />
                Tout afficher
              </label>
              <span>
                {past.length} déjà lue{past.length > 1 ? 's' : ''}
              </span>
            </footer>
          )}
        </section>
      )}
    </div>
  );
}
