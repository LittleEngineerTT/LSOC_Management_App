import { Navigate, useSearchParams } from 'react-router-dom';
import { useCallback, useState } from 'react';
import { useAdmin, useLoad, useResource } from './data';
import type { Defaults, Mapping } from './types';
import {
  Confirm,
  Empty,
  EntityForm,
  LoadState,
  Notice,
  PanelHeading,
  checked,
  num,
  str,
} from './ui';
import { SourcesPanel, ClubPanel } from './SourcesPanel';
import { SourceWarnings } from './SourceWarnings';

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
  // Les anciennes sous-vues « Matchs importés » et « Conflits » (liens d’anciennes notifications)
  // sont fusionnées dans l’onglet Conflits : divergences, réactivation et conflits ignorés.
  if (view === 'matches' || view === 'conflicts') return <Navigate to="?tab=conflicts" replace />;
  const clubCode = club.data?.club_code ?? null;
  return (
    <>
      <PanelHeading
        title="FFVB"
        description="Configurez les imports, associez les gymnases et réglez les marges des matchs. Les divergences avec le calendrier officiel se traitent dans l’onglet Conflits."
      />
      <SourceWarnings onCreate={() => setView('sources')} />
      <div className="admin-subtabs" aria-label="Gestion FFVB">
        {[
          { id: 'sources', label: 'Sources' },
          { id: 'club', label: 'Configuration du club' },
          { id: 'mappings', label: 'Gymnases FFVB' },
          { id: 'defaults', label: 'Marges et terrains' },
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
              name: 'whole_gym',
              label: 'Le match prend tout le gymnase',
              type: 'checkbox',
              hint: 'Réserve tous les terrains du gymnase, selon sa capacité, sans alerte de dépassement.',
            },
            {
              name: 'courts',
              label: 'Terrains réservés',
              type: 'number',
              min: 1,
              max: 100,
              required: true,
              hiddenWhen: 'whole_gym',
            },
          ]}
          initial={{
            before_minutes: String(result.data.before_minutes),
            after_minutes: String(result.data.after_minutes),
            whole_gym: result.data.courts === 0,
            courts: result.data.courts === 0 ? '3' : String(result.data.courts),
          }}
          onSave={async (values, signal) => {
            await api.request(
              '/ffvb/defaults',
              'PUT',
              {
                before_minutes: num(values, 'before_minutes'),
                after_minutes: num(values, 'after_minutes'),
                courts: checked(values, 'whole_gym') ? 0 : num(values, 'courts'),
              },
              signal,
            );
            setNotice(
              'Configuration par défaut enregistrée. Elle s’appliquera aux prochains imports des sources sans réglage propre.',
            );
          }}
        >
          <p className="admin-hint">
            Valeurs de démarrage : 75 minutes avant, 150 minutes après et 3 terrains. Un match qui
            prend tout le gymnase s’adapte à la capacité de chaque gymnase. Elles servent aux
            sources sans réglage propre (Sources › Modifier), pour les matchs importés ensuite. Les
            matchs existants restent inchangés.
          </p>
        </EntityForm>
      )}
    </>
  );
}
