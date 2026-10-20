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
import { useClub } from './context';

// Étapes de l’inscription d’un joueur : sa licence joueur, jusqu’à « Active ».
const steps: LicenseStatus[] = ['none', 'in_progress', 'payment_pending', 'active'];
type Filter = 'missing' | 'registered' | 'all' | LicenseStatus;
const filters: { id: Filter; label: string; keep: (status: LicenseStatus) => boolean }[] = [
  { id: 'missing', label: 'Non inscrits', keep: (status) => status !== 'active' },
  { id: 'registered', label: 'Inscrits', keep: (status) => status === 'active' },
  { id: 'all', label: 'Tous', keep: () => true },
  ...steps
    .filter((step) => step !== 'active')
    .map((step) => ({
      id: step,
      label: licenseLabels[step],
      keep: (status: LicenseStatus) => status === step,
    })),
];
type Grouping = 'team' | 'section' | 'none';

/** Suivi de l’inscription des joueurs, par équipe ou section et par étape. */
export function InscriptionsPage() {
  const { api, admin, sections, teams } = useClub();
  const loader = useCallback(
    (signal: AbortSignal) => api.list<License>('/licenses', false, signal),
    [api],
  );
  const result = useLoad(loader);
  const [filter, setFilter] = useState<Filter>('missing');
  const [grouping, setGrouping] = useState<Grouping>('team');
  const [section, setSection] = useState('');
  const [team, setTeam] = useState('');
  const [editing, setEditing] = useState<License | null>(null);
  const [notice, setNotice] = useState('');
  // Joueurs seulement ; leurs équipes sont déjà limitées au périmètre du compte.
  const players = (result.data ?? [])
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
  const shown = scoped.filter((player) => current.keep(player.status));
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
          const count = scoped.filter((player) => item.keep(player.status)).length;
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
                {group.members.map((player) => (
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
                  </li>
                ))}
              </ul>
            </section>
          ))
        ) : (
          <Empty>Aucun joueur à cette étape.</Empty>
        ))}
    </>
  );
}
