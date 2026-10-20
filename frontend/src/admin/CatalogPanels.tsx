import { useState, type ReactNode } from 'react';
import { useAdmin, useResource } from './data';
import type { Assignment, Gymnasium, Position, Section, Team } from './types';
import { displayName } from './UsersPanel';
import { TeamSourceWarningPreference } from './SourceWarnings';
import {
  choices,
  Confirm,
  Empty,
  EntityForm,
  Notice,
  PanelHeading,
  num,
  str,
  type FormField,
  type FormValues,
} from './ui';

interface CatalogConfig<T extends Section> {
  title: string;
  description: string;
  add: string;
  path: string;
  items: T[];
  fields: FormField[];
  initial: (item: T | null) => FormValues;
  payload: (values: FormValues) => object;
  describe: (item: T) => ReactNode;
}
function CatalogPanel<T extends Section>(config: CatalogConfig<T>) {
  const { api, reloadCatalog, admin } = useAdmin();
  const [editing, setEditing] = useState<T | 'new' | null>(null);
  const [removing, setRemoving] = useState<T | null>(null);
  const [notice, setNotice] = useState('');
  const item = editing && editing !== 'new' ? editing : null;
  return (
    <>
      <PanelHeading
        title={config.title}
        description={admin ? config.description : 'Consultation seule.'}
      >
        {admin && (
          <button
            className="admin-button primary"
            onClick={() => {
              setEditing('new');
              setNotice('');
            }}
          >
            {config.add}
          </button>
        )}
      </PanelHeading>
      {notice && <Notice>{notice}</Notice>}
      {editing && (
        <EntityForm
          key={item?.id ?? 'new'}
          title={item ? `Modifier ${item.name}` : config.add}
          fields={config.fields}
          initial={config.initial(item)}
          submit={item ? 'Enregistrer' : 'Créer'}
          onCancel={() => setEditing(null)}
          onSave={async (values, signal) => {
            await api.request(
              item ? `${config.path}/${item.id}` : config.path,
              item ? 'PUT' : 'POST',
              config.payload(values),
              signal,
            );
            setEditing(null);
            setNotice(item ? 'Modification enregistrée.' : 'Création enregistrée.');
            reloadCatalog();
          }}
        />
      )}
      {!config.items.length ? (
        <Empty>
          {admin ? 'Aucun élément pour le moment. Commencez par une création.' : 'Aucun élément.'}
        </Empty>
      ) : (
        <div className="admin-list">
          {config.items.map((value) => (
            <article className="admin-row" key={value.id}>
              <div className="admin-row-copy">
                <h3>{value.name}</h3>
                {config.describe(value)}
              </div>
              {admin && (
                <div className="admin-actions">
                  <button
                    className="admin-button"
                    aria-label={`Modifier ${value.name}`}
                    onClick={() => {
                      setEditing(value);
                      setNotice('');
                    }}
                  >
                    Modifier
                  </button>
                  <button
                    className="admin-button danger"
                    aria-label={`Supprimer ${value.name}`}
                    onClick={() => setRemoving(value)}
                  >
                    Supprimer
                  </button>
                </div>
              )}
            </article>
          ))}
        </div>
      )}
      {removing && (
        <Confirm
          title={`Supprimer ${removing.name} ?`}
          label="Confirmer la suppression"
          onClose={() => setRemoving(null)}
          onConfirm={async (signal) => {
            await api.request(`${config.path}/${removing.id}`, 'DELETE', undefined, signal);
            if (item?.id === removing.id) setEditing(null);
            setNotice('Suppression effectuée.');
            reloadCatalog();
          }}
        >
          <p>
            Cette suppression est définitive. Si cet élément est encore utilisé, le serveur refusera
            la suppression ; retirez d’abord ses liens.
          </p>
        </Confirm>
      )}
    </>
  );
}
const name: FormField = { name: 'name', label: 'Nom', required: true, maxLength: 120 };
export function GymnasiumsPanel() {
  const { catalog } = useAdmin();
  return (
    <CatalogPanel<Gymnasium>
      title="Gymnases"
      description="Définissez les lieux et le nombre de terrains disponibles pour les réservations."
      add="Ajouter un gymnase"
      path="/gymnasiums"
      items={catalog.gymnasiums}
      fields={[
        name,
        {
          name: 'capacity',
          label: 'Capacité en terrains',
          type: 'number',
          min: 1,
          max: 100,
          required: true,
          hint: 'Une baisse de capacité peut déclencher des alertes sur les réservations existantes.',
        },
      ]}
      initial={(item) => ({ name: item?.name ?? '', capacity: String(item?.capacity ?? 3) })}
      payload={(values) => ({ name: str(values, 'name'), capacity: num(values, 'capacity') })}
      describe={(item) => (
        <p>
          {item.capacity} terrain{item.capacity > 1 ? 's' : ''}
        </p>
      )}
    />
  );
}

export function PositionsPanel() {
  const { catalog } = useAdmin();
  return (
    <CatalogPanel<Position>
      title="Postes des joueurs"
      description="Définissez les postes que l’on peut attribuer aux joueurs dans leurs équipes."
      add="Ajouter un poste"
      path="/positions"
      items={catalog.positions}
      fields={[{ ...name, maxLength: 120 }]}
      initial={(item) => ({ name: item?.name ?? '' })}
      payload={(values) => ({ name: str(values, 'name') })}
      describe={() => null}
    />
  );
}

type Editing =
  | { kind: 'section'; item: Section | null }
  | { kind: 'team'; item: Team | null; section?: string }
  | null;
type Removing = { kind: 'section'; item: Section } | { kind: 'team'; item: Team } | null;

/** Sections dépliables, avec leurs équipes ; un coach les consulte sans les modifier. */
export function SectionsTeamsPanel() {
  const { api, catalog, reloadCatalog, admin, referents } = useAdmin();
  const [editing, setEditing] = useState<Editing>(null);
  const [removing, setRemoving] = useState<Removing>(null);
  // Effectif : joueurs de chaque équipe regroupés par poste, puis par numéro ; les joueurs
  // sans poste en dernier (périmètre du coach filtré par le serveur).
  const assignments = useResource<Assignment>('/assignments', true);
  const roster = (team: Team) => {
    const players = (assignments.data ?? [])
      .filter((item) => item.team_id === team.id && item.kind === 'player')
      .sort((a, b) => (a.number ?? 100) - (b.number ?? 100));
    const known = (player: Assignment) =>
      catalog.positions.some((position) => position.id === player.position_id);
    return [
      ...catalog.positions.map((position) => ({
        id: position.id,
        name: position.name,
        players: players.filter((player) => player.position_id === position.id),
      })),
      { id: '', name: 'Sans poste', players: players.filter((player) => !known(player)) },
    ].filter((group) => group.players.length);
  };
  const playerName = (id: string) => {
    const user = catalog.users.find((item) => item.id === id);
    return user ? displayName(user) : id;
  };
  const [notice, setNotice] = useState('');
  const start = (value: Editing) => {
    setEditing(value);
    setNotice('');
  };
  const referentNames = (team: Team) =>
    team.referent_ids
      .map((id) => catalog.users.find((user) => user.id === id)?.first_name ?? referents[id] ?? id)
      .join(', ') || 'À attribuer';
  const teamFields: FormField[] = [
    name,
    {
      name: 'section_id',
      label: 'Section',
      type: 'select',
      required: true,
      options: catalog.sections.map((section) => ({ value: section.id, label: section.name })),
    },
    {
      name: 'referent_ids',
      label: 'Référents',
      type: 'choices',
      options: catalog.users
        .filter((user) => user.active)
        .map((user) => ({ value: user.id, label: user.first_name })),
      hint: 'Chaque référent a les mêmes droits sur l’équipe. Un référent actif est requis avant d’activer une source FFVB.',
    },
  ];
  // Les sections sans équipe passent en bas, dans l’ordre reçu.
  const sorted = [...catalog.sections].sort(
    (a, b) =>
      Number(!catalog.teams.some((team) => team.section_id === a.id)) -
      Number(!catalog.teams.some((team) => team.section_id === b.id)),
  );
  const path = (kind: 'section' | 'team') => (kind === 'section' ? '/sections' : '/teams');
  return (
    <>
      <PanelHeading
        title="Sections et équipes"
        description={
          admin
            ? 'Organisez les groupes de pratique du club, rattachez-y les équipes et choisissez leur référent par défaut.'
            : 'Consultation seule.'
        }
      >
        {admin && (
          <div className="admin-actions">
            <button
              className="admin-button primary"
              onClick={() => start({ kind: 'section', item: null })}
            >
              Ajouter une section
            </button>
            {catalog.sections.length > 0 && (
              <button className="admin-button" onClick={() => start({ kind: 'team', item: null })}>
                Ajouter une équipe
              </button>
            )}
          </div>
        )}
      </PanelHeading>
      {notice && <Notice>{notice}</Notice>}
      {editing && (
        <EntityForm
          key={`${editing.kind}:${editing.item?.id ?? 'new'}:${editing.kind === 'team' ? (editing.section ?? '') : ''}`}
          title={
            editing.item
              ? `Modifier ${editing.item.name}`
              : editing.kind === 'section'
                ? 'Ajouter une section'
                : 'Ajouter une équipe'
          }
          fields={editing.kind === 'section' ? [name] : teamFields}
          initial={
            editing.kind === 'section'
              ? { name: editing.item?.name ?? '' }
              : {
                  name: editing.item?.name ?? '',
                  section_id: editing.item?.section_id ?? editing.section ?? '',
                  referent_ids: editing.item?.referent_ids ?? [],
                }
          }
          submit={editing.item ? 'Enregistrer' : 'Créer'}
          onCancel={() => setEditing(null)}
          onSave={async (values, signal) => {
            const body =
              editing.kind === 'section'
                ? { name: str(values, 'name') }
                : {
                    name: str(values, 'name'),
                    section_id: str(values, 'section_id'),
                    referent_ids: choices(values, 'referent_ids'),
                  };
            await api.request(
              editing.item ? `${path(editing.kind)}/${editing.item.id}` : path(editing.kind),
              editing.item ? 'PUT' : 'POST',
              body,
              signal,
            );
            setEditing(null);
            setNotice(editing.item ? 'Modification enregistrée.' : 'Création enregistrée.');
            reloadCatalog();
          }}
        />
      )}
      {!catalog.sections.length ? (
        <Empty>
          {admin
            ? 'Aucune section pour le moment. Créez une section avant d’ajouter une équipe.'
            : 'Aucun élément.'}
        </Empty>
      ) : (
        <div className="admin-list">
          {sorted.map((section) => {
            const teams = catalog.teams.filter((team) => team.section_id === section.id);
            const actions = admin && (
              <div className="admin-actions">
                <button
                  className="admin-button"
                  aria-label={`Modifier ${section.name}`}
                  onClick={() => start({ kind: 'section', item: section })}
                >
                  Modifier la section
                </button>
                <button
                  className="admin-button danger"
                  aria-label={`Supprimer ${section.name}`}
                  onClick={() => setRemoving({ kind: 'section', item: section })}
                >
                  Supprimer la section
                </button>
                <button
                  className="admin-button"
                  aria-label={`Ajouter une équipe dans ${section.name}`}
                  onClick={() => start({ kind: 'team', item: null, section: section.id })}
                >
                  Ajouter une équipe
                </button>
              </div>
            );
            // Sans équipe, rien à déplier : une simple ligne, en bas de la liste.
            if (!teams.length)
              return (
                <article className="admin-section empty" key={section.id}>
                  <div className="admin-section-title">
                    <h3>{section.name}</h3>
                    <span className="admin-hint">0 équipe</span>
                  </div>
                  {actions}
                </article>
              );
            return (
              <details className="admin-section" key={section.id}>
                <summary>
                  <h3>{section.name}</h3>
                  <span className="admin-hint">{teams.length} équipe(s)</span>
                </summary>
                {actions}
                {teams.map((team) => (
                  <article className="admin-row" key={team.id}>
                    <div className="admin-row-copy">
                      <h4>{team.name}</h4>
                      <p>Référents : {referentNames(team)}</p>
                      {roster(team).length > 0 && (
                        <div className="admin-roster" aria-label={`Joueurs de ${team.name}`}>
                          {roster(team).map((group) => (
                            <div key={group.id}>
                              <h5>{group.name}</h5>
                              <ul aria-label={`${group.name} de ${team.name}`}>
                                {group.players.map((player) => (
                                  <li key={player.id}>
                                    {playerName(player.user_id)}
                                    {player.number != null && (
                                      <span className="admin-hint"> · n° {player.number}</span>
                                    )}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          ))}
                        </div>
                      )}
                      {admin && team.ffvb_source_warning_ignored && (
                        <TeamSourceWarningPreference team={team} ignored />
                      )}
                    </div>
                    {admin && (
                      <div className="admin-actions">
                        <button
                          className="admin-button"
                          aria-label={`Modifier ${team.name}`}
                          onClick={() => start({ kind: 'team', item: team })}
                        >
                          Modifier
                        </button>
                        <button
                          className="admin-button danger"
                          aria-label={`Supprimer ${team.name}`}
                          onClick={() => setRemoving({ kind: 'team', item: team })}
                        >
                          Supprimer
                        </button>
                      </div>
                    )}
                  </article>
                ))}
              </details>
            );
          })}
        </div>
      )}
      {removing && (
        <Confirm
          title={`Supprimer ${removing.item.name} ?`}
          label="Confirmer la suppression"
          onClose={() => setRemoving(null)}
          onConfirm={async (signal) => {
            await api.request(
              `${path(removing.kind)}/${removing.item.id}`,
              'DELETE',
              undefined,
              signal,
            );
            if (editing?.kind === removing.kind && editing.item?.id === removing.item.id)
              setEditing(null);
            setNotice('Suppression effectuée.');
            reloadCatalog();
          }}
        >
          <p>
            Cette suppression est définitive. Si cet élément est encore utilisé, le serveur refusera
            la suppression ; retirez d’abord ses liens.
          </p>
        </Confirm>
      )}
    </>
  );
}
