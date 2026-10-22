import { useState } from 'react';
import { useAdmin, useResource } from './data';
import type { Source } from './types';
import {
  Badge,
  checked,
  Confirm,
  Empty,
  EntityForm,
  LoadState,
  Notice,
  num,
  str,
  type FormField,
  type FormValues,
} from './ui';
import { dateLabel } from './time';
import { useRequest } from '../auth/useRequest';
import { ErrorNotice } from '../auth/components';

interface Candidate {
  team_number: string;
  team_name: string;
  team_id: string | null;
}
interface Preview {
  season: string;
  entity: string;
  pool: string;
  club_code: string | null;
  candidates: Candidate[];
  warning: string | null;
}
const optional = (values: FormValues, name: string) =>
  str(values, name) ? num(values, name) : null;
const setting = (value: number | null | undefined) => (value == null ? '' : String(value));
function settingsLabel(source: Source) {
  const own = [
    source.courts != null && `${source.courts} terrain${source.courts > 1 ? 's' : ''}`,
    source.before_minutes != null && `${source.before_minutes} min avant`,
    source.after_minutes != null && `${source.after_minutes} min après`,
  ].filter(Boolean);
  return own.length ? `Réglages propres : ${own.join(', ')}` : 'Configuration par défaut';
}
const days = (source: Source) =>
  source.interval_days ?? Math.max(1, Math.ceil(source.interval_minutes / 1440));
export function SourcesPanel({
  clubCode,
  configureClub,
}: {
  clubCode: string | null;
  configureClub: () => void;
}) {
  const { api, catalog, reloadCatalog } = useAdmin();
  const result = useResource<Source>('/ffvb/sources');
  const request = useRequest();
  const [editing, setEditing] = useState<Source | 'new' | null>(null);
  const [initial, setInitial] = useState<FormValues>({});
  const [formKey, setFormKey] = useState(0);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [notice, setNotice] = useState('');
  const [removing, setRemoving] = useState<Source | null>(null);
  const item = editing && editing !== 'new' ? editing : null;
  // Plusieurs sources portent souvent le même nom FFVB : l’équipe locale les distingue.
  function localTeam(id: string) {
    const team = catalog.teams.find((value) => value.id === id);
    if (!team) return 'Équipe supprimée';
    const section = catalog.sections.find((value) => value.id === team.section_id);
    return section ? `${team.name} (${section.name})` : team.name;
  }
  const fields: FormField[] = [
    {
      name: 'team_id',
      label: 'Équipe locale',
      type: 'select',
      required: true,
      options: catalog.teams.map((team) => ({ value: team.id, label: team.name })),
    },
    {
      name: 'season',
      label: 'Saison',
      required: true,
      hint: 'Deux années consécutives, par exemple 2026/2027.',
    },
    {
      name: 'entity',
      label: 'Entité FFVB',
      required: true,
      maxLength: 30,
      pattern: '[A-Za-z0-9]+',
    },
    { name: 'pool', label: 'Poule', required: true, maxLength: 30, pattern: '[A-Za-z0-9]+' },
    {
      name: 'team_number',
      label: 'Numéro d’équipe FFVB',
      required: true,
      maxLength: 20,
      pattern: '[0-9]+',
    },
    { name: 'team_name', label: 'Nom d’équipe FFVB', required: true, maxLength: 200 },
    {
      name: 'club_code',
      label: 'Code du club FFVB',
      disabled: true,
      hint: 'Ce code est défini une seule fois dans la configuration du club.',
    },
    {
      name: 'interval_days',
      label: 'Fréquence (jours)',
      type: 'number',
      required: true,
      min: 1,
      max: 365,
    },
    {
      name: 'courts',
      label: 'Terrains réservés par match',
      type: 'number',
      min: 1,
      max: 100,
      hint: 'Laissez vide pour suivre la configuration par défaut (onglet Marges et terrains).',
    },
    {
      name: 'before_minutes',
      label: 'Marge avant le coup d’envoi (minutes)',
      type: 'number',
      min: 0,
      max: 1440,
      hint: 'Vide : configuration par défaut.',
    },
    {
      name: 'after_minutes',
      label: 'Marge après le coup d’envoi (minutes)',
      type: 'number',
      min: 1,
      max: 1440,
      hint: 'Vide : configuration par défaut. Un changement s’applique aux matchs à venir, sauf valeur modifiée à la main sur un match.',
    },
    {
      name: 'enabled',
      label: 'Activer la synchronisation périodique',
      type: 'checkbox',
      hint: 'L’équipe locale doit avoir un référent actif.',
    },
  ];
  function editNew(values: FormValues = {}) {
    setEditing('new');
    setInitial(values);
    setFormKey((value) => value + 1);
  }
  async function save(values: FormValues, signal: AbortSignal, existing: Source | null = item) {
    const sourceClubCode = existing?.club_code ?? clubCode;
    if (!sourceClubCode) throw new Error('Configurez d’abord le code du club.');
    const [start, end] = str(values, 'season').split('/').map(Number);
    if (!/^[0-9]{4}\/[0-9]{4}$/.test(str(values, 'season')) || end !== Number(start) + 1)
      throw new Error('La saison doit couvrir deux années consécutives.');
    const team = catalog.teams.find((team) => team.id === str(values, 'team_id'));
    if (
      checked(values, 'enabled') &&
      !catalog.users.some((user) => team?.referent_ids.includes(user.id) && user.active)
    )
      throw new Error('Attribuez d’abord un référent actif à cette équipe.');
    const body = {
      team_id: str(values, 'team_id'),
      season: str(values, 'season'),
      entity: str(values, 'entity'),
      pool: str(values, 'pool'),
      team_number: str(values, 'team_number'),
      team_name: str(values, 'team_name'),
      club_code: sourceClubCode,
      enabled: checked(values, 'enabled'),
      courts: optional(values, 'courts'),
      before_minutes: optional(values, 'before_minutes'),
      after_minutes: optional(values, 'after_minutes'),
      interval_days: num(values, 'interval_days'),
    };
    await api.request(
      existing ? `/ffvb/sources/${existing.id}` : '/ffvb/sources',
      existing ? 'PUT' : 'POST',
      body,
      signal,
    );
    setEditing(null);
    setPreview(null);
    setNotice('Source enregistrée.');
    result.reload();
    reloadCatalog();
  }
  return (
    <>
      {!clubCode ? (
        <div className="admin-notice">
          <p>Configurez le code du club une seule fois avant d’ajouter une source.</p>
          <button className="admin-button" onClick={configureClub}>
            Configurer le club
          </button>
        </div>
      ) : (
        <EntityForm
          title="Ajouter une source depuis son URL"
          fields={[
            {
              name: 'url',
              label: 'URL du calendrier FFVB',
              required: true,
              maxLength: 2048,
              hint: 'Collez le lien de la poule ou de l’équipe sur ffvbbeach.org.',
            },
            {
              name: 'interval_days',
              label: 'Fréquence de la nouvelle source (jours)',
              type: 'number',
              required: true,
              min: 1,
              max: 365,
            },
          ]}
          initial={{ url: '', interval_days: '1' }}
          submit="Créer depuis l’URL"
          onSave={async (values, signal) => {
            setNotice('');
            const value = await api.request<Preview>(
              '/ffvb/sources/preview',
              'POST',
              { url: str(values, 'url') },
              signal,
            );
            setPreview(value);
            const candidate = value.candidates.length === 1 ? value.candidates[0] : undefined;
            const draft: FormValues = {
              season: value.season,
              entity: value.entity,
              pool: value.pool,
              team_number: candidate?.team_number ?? '',
              team_name: candidate?.team_name ?? '',
              team_id: candidate?.team_id ?? '',
              interval_days: str(values, 'interval_days'),
              enabled: true,
            };
            const team = catalog.teams.find((team) => team.id === candidate?.team_id);
            if (
              !value.warning &&
              candidate?.team_id &&
              catalog.users.some((user) => team?.referent_ids.includes(user.id) && user.active)
            ) {
              try {
                await save(draft, signal, null);
              } catch (error) {
                if (!signal.aborted) editNew(draft);
                throw error;
              }
            } else {
              editNew(draft);
              setNotice(
                value.warning ??
                  'Les informations FFVB sont récupérées. Complétez le rattachement à une équipe locale et son référent si nécessaire.',
              );
            }
          }}
        />
      )}
      <div className="admin-actions">
        <button
          className="admin-button"
          disabled={!clubCode}
          onClick={() => {
            editNew();
            setPreview(null);
            setNotice('');
          }}
        >
          Ajouter une source
        </button>
        <button className="admin-button" onClick={result.reload}>
          Actualiser
        </button>
      </div>
      <LoadState result={result} />
      <ErrorNotice message={request.error} />
      {notice && <Notice>{notice}</Notice>}
      {!catalog.teams.length && (
        <p className="admin-hint">
          Créez une équipe locale et attribuez-lui un référent actif avant d’activer une source.
        </p>
      )}
      {preview && preview.candidates.length > 1 && (
        <div className="admin-card">
          <h3>Équipes identifiées dans cette poule</h3>
          <div className="admin-actions">
            {preview.candidates.map((candidate) => (
              <button
                className="admin-button"
                key={candidate.team_number}
                onClick={() =>
                  editNew({
                    ...initial,
                    season: preview.season,
                    entity: preview.entity,
                    pool: preview.pool,
                    team_number: candidate.team_number,
                    team_name: candidate.team_name,
                    team_id: candidate.team_id ?? '',
                  })
                }
              >
                {candidate.team_name} n°{candidate.team_number}
              </button>
            ))}
          </div>
        </div>
      )}
      {editing && (
        <EntityForm
          key={item?.id ?? `new:${formKey}`}
          title={item ? 'Modifier la source' : 'Compléter la source FFVB'}
          fields={fields}
          initial={{
            team_id: item?.team_id ?? '',
            season: item?.season ?? '2026/2027',
            entity: item?.entity ?? 'PTIDF92',
            pool: item?.pool ?? 'BRC',
            team_number: item?.team_number ?? '6',
            team_name: item?.team_name ?? 'LSO COLOMBES',
            interval_days: String(item ? Math.ceil(days(item)) : 1),
            enabled: item?.enabled ?? true,
            courts: setting(item?.courts),
            before_minutes: setting(item?.before_minutes),
            after_minutes: setting(item?.after_minutes),
            ...(!item ? initial : {}),
            club_code: item?.club_code ?? clubCode ?? '',
          }}
          onCancel={() => {
            setEditing(null);
            setPreview(null);
          }}
          onSave={save}
        >
          {item && (
            <p className="admin-hint">
              Après un premier import, l’identité de cette source ne peut plus changer. Créez une
              nouvelle source pour une autre équipe ou saison. La désactivation et la fréquence
              restent modifiables.
            </p>
          )}
          {item && item.club_code !== clubCode && (
            <p className="admin-hint">
              Cette source existante conserve son code de club d’origine. Les nouvelles sources
              utilisent le code configuré pour le club.
            </p>
          )}
        </EntityForm>
      )}
      {result.loaded && !result.data?.length && <Empty>Aucune source FFVB configurée.</Empty>}
      <div className="admin-list">
        {result.data?.map((source) => (
          <article className="admin-row" key={source.id}>
            <div className="admin-row-copy">
              <h3>
                {source.team_name} n°{source.team_number}
              </h3>
              <p className="admin-source-team">
                Équipe locale : <strong>{localTeam(source.team_id)}</strong>
              </p>
              <p>
                {source.season} · {source.entity} · {source.pool} · {days(source)} jour(s)
              </p>
              <p>{settingsLabel(source)}</p>
              <Badge tone={source.enabled ? 'good' : ''}>
                {source.enabled ? 'Activée' : 'Désactivée'}
              </Badge>
              <p>Dernière réussite : {dateLabel(source.last_success_at)}</p>
              {source.last_error && <p className="admin-warning">{source.last_error}</p>}
            </div>
            <div className="admin-actions">
              <button
                className="admin-button"
                onClick={() => {
                  setEditing(source);
                  setPreview(null);
                }}
              >
                Modifier
              </button>
              <button
                className="admin-button"
                disabled={request.pending}
                onClick={() => {
                  setNotice('');
                  void request.run(async (signal) => {
                    const value = await api.request<Source>(
                      `/ffvb/sources/${source.id}/sync`,
                      'POST',
                      {},
                      signal,
                    );
                    result.reload();
                    if (value.last_error)
                      throw new Error(
                        `Synchronisation impossible : ${value.last_error}. Les données précédentes sont conservées.`,
                      );
                    setNotice('Synchronisation réussie.');
                  });
                }}
              >
                Synchroniser
              </button>
              <button
                className="admin-button danger"
                onClick={() => {
                  setNotice('');
                  setRemoving(source);
                }}
              >
                Supprimer
              </button>
            </div>
          </article>
        ))}
      </div>
      {removing && (
        <Confirm
          title={`Supprimer la source ${removing.team_name} n°${removing.team_number} (équipe locale ${localTeam(removing.team_id)}) ?`}
          label="Supprimer la source"
          onClose={() => setRemoving(null)}
          onConfirm={async (signal) => {
            await api.request(`/ffvb/sources/${removing.id}`, 'DELETE', undefined, signal);
            if (editing && editing !== 'new' && editing.id === removing.id) setEditing(null);
            setNotice('Source supprimée avec tous ses matchs.');
            result.reload();
          }}
        >
          <p>
            La source et tous les matchs importés depuis elle, passés comme à venir, sont supprimés
            définitivement avec leur historique, leurs suivis et leurs inscriptions. Les personnes
            concernées sont prévenues. Cette action est irréversible.
          </p>
        </Confirm>
      )}
    </>
  );
}

export function ClubPanel({ clubCode, onSaved }: { clubCode: string | null; onSaved: () => void }) {
  const { api } = useAdmin();
  return clubCode ? (
    <section className="admin-card">
      <h3>Configuration du club FFVB</h3>
      <div className="admin-field">
        <label htmlFor="ffvb-club-code">Code du club FFVB</label>
        <input id="ffvb-club-code" value={clubCode} disabled readOnly />
      </div>
      <p className="admin-hint">
        Le code du club est enregistré et verrouillé. Les nouvelles sources utilisent ce code.
      </p>
      <Badge>Configuration verrouillée</Badge>
    </section>
  ) : (
    <EntityForm
      title="Configurer le club FFVB"
      fields={[
        {
          name: 'club_code',
          label: 'Code du club FFVB',
          required: true,
          maxLength: 30,
          pattern: '[0-9]+',
          hint: 'Ce code sera enregistré une seule fois, puis verrouillé pour toutes les sources.',
        },
      ]}
      initial={{ club_code: '0926620' }}
      submit="Enregistrer le code du club"
      onSave={async (values, signal) => {
        await api.request('/ffvb/club', 'PUT', { club_code: str(values, 'club_code') }, signal);
        onSaved();
      }}
    />
  );
}
