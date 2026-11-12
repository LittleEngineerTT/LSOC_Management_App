import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { mondayOf, parisDay } from '../club/calendar';
import { Changes, fieldLabels } from './changes';
import { useAdmin, useLoad } from './data';
import type { Conflict, EventConflict, EventProblem } from './types';
import { dateLabel } from './time';
import { Badge, Confirm, Empty, LoadState, Notice, PanelHeading } from './ui';

// Le dépassement de capacité est un conflit ; l’indisponibilité du gymnase, à déplacer, reporter ou
// annuler, et les autres anomalies sont des erreurs à corriger.
const tones: Record<EventProblem['code'], string> = {
  capacity_exceeded: 'danger',
  missing_gymnasium: 'warning',
  no_referent: 'warning',
  ffvb_divergence: 'warning',
  ffvb_missing: 'warning',
  ffvb_disabled: 'warning',
  ffvb_suspended: 'warning',
  time_unknown: 'warning',
  unavailability_conflict: 'warning',
};

// Décisions possibles sur une divergence avec le calendrier officiel.
const resolutions = [
  { id: 'accept_ffvb', label: 'Accepter la FFVB' },
  { id: 'suspend_48h', label: 'Suspendre 48 h' },
  { id: 'disable', label: 'Désactiver ce match' },
] as const;
type Resolution = (typeof resolutions)[number]['id'];
const resolutionText: Record<Resolution, string> = {
  accept_ffvb:
    'La valeur officielle remplacera la valeur locale protégée. Cette décision sera historisée.',
  suspend_48h:
    'La valeur locale sera conservée et la vérification suspendue 48 heures. Une divergence persistante pourra rouvrir le conflit après reprise.',
  disable:
    'La vérification sera désactivée pour ce match. Vous pourrez la réactiver depuis cet onglet.',
};

type Pending =
  | { kind: 'reactivate'; conflict: EventConflict }
  | { kind: 'resolve'; conflict: EventConflict; divergence: Conflict; action: Resolution };

/** Conflits regroupés par `group_id`, dans l’ordre de la liste : un conflit de gymnase couvre
 * les événements qui s’y disputent les terrains ; sans groupe, chaque événement est seul. */
export function groupConflicts(items: EventConflict[]): EventConflict[][] {
  const groups = new Map<string, EventConflict[]>();
  for (const item of items) {
    const key = item.group_id || item.event.id;
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return [...groups.values()];
}
/** Nombre de conflits à traiter : les groupes dont un événement au moins n’est pas ignoré. */
export function openConflicts(items: EventConflict[]): number {
  return groupConflicts(items).filter((group) => group.some((item) => !item.ignored)).length;
}

function has(conflict: EventConflict, ...codes: EventProblem['code'][]) {
  return conflict.problems.some((problem) => codes.includes(problem.code));
}

/** Onglet « Conflits » : les événements à venir en conflit de capacité ou erronés, divergences
 * avec le calendrier FFVB comprises, qui s’y tranchent. Un événement terminé n’y figure plus. Un
 * conflit ignoré est masqué tant que ses problèmes ne changent pas. */
export function ConflictsPanel({
  onChanged,
}: {
  /** La liste a été relue (action, actualisation) : la pastille de l’onglet se met à jour. */
  onChanged?: () => void;
} = {}) {
  const { api, catalog } = useAdmin();
  const [showIgnored, setShowIgnored] = useState(false);
  const loader = useCallback(
    (signal: AbortSignal) =>
      api.list<EventConflict>(
        `/event-conflicts${showIgnored ? '?include_ignored=true' : ''}`,
        false,
        signal,
      ),
    [api, showIgnored],
  );
  const result = useLoad(loader);
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const place = (conflict: EventConflict) =>
    catalog.gymnasiums.find((gym) => gym.id === conflict.event.gymnasium_id)?.name ??
    (conflict.event.location || 'Lieu non renseigné');

  // Ignorer un conflit regroupé vaut pour tous ses événements ; il réapparaît si l’un change.
  async function toggleIgnore(group: EventConflict[]) {
    const ignored = group.every((conflict) => conflict.ignored);
    const name =
      group.length > 1 ? `du gymnase ${place(group[0]!)}` : `de ${group[0]!.event.title}`;
    setNotice('');
    setError('');
    setBusy(true);
    try {
      for (const conflict of group) {
        const path = `/event-conflicts/${encodeURIComponent(conflict.event.id)}/ignore`;
        if (ignored) await api.request(path, 'DELETE');
        else if (!conflict.ignored)
          await api.request(path, 'POST', { signature: conflict.signature });
      }
      setNotice(
        ignored
          ? `Le conflit ${name} est de nouveau suivi.`
          : `Conflit ${name} ignoré ; il réapparaîtra s’il change.`,
      );
      result.refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Action impossible. Réessayez.');
      result.refresh();
    } finally {
      setBusy(false);
    }
  }

  // Titre, date, problèmes et divergences d’un événement ; `nested` : dans un conflit regroupé.
  function details(conflict: EventConflict, nested: boolean) {
    const Heading = nested ? 'h4' : 'h3';
    return (
      <>
        <Heading>{conflict.event.title}</Heading>
        <p>
          {dateLabel(conflict.event.starts_at)} → {dateLabel(conflict.event.ends_at)}
          {nested ? '' : ` · ${place(conflict)}`}
        </p>
        <ul className="admin-problems" aria-label={`Problèmes de ${conflict.event.title}`}>
          {conflict.problems.map((problem) => (
            <li key={problem.code}>
              <Badge tone={tones[problem.code]}>{problem.message}</Badge>
            </li>
          ))}
        </ul>
        {(conflict.divergences ?? []).map((divergence) => (
          <section
            className="conflict-divergence"
            key={divergence.id}
            aria-label={`Divergence : ${fieldLabels[divergence.field] ?? divergence.field}`}
          >
            <h4>
              Divergence FFVB : {fieldLabels[divergence.field] ?? divergence.field}
              <span className="admin-hint"> · {dateLabel(divergence.created_at)}</span>
            </h4>
            <div className="conflict-values">
              <div>
                <h5>Valeur locale conservée</h5>
                <Changes values={{ [divergence.field]: divergence.local_value }} />
              </div>
              <div>
                <h5>Valeur officielle</h5>
                <Changes values={{ [divergence.field]: divergence.official_value }} />
              </div>
            </div>
            <div className="admin-actions">
              {resolutions.map((action) => (
                <button
                  className="admin-button"
                  key={action.id}
                  disabled={busy}
                  onClick={() => {
                    setNotice('');
                    setPending({ kind: 'resolve', conflict, divergence, action: action.id });
                  }}
                >
                  {action.label}
                </button>
              ))}
            </div>
          </section>
        ))}
      </>
    );
  }
  // Actions propres à un événement : l’ouvrir, réactiver sa vérification FFVB.
  function eventActions(conflict: EventConflict) {
    return (
      <>
        <Link
          className="admin-button"
          to={`/app/planning?semaine=${mondayOf(parisDay(conflict.event.starts_at))}&event=${encodeURIComponent(conflict.event.id)}`}
        >
          Ouvrir l’événement
        </Link>
        {conflict.event.ffvb_match_id && has(conflict, 'ffvb_disabled', 'ffvb_suspended') && (
          <button
            className="admin-button"
            disabled={busy}
            onClick={() => {
              setNotice('');
              setPending({ kind: 'reactivate', conflict });
            }}
          >
            Réactiver la vérification FFVB
          </button>
        )}
      </>
    );
  }

  const items = result.data ?? [];
  useEffect(() => {
    if (result.data) onChanged?.();
  }, [result.data, onChanged]);
  return (
    <>
      <PanelHeading
        title="Conflits"
        description="Événements à venir dont la capacité du gymnase est dépassée ou qui comportent une erreur : match à domicile sans gymnase, référent manquant, divergence avec le calendrier FFVB, vérification FFVB désactivée ou suspendue. Y figurent aussi les événements en conflit avec une indisponibilité du gymnase, à déplacer, reporter ou annuler. Les événements terminés n’y figurent plus."
      >
        <button className="admin-button" onClick={result.reload}>
          Actualiser
        </button>
      </PanelHeading>
      <div className="admin-toolbar">
        <label className="conflicts-filter">
          <input
            type="checkbox"
            checked={showIgnored}
            onChange={(change) => setShowIgnored(change.target.checked)}
          />
          Afficher les conflits ignorés
        </label>
      </div>
      <LoadState result={result} />
      {notice && <Notice>{notice}</Notice>}
      {error && (
        <p className="admin-notice" role="alert">
          {error}
        </p>
      )}
      {result.loaded && !result.error && !items.length && (
        <Empty>Aucun événement en conflit.</Empty>
      )}
      <div className="admin-list">
        {groupConflicts(items).map((group) => {
          const first = group[0]!;
          const ignored = group.every((conflict) => conflict.ignored);
          const ignoreButton = (
            <button
              className="admin-button"
              disabled={busy}
              onClick={() => void toggleIgnore(group)}
            >
              {ignored ? 'Ne plus ignorer' : 'Ignorer'}
            </button>
          );
          const ignoredLine = ignored && (
            <p className="conflict-ignored">
              Ignoré par {first.ignorer_name ?? 'un administrateur'}
              {first.ignored_at && ` · ${dateLabel(first.ignored_at)}`}
            </p>
          );
          if (group.length === 1)
            return (
              <article
                className={`admin-row conflict-item${ignored ? ' ignored' : ''}`}
                key={first.event.id}
              >
                <div className="admin-row-copy">
                  {details(first, false)}
                  {ignoredLine}
                </div>
                <div className="admin-actions">
                  {eventActions(first)}
                  {ignoreButton}
                </div>
              </article>
            );
          // Conflit de gymnase : un seul conflit pour les événements qui se disputent les terrains.
          const start = group.map((conflict) => conflict.event.starts_at).sort()[0]!;
          const end = group
            .map((conflict) => conflict.event.ends_at)
            .sort()
            .at(-1)!;
          return (
            <article
              className={`admin-row conflict-item conflict-group${ignored ? ' ignored' : ''}`}
              key={first.group_id ?? first.event.id}
              aria-label={`Conflit au gymnase ${place(first)}`}
            >
              <div className="admin-row-copy">
                <h3>Conflit au gymnase {place(first)}</h3>
                <p>
                  {dateLabel(start)} → {dateLabel(end)} · {group.length} événements
                </p>
                {ignoredLine}
                {group.map((conflict) => (
                  <section
                    className="conflict-member"
                    key={conflict.event.id}
                    aria-label={conflict.event.title}
                  >
                    {details(conflict, true)}
                    <div className="admin-actions">{eventActions(conflict)}</div>
                  </section>
                ))}
              </div>
              <div className="admin-actions">{ignoreButton}</div>
            </article>
          );
        })}
      </div>
      {pending?.kind === 'reactivate' && (
        <Confirm
          title="Réactiver la vérification de ce match ?"
          onClose={() => setPending(null)}
          onConfirm={async (signal) => {
            await api.request(
              `/ffvb/matches/${encodeURIComponent(pending.conflict.event.ffvb_match_id!)}/reactivate`,
              'POST',
              {},
              signal,
            );
            setNotice(`Vérification FFVB réactivée pour ${pending.conflict.event.title}.`);
            result.reload();
          }}
        >
          <p>
            La vérification FFVB de {pending.conflict.event.title} reprendra. Une divergence
            persistante avec le calendrier officiel sera de nouveau signalée.
          </p>
        </Confirm>
      )}
      {pending?.kind === 'resolve' && (
        <Confirm
          title={`${resolutions.find((action) => action.id === pending.action)?.label} : ${pending.conflict.event.title}`}
          onClose={() => setPending(null)}
          onConfirm={async (signal) => {
            await api.request(
              `/ffvb/conflicts/${encodeURIComponent(pending.divergence.id)}/resolve`,
              'POST',
              { action: pending.action },
              signal,
            );
            setNotice(`Divergence de ${pending.conflict.event.title} traitée.`);
            result.reload();
          }}
        >
          <p>{resolutionText[pending.action]}</p>
        </Confirm>
      )}
    </>
  );
}
