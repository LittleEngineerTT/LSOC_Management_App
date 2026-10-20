import { useCallback, useState } from 'react';
import { useLoad } from '../admin/data';
import {
  licenseLabels,
  licenseTones,
  type License,
  type LicenseStatus,
} from '../admin/LicensesPanel';
import { dateLabel } from '../admin/time';
import { Badge, Empty, EntityForm, LoadState, Notice, PanelHeading, str } from '../admin/ui';
import { ErrorNotice } from '../auth/components';
import { useRequest } from '../auth/useRequest';
import { useClub } from './context';
import type { StaffRequest } from './StaffRequests';
import { DossierCard, DossierRequestForm, MyDossier, progress, type Dossier } from './dossiers';

// Étapes de l’inscription d’un joueur : sa licence joueur, jusqu’à « Active ».
const steps: LicenseStatus[] = ['none', 'in_progress', 'payment_pending', 'active'];
type Filter = 'missing' | 'registered' | 'all' | 'dossier' | LicenseStatus;
const filters: {
  id: Filter;
  label: string;
  keep: (status: LicenseStatus, dossier: Dossier | undefined, asked: boolean) => boolean;
}[] = [
  { id: 'missing', label: 'Non inscrits', keep: (status) => status !== 'active' },
  { id: 'registered', label: 'Inscrits', keep: (status) => status === 'active' },
  { id: 'all', label: 'Tous', keep: () => true },
  {
    id: 'dossier',
    label: 'Dossier ou demande en cours',
    keep: (_, dossier, asked) => !!dossier || asked,
  },
  ...steps
    .filter((step) => step !== 'active')
    .map((step) => ({
      id: step,
      label: licenseLabels[step],
      keep: (status: LicenseStatus) => status === step,
    })),
];
type Grouping = 'team' | 'section' | 'none';

/** Application Inscriptions : suivi des joueurs pour l’encadrement, son dossier pour un joueur. */
export function InscriptionsPage() {
  const { api, account } = useClub();
  const staff = account.roles.some((role) => role === 'admin' || role === 'coach');
  const [panel, setPanel] = useState<'players' | 'mine'>('players');
  // Un admin ou un coach peut aussi avoir son propre dossier à compléter.
  const loader = useCallback(
    (signal: AbortSignal) =>
      staff
        ? api.request<Dossier | null>('/dossiers/me', 'GET', undefined, signal)
        : Promise.resolve(null),
    [api, staff],
  );
  const own = useLoad(loader);
  if (!staff) return <MyDossier />;
  const mine = !!own.data?.id;
  return (
    <>
      {mine && (
        <div className="admin-subtabs" role="group" aria-label="Panneau des inscriptions">
          {(
            [
              ['players', 'Suivi des joueurs'],
              ['mine', 'Mon inscription'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={`admin-button${panel === id ? ' selected' : ''}`}
              aria-pressed={panel === id}
              onClick={() => setPanel(id)}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      {mine && panel === 'mine' ? <MyDossier embedded /> : <PlayersTracking />}
    </>
  );
}

/** Suivi de l’inscription des joueurs, par équipe ou section et par étape. */
function PlayersTracking() {
  const { api, admin, sections, teams } = useClub();
  const loader = useCallback(
    (signal: AbortSignal) =>
      Promise.all([
        api.list<License>('/licenses', false, signal),
        api.list<Dossier>('/dossiers', false, signal),
        // Demandes de pièces en attente des administrateurs : celles du coach, toutes pour un admin.
        api.list<StaffRequest>('/requests?status=pending', false, signal),
      ]),
    [api],
  );
  const result = useLoad(loader);
  const [filter, setFilter] = useState<Filter>('missing');
  const [grouping, setGrouping] = useState<Grouping>('team');
  const [section, setSection] = useState('');
  const [team, setTeam] = useState('');
  const [editing, setEditing] = useState<License | null>(null);
  const [notice, setNotice] = useState('');
  const [requesting, setRequesting] = useState<License | null>(null);
  const [opened, setOpened] = useState('');
  const [licenses, dossiers, requests] = result.data ?? [[], [], []];
  const dossierOf = (userId: string) => dossiers.find((item) => item.user_id === userId);
  const askedOf = (userId: string) =>
    requests.filter((item) => item.kind === 'document' && item.player_id === userId);
  const decision = useRequest();
  function decide(item: StaffRequest, accept: boolean) {
    void decision.run(async (signal) => {
      await api.request(`/requests/${item.id}/decision`, 'POST', { accept, reason: '' }, signal);
      setNotice(
        accept
          ? 'Demande acceptée : le dossier du joueur est ouvert et il en est prévenu.'
          : 'Demande refusée ; le demandeur en est prévenu.',
      );
      if (accept && item.player_id) setOpened(item.player_id);
      result.reload();
    });
  }
  // Joueurs seulement ; leurs équipes sont déjà limitées au périmètre du compte.
  const players = licenses
    .map((item) => ({ ...item, teams: item.teams.filter((entry) => entry.kind === 'player') }))
    .filter((item) => item.teams.length > 0);
  const reachable = teams.filter((item) =>
    players.some((player) => player.teams.some((entry) => entry.team_id === item.id)),
  );
  const sectionOptions = sections.filter((item) =>
    reachable.some((entry) => entry.section_id === item.id),
  );
  const teamOptions = reachable.filter((item) => !section || item.section_id === section);
  const inScope = (teamId: string) => {
    const value = teams.find((item) => item.id === teamId);
    return (!team || teamId === team) && (!section || value?.section_id === section);
  };
  const scoped = players.filter((player) => player.teams.some((entry) => inScope(entry.team_id)));
  const current = filters.find((item) => item.id === filter)!;
  const shown = scoped.filter((player) =>
    current.keep(player.status, dossierOf(player.user_id), askedOf(player.user_id).length > 0),
  );
  const groups =
    grouping === 'none'
      ? [{ id: '', name: 'Tous les joueurs', members: shown }]
      : (grouping === 'team' ? teamOptions : sectionOptions)
          .filter((item) => grouping === 'team' || !section || item.id === section)
          .map((item) => ({
            id: item.id,
            name: item.name,
            members: shown.filter((player) =>
              player.teams.some(
                (entry) =>
                  inScope(entry.team_id) &&
                  (grouping === 'team'
                    ? entry.team_id === item.id
                    : teams.find((value) => value.id === entry.team_id)?.section_id === item.id),
              ),
            ),
          }))
          .filter((group) => group.members.length > 0);
  const teamNames = (player: License) =>
    player.teams
      .map((entry) => teams.find((item) => item.id === entry.team_id)?.name)
      .filter(Boolean)
      .join(', ');
  return (
    <>
      <PanelHeading
        title="Inscriptions"
        description={
          admin
            ? 'Suivi de l’inscription de chaque joueur, de « Pas de licence » à « Active ». Un joueur est inscrit quand sa licence joueur est active.'
            : 'Inscription des joueurs de vos équipes, en consultation seule.'
        }
      />
      <div className="admin-toolbar">
        <label>
          Section
          <select
            value={section}
            onChange={(change) => {
              setSection(change.target.value);
              setTeam('');
            }}
          >
            <option value="">Toutes les sections</option>
            {sectionOptions.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Équipe
          <select value={team} onChange={(change) => setTeam(change.target.value)}>
            <option value="">Toutes les équipes</option>
            {teamOptions.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Regrouper par
          <select
            value={grouping}
            onChange={(change) => setGrouping(change.target.value as Grouping)}
          >
            <option value="team">Équipe</option>
            <option value="section">Section</option>
            <option value="none">Sans regroupement</option>
          </select>
        </label>
      </div>
      <div className="admin-subtabs" role="group" aria-label="Étape d’inscription">
        {filters.map((item) => {
          const count = scoped.filter((player) =>
            item.keep(player.status, dossierOf(player.user_id), askedOf(player.user_id).length > 0),
          ).length;
          return (
            <button
              key={item.id}
              type="button"
              className={`admin-button${filter === item.id ? ' selected' : ''}`}
              aria-pressed={filter === item.id}
              onClick={() => setFilter(item.id)}
            >
              {item.label} ({count})
            </button>
          );
        })}
      </div>
      <LoadState result={result} />
      {notice && <Notice>{notice}</Notice>}
      <ErrorNotice message={decision.error} />
      {editing && (
        <EntityForm
          key={editing.user_id}
          title={`Inscription de ${editing.first_name}`}
          fields={[
            { name: 'number', label: 'Numéro de licence', maxLength: 40 },
            {
              name: 'status',
              label: 'Étape',
              type: 'select',
              required: true,
              options: steps.map((step) => ({ value: step, label: licenseLabels[step] })),
              hint: '« Active » exige un numéro de licence.',
            },
          ]}
          initial={{ number: editing.number ?? '', status: editing.status }}
          onCancel={() => setEditing(null)}
          onSave={async (values, signal) => {
            const status = str(values, 'status') as LicenseStatus;
            if (status === 'active' && !str(values, 'number'))
              throw new Error('Saisissez le numéro de licence pour la passer en « Active ».');
            await api.request(
              `/licenses/${editing.user_id}`,
              'PUT',
              { number: str(values, 'number') || null, status },
              signal,
            );
            setEditing(null);
            setNotice(`Inscription de ${editing.first_name} : ${licenseLabels[status]}.`);
            result.reload();
          }}
        />
      )}
      {result.loaded &&
        !result.error &&
        (groups.length ? (
          groups.map((group) => (
            <section
              className="admin-card club-inscriptions"
              key={group.id}
              aria-label={group.name}
            >
              <h3>
                {group.name} <span className="admin-hint">· {group.members.length}</span>
              </h3>
              <ul className="club-plain-list club-participants">
                {group.members.map((player) => {
                  const dossier = dossierOf(player.user_id);
                  const asked = askedOf(player.user_id);
                  const [done, total] = dossier ? progress(dossier) : [0, 0];
                  return (
                    <li key={player.user_id}>
                      <span>
                        <strong>{player.first_name}</strong>
                        {grouping !== 'team' && ` · ${teamNames(player)}`}
                        {player.updated_at && (
                          <span className="admin-hint">
                            {' '}
                            · mis à jour le {dateLabel(player.updated_at)}
                          </span>
                        )}
                      </span>
                      <span className="admin-actions">
                        <Badge tone={licenseTones[player.status]}>
                          {licenseLabels[player.status]} · étape {steps.indexOf(player.status) + 1}/
                          {steps.length}
                        </Badge>
                        {asked.map((item) => (
                          <span key={item.id} className="admin-actions">
                            <Badge tone="warning">
                              Pièces demandées par {item.actor_name} · en attente de validation
                            </Badge>
                            {admin && (
                              <>
                                <button
                                  type="button"
                                  className="admin-button"
                                  disabled={decision.pending}
                                  onClick={() => decide(item, true)}
                                >
                                  Accepter la demande
                                </button>
                                <button
                                  type="button"
                                  className="admin-button danger"
                                  disabled={decision.pending}
                                  onClick={() => decide(item, false)}
                                >
                                  Refuser
                                </button>
                              </>
                            )}
                          </span>
                        ))}
                        {dossier && (
                          <Badge tone={done === total ? 'good' : 'warning'}>
                            Dossier · {done}/{total}
                          </Badge>
                        )}
                        {dossier && (
                          <button
                            type="button"
                            className={`admin-button${opened === player.user_id ? ' selected' : ''}`}
                            aria-expanded={opened === player.user_id}
                            onClick={() =>
                              setOpened(opened === player.user_id ? '' : player.user_id)
                            }
                          >
                            Dossier
                          </button>
                        )}
                        <button
                          type="button"
                          className="admin-button"
                          onClick={() => {
                            setNotice('');
                            setRequesting(player);
                          }}
                        >
                          {dossier ? 'Compléter' : 'Demander des pièces'}
                        </button>
                        {admin && (
                          <button
                            type="button"
                            className="admin-button"
                            onClick={() => {
                              setNotice('');
                              setEditing(player);
                            }}
                          >
                            Modifier
                          </button>
                        )}
                      </span>
                      {requesting?.user_id === player.user_id && (
                        <DossierRequestForm
                          user={player}
                          dossier={dossier}
                          onCancel={() => setRequesting(null)}
                          onDone={(message) => {
                            setRequesting(null);
                            setNotice(message);
                            // Le dossier ouvert par un admin s’affiche aussitôt pour le suivi.
                            if (admin) setOpened(player.user_id);
                            result.reload();
                          }}
                        />
                      )}
                      {dossier && opened === player.user_id && (
                        <DossierCard
                          dossier={dossier}
                          onChanged={(message) => {
                            setNotice(message);
                            result.reload();
                          }}
                        />
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))
        ) : (
          <Empty>Aucun joueur à cette étape.</Empty>
        ))}
    </>
  );
}
