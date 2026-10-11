import { useSearchParams } from 'react-router-dom';
import { useCallback, useState } from 'react';
import { useAdmin, useLoad, useResource } from './data';
import type { Conflict, Defaults, Mapping, Match } from './types';
import { Badge, Confirm, Empty, EntityForm, LoadState, Notice, PanelHeading, num, str } from './ui';
import { dateLabel } from './time';
import { Changes, fieldLabels } from './changes';
import { SourcesPanel, ClubPanel } from './SourcesPanel';

export function FFVBPanel() {
  const [search] = useSearchParams();
  // Les notifications FFVB ouvrent directement la bonne sous-vue (?vue=mappings…).
  const [view, setView] = useState(search.get('vue') ?? 'sources');
  const { api } = useAdmin();
  const clubLoader = useCallback(
    (signal: AbortSignal) =>
      api.request<{ club_code: string | null }>('/ffvb/club', 'GET', undefined, signal),
    [api],
  );
  const club = useLoad(clubLoader);
  const clubCode = club.data?.club_code ?? null;
  return (
    <>
      <PanelHeading
        title="FFVB"
        description="Configurez les imports, associez les gymnases et traitez les divergences avec le calendrier officiel."
      />
      <div className="admin-subtabs" aria-label="Gestion FFVB">
        {[
          { id: 'sources', label: 'Sources' },
          { id: 'club', label: 'Configuration du club' },
          { id: 'mappings', label: 'Gymnases FFVB' },
          { id: 'defaults', label: 'Marges et terrains' },
          { id: 'matches', label: 'Matchs importés' },
          { id: 'conflicts', label: 'Conflits' },
        ].map((item) => (
          <button
            className={`admin-button${view === item.id ? ' selected' : ''}`}
            aria-pressed={view === item.id}
            key={item.id}
            onClick={() => setView(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>
      <LoadState result={club} />
      <div key={view}>
        {view === 'sources' && (
          <SourcesPanel key={clubCode} clubCode={clubCode} configureClub={() => setView('club')} />
        )}
        {view === 'club' && club.loaded && !club.error && (
          <ClubPanel clubCode={clubCode} onSaved={club.reload} />
        )}
        {view === 'mappings' && <Mappings />}
        {view === 'defaults' && <MatchDefaults />}
        {view === 'matches' && <Matches />}
        {view === 'conflicts' && <Conflicts />}
      </div>
    </>
  );
}
function Mappings() {
  const { api, catalog } = useAdmin();
  const result = useResource<Mapping>('/ffvb/gym-mappings');
  const [editing, setEditing] = useState<Mapping | 'new' | null>(null);
  const [removing, setRemoving] = useState<Mapping | null>(null);
  const item = editing && editing !== 'new' ? editing : null;
  return (
    <>
      <div className="admin-actions">
        <button className="admin-button primary" onClick={() => setEditing('new')}>
          Associer un gymnase FFVB
        </button>
      </div>
      <p className="admin-hint">
        Les matchs reçus par le club (équipe à domicile commençant par « LSO COLOMBES ») sont
        rattachés automatiquement au gymnase local de même nom. Une association n’est utile que si
        le nom FFVB diffère du nom local. Accents et majuscules sont ignorés, et chaque changement
        s’applique tout de suite aux matchs déjà importés.
      </p>
      <LoadState result={result} />
      {editing && (
        <EntityForm
          key={item?.id ?? 'new'}
          title="Association de gymnase"
          fields={[
            { name: 'official_name', label: 'Nom officiel FFVB', required: true, maxLength: 200 },
            {
              name: 'gymnasium_id',
              label: 'Gymnase local',
              type: 'select',
              required: true,
              options: catalog.gymnasiums.map((gym) => ({ value: gym.id, label: gym.name })),
            },
          ]}
          initial={{
            official_name: item?.official_name ?? '',
            gymnasium_id: item?.gymnasium_id ?? '',
          }}
          onCancel={() => setEditing(null)}
          onSave={async (values, signal) => {
            await api.request(
              item ? `/ffvb/gym-mappings/${item.id}` : '/ffvb/gym-mappings',
              item ? 'PUT' : 'POST',
              {
                official_name: str(values, 'official_name'),
                gymnasium_id: str(values, 'gymnasium_id'),
              },
              signal,
            );
            setEditing(null);
            result.reload();
          }}
        />
      )}
      {result.loaded && !result.data?.length && (
        <Empty>
          Aucun nom FFVB associé. Les matchs à domicile sans association auront une occupation
          inconnue.
        </Empty>
      )}
      <div className="admin-list">
        {result.data?.map((mapping) => (
          <article className="admin-row" key={mapping.id}>
            <div className="admin-row-copy">
              <h3>{mapping.official_name}</h3>
              <p>
                {catalog.gymnasiums.find((gym) => gym.id === mapping.gymnasium_id)?.name ??
                  'Gymnase introuvable'}
              </p>
            </div>
            <div className="admin-actions">
              <button className="admin-button" onClick={() => setEditing(mapping)}>
                Modifier
              </button>
              <button className="admin-button danger" onClick={() => setRemoving(mapping)}>
                Supprimer
              </button>
            </div>
          </article>
        ))}
      </div>
      {removing && (
        <Confirm
          title="Supprimer cette association FFVB ?"
          label="Confirmer la suppression"
          onClose={() => setRemoving(null)}
          onConfirm={async (signal) => {
            await api.request(`/ffvb/gym-mappings/${removing.id}`, 'DELETE', undefined, signal);
            if (item?.id === removing.id) setEditing(null);
            result.reload();
          }}
        >
          <p>
            Le nom « {removing.official_name} » ne sera plus associé à ce gymnase pour les prochains
            imports.
          </p>
        </Confirm>
      )}
    </>
  );
}
function MatchDefaults() {
  const { api } = useAdmin();
  const loader = useCallback(
    (signal: AbortSignal) => api.request<Defaults>('/ffvb/defaults', 'GET', undefined, signal),
    [api],
  );
  const result = useLoad(loader);
  const [notice, setNotice] = useState('');
  return (
    <>
      <LoadState result={result} />
      {notice && <Notice>{notice}</Notice>}
      {result.data && (
        <EntityForm
          title="Configuration par défaut des sources"
          fields={[
            {
              name: 'before_minutes',
              label: 'Marge avant le coup d’envoi (minutes)',
              type: 'number',
              min: 0,
              max: 1440,
              required: true,
            },
            {
              name: 'after_minutes',
              label: 'Marge après le coup d’envoi (minutes)',
              type: 'number',
              min: 1,
              max: 1440,
              required: true,
            },
            {
              name: 'courts',
              label: 'Terrains réservés',
              type: 'number',
              min: 1,
              max: 100,
              required: true,
            },
          ]}
          initial={{
            before_minutes: String(result.data.before_minutes),
            after_minutes: String(result.data.after_minutes),
            courts: String(result.data.courts),
          }}
          onSave={async (values, signal) => {
            await api.request(
              '/ffvb/defaults',
              'PUT',
              {
                before_minutes: num(values, 'before_minutes'),
                after_minutes: num(values, 'after_minutes'),
                courts: num(values, 'courts'),
              },
              signal,
            );
            setNotice(
              'Configuration par défaut enregistrée. Elle s’appliquera aux prochains imports des sources sans réglage propre.',
            );
          }}
        >
          <p className="admin-hint">
            Valeurs de démarrage : 75 minutes avant, 150 minutes après et 3 terrains. Elles servent
            aux sources sans réglage propre (Sources › Modifier), pour les matchs importés ensuite.
            Les matchs existants restent inchangés.
          </p>
        </EntityForm>
      )}
    </>
  );
}
function Matches() {
  const { api } = useAdmin();
  const result = useResource<Match>('/ffvb/matches', true);
  const [reactivating, setReactivating] = useState<Match | null>(null);
  const [query, setQuery] = useState('');
  const filtered =
    result.data?.filter((match) => match.match_code.toLowerCase().includes(query.toLowerCase())) ??
    [];
  return (
    <>
      <LoadState result={result} />
      <div className="admin-toolbar">
        <label>
          Rechercher un match
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Code du match…"
          />
        </label>
        <button className="admin-button" onClick={result.reload}>
          Actualiser
        </button>
      </div>
      {result.loaded && !filtered.length && <Empty>Aucun match importé correspondant.</Empty>}
      <div className="admin-list">
        {filtered.map((match) => (
          <article className="admin-card" key={match.id}>
            <div className="admin-row">
              <div>
                <h3>
                  {match.match_code} · {match.season}
                </h3>
                <p>Dernière vérification : {dateLabel(match.last_verified_at)}</p>
                {match.disabled && <Badge tone="warning">Désactivé</Badge>}
                {match.suspended_until && (
                  <Badge tone="warning">Suspendu jusqu’au {dateLabel(match.suspended_until)}</Badge>
                )}
                {match.missing && <Badge tone="warning">Absent de la source officielle</Badge>}
              </div>
              {(match.disabled || match.suspended_until) && (
                <button className="admin-button" onClick={() => setReactivating(match)}>
                  Réactiver
                </button>
              )}
            </div>
            <details>
              <summary>État officiel et protections locales</summary>
              <Changes values={match.official} />
              <p>
                Champs protégés :{' '}
                {Object.keys(match.protected)
                  .map((key) => fieldLabels[key] ?? key)
                  .join(', ') || 'Aucun'}
              </p>
            </details>
          </article>
        ))}
      </div>
      {reactivating && (
        <Confirm
          title="Réactiver la vérification de ce match ?"
          onClose={() => setReactivating(null)}
          onConfirm={async (signal) => {
            await api.request(`/ffvb/matches/${reactivating.id}/reactivate`, 'POST', {}, signal);
            result.reload();
          }}
        >
          <p>
            La vérification FFVB de {reactivating.match_code} reprendra. Une divergence persistante
            pourra rouvrir un conflit.
          </p>
        </Confirm>
      )}
    </>
  );
}
function Conflicts() {
  const { api } = useAdmin();
  const result = useResource<Conflict>('/ffvb/conflicts');
  const matches = useResource<Match>('/ffvb/matches', true);
  const matchFor = (conflict: Conflict) =>
    matches.data?.find((match) => match.id === conflict.match_id);
  const matchTitle = (conflict: Conflict) => {
    const match = matchFor(conflict);
    return match ? `${match.match_code} · ${match.season}` : 'Identification du match indisponible';
  };
  const [resolving, setResolving] = useState<{
    conflict: Conflict;
    action: 'accept_ffvb' | 'suspend_48h' | 'disable';
  } | null>(null);
  const actions = [
    { id: 'accept_ffvb', label: 'Accepter la FFVB' },
    { id: 'suspend_48h', label: 'Suspendre 48 h' },
    { id: 'disable', label: 'Désactiver ce match' },
  ] as const;
  return (
    <>
      <LoadState result={result} />
      <LoadState result={matches} />
      <button
        className="admin-button"
        onClick={() => {
          result.reload();
          matches.reload();
        }}
      >
        Actualiser
      </button>
      {result.loaded && !result.data?.length && <Empty>Aucun conflit FFVB ouvert.</Empty>}
      <div className="admin-list">
        {result.data?.map((conflict) => (
          <article className="admin-card" key={conflict.id}>
            <h3>{matchTitle(conflict)}</h3>
            {matchFor(conflict) && (
              <p>
                {String(matchFor(conflict)?.official.home_team ?? '')} /{' '}
                {String(matchFor(conflict)?.official.away_team ?? '')}
              </p>
            )}
            <h4>Divergence : {fieldLabels[conflict.field] ?? conflict.field}</h4>
            <p>{dateLabel(conflict.created_at)}</p>
            <div className="conflict-values">
              <div>
                <h4>Valeur locale conservée</h4>
                <Changes values={{ [conflict.field]: conflict.local_value }} />
              </div>
              <div>
                <h4>Valeur officielle</h4>
                <Changes values={{ [conflict.field]: conflict.official_value }} />
              </div>
            </div>
            <div className="admin-actions">
              {actions.map((action) => (
                <button
                  className="admin-button"
                  key={action.id}
                  disabled={!matches.loaded || Boolean(matches.error) || !matchFor(conflict)}
                  onClick={() => setResolving({ conflict, action: action.id })}
                >
                  {action.label}
                </button>
              ))}
            </div>
          </article>
        ))}
      </div>
      {resolving && (
        <Confirm
          title={`${actions.find((action) => action.id === resolving.action)?.label ?? 'Résoudre le conflit'} : ${matchTitle(resolving.conflict)}`}
          onClose={() => setResolving(null)}
          onConfirm={async (signal) => {
            await api.request(
              `/ffvb/conflicts/${resolving.conflict.id}/resolve`,
              'POST',
              { action: resolving.action },
              signal,
            );
            result.reload();
            matches.reload();
          }}
        >
          <p>
            {resolving.action === 'accept_ffvb'
              ? 'La valeur officielle remplacera la valeur locale protégée. Cette décision sera historisée.'
              : resolving.action === 'suspend_48h'
                ? 'La valeur locale sera conservée et la vérification suspendue 48 heures. Une divergence persistante pourra rouvrir le conflit après reprise.'
                : 'La vérification sera désactivée pour ce match. Vous pourrez la réactiver depuis les matchs importés.'}
          </p>
        </Confirm>
      )}
    </>
  );
}
