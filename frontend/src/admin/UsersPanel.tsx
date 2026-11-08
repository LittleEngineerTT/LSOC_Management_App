import { useState } from 'react';
import { useSession } from '../auth/session';
import { TeamOptions } from '../club/teamOrder';
import { UserCredentials } from './UserCredentials';
import { InvitationLink, UserCard, roleNames } from './UserCard';
import { useAdmin, useResource } from './data';
import type { Assignment, Invitation, Role, User } from './types';
import { Badge, Confirm, Empty, LoadState, Notice, PanelHeading, playerDetails } from './ui';

// Titres du bureau accordés au sexe du compte, quand il est renseigné.
const titles: Partial<Record<Role, Record<string, string>>> = {
  president: { M: 'Président', F: 'Présidente' },
  vice_president: { M: 'Vice-président', F: 'Vice-présidente' },
};
function roleName(role: Role, sex: string | null | undefined): string {
  return (sex && titles[role]?.[sex]) || roleNames[role];
}

/** Utilisateurs : la liste filtrable, et la fiche d’un compte ouverte d’un clic, avec ses
 * informations et ses rattachements en onglets. */
export function UsersPanel() {
  const { api, catalog, reloadCatalog, admin, scope } = useAdmin();
  const session = useSession();
  const accountId = session.account?.id;
  // Fiche ouverte : un compte (par son identifiant) ou une création ; `revision` la relit.
  const [editing, setEditing] = useState<{ id: string | null; revision: number } | null>(null);
  // Dernière version connue du compte ouvert, le temps que la liste se recharge.
  const [known, setKnown] = useState<User | null>(null);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [section, setSection] = useState('');
  const [team, setTeam] = useState('');
  // Tous les rattachements, pour filtrer par section ou équipe et résumer chaque compte.
  const assignments = useResource<Assignment>('/assignments', true);
  const [invitation, setInvitation] = useState<Invitation | null>(null);
  // Gestion du compte (identifiants, invitation), ouverte par « Gérer » dans la liste.
  const [managing, setManaging] = useState<string | null>(null);
  const managed =
    managing != null
      ? (catalog.users.find((user) => user.id === managing) ??
        (known?.id === managing ? known : null))
      : null;
  const [confirmation, setConfirmation] = useState<{
    user: User;
    action: 'delete' | 'regenerate' | 'revoke';
  } | null>(null);
  const [notice, setNotice] = useState('');
  const selected =
    editing?.id != null
      ? (catalog.users.find((user) => user.id === editing.id) ??
        (known?.id === editing.id ? known : null))
      : null;
  const assignmentsOf = (id: string) =>
    (assignments.data ?? []).filter((item) => item.user_id === id);
  const teamsOf = new Map<string, string[]>();
  for (const item of assignments.data ?? [])
    teamsOf.set(item.user_id, [...(teamsOf.get(item.user_id) ?? []), item.team_id]);
  const sectionOf = (id: string) => catalog.teams.find((item) => item.id === id)?.section_id;
  const teamName = (id: string) =>
    catalog.teams.find((item) => item.id === id)?.name ?? 'Équipe supprimée';
  // Un coach ne filtre que parmi ses équipes et leurs sections.
  const reachable = catalog.teams.filter((item) => !scope || scope.includes(item.id));
  const sectionChoices = catalog.sections.filter((item) =>
    reachable.some((team) => team.section_id === item.id),
  );
  const teamChoices = reachable.filter((item) => !section || item.section_id === section);
  const filtered = catalog.users.filter((user) => {
    const mine = teamsOf.get(user.id) ?? [];
    return (
      user.first_name.toLocaleLowerCase('fr').includes(query.toLocaleLowerCase('fr')) &&
      (status === 'all' || user.active === (status === 'active')) &&
      (team === 'none'
        ? !mine.length
        : team
          ? mine.includes(team)
          : !section || mine.some((id) => sectionOf(id) === section))
    );
  });
  function open(user: User | null) {
    setEditing((previous) => ({ id: user?.id ?? null, revision: (previous?.revision ?? 0) + 1 }));
    setKnown(user);
    setNotice('');
  }
  function manage(user: User) {
    setManaging(user.id);
    if (invitation?.user.id !== user.id) setInvitation(null);
    setNotice('');
  }

  // La fiche prend la place de la ligne du compte dans la liste, jusqu’à sa fermeture.
  const inList = !!selected && filtered.some((user) => user.id === selected.id);
  const card = editing && (editing.id === null || selected) && (
    <UserCard
      key={`${editing.id ?? 'nouveau'}:${editing.revision}`}
      user={selected}
      assignments={selected ? assignmentsOf(selected.id) : []}
      editable={admin}
      onClose={() => setEditing(null)}
      onSaved={(id, message, created) => {
        setNotice(message);
        if (created) {
          // Le lien d’invitation n’est lisible qu’à la création : la gestion du compte s’ouvre.
          setInvitation({ ...created, user: { ...created.user, id } });
          setKnown({ ...created.user, id });
          setManaging(id);
        } else if (selected) {
          setKnown({ ...selected, id });
          if (managing === selected.id) setManaging(id);
        }
        setEditing((previous) => ({ id, revision: (previous?.revision ?? 0) + 1 }));
        reloadCatalog();
        assignments.reload();
      }}
    />
  );
  return (
    <>
      <PanelHeading
        title="Utilisateurs"
        description={
          admin
            ? 'Préparez les comptes, invitez les membres et attribuez leurs rôles et équipes. Cliquez sur un utilisateur pour ouvrir sa fiche.'
            : 'Membres des équipes dont vous êtes référent ou coach, en consultation seule.'
        }
      >
        {admin && (
          <button className="admin-button primary" onClick={() => open(null)}>
            Ajouter un utilisateur
          </button>
        )}
      </PanelHeading>
      {notice && <Notice>{notice}</Notice>}
      {/* Une création, ou un compte absent de la liste filtrée : la fiche s’ouvre en tête. */}
      {editing && (editing.id === null || selected) && !inList && card}
      {admin && managed && (
        <section
          className="admin-card user-card-account"
          aria-label={`Compte de ${managed.first_name}`}
        >
          <header className="user-card-head">
            <h3>Compte de {displayName(managed)}</h3>
            <button
              type="button"
              className="admin-button"
              onClick={() => {
                setManaging(null);
                setInvitation(null);
              }}
            >
              Fermer
            </button>
          </header>
          {!managed.active && (
            <>
              <p className="admin-hint">
                Le lien est valable 7 jours. La personne choisit son identifiant unique et son mot
                de passe. Son compte est ensuite actif. Un lien existant ne peut pas être récupéré.
              </p>
              <div className="admin-actions">
                <button
                  className="admin-button"
                  onClick={() => setConfirmation({ user: managed, action: 'regenerate' })}
                >
                  Régénérer l’invitation
                </button>
                <button
                  className="admin-button danger"
                  onClick={() => setConfirmation({ user: managed, action: 'revoke' })}
                >
                  Révoquer l’invitation
                </button>
              </div>
            </>
          )}
          {invitation?.user.id === managed.id && (
            <InvitationLink key={invitation.invitation_url} invitation={invitation} />
          )}
          {managed.active && <UserCredentials key={managed.id} user={managed} />}
        </section>
      )}
      <div className="admin-toolbar">
        <label>
          Rechercher un utilisateur
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Prénom…"
          />
        </label>
        <label>
          État du compte
          <select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="all">Tous</option>
            <option value="active">Actifs</option>
            <option value="inactive">À activer</option>
          </select>
        </label>
        <label>
          Section
          <select
            value={section}
            onChange={(event) => {
              setSection(event.target.value);
              if (team !== 'none') setTeam('');
            }}
          >
            <option value="">Toutes les sections</option>
            {sectionChoices.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Équipe
          <select
            value={team}
            onChange={(event) => {
              setTeam(event.target.value);
              if (event.target.value === 'none') setSection('');
            }}
          >
            <option value="">Toutes les équipes</option>
            <option value="none">Sans équipe</option>
            <TeamOptions teams={teamChoices} accountId={accountId} />
          </select>
        </label>
        <button
          className="admin-button"
          onClick={() => {
            reloadCatalog();
            assignments.reload();
          }}
        >
          Actualiser
        </button>
      </div>
      {(section || team) && <LoadState result={assignments} />}
      {!filtered.length ? (
        <Empty>Aucun utilisateur ne correspond à ces critères.</Empty>
      ) : (
        <div className="admin-list">
          {filtered.map((user) =>
            inList && selected?.id === user.id ? (
              <div key={user.id} className="user-row-card">
                {card}
              </div>
            ) : (
              <article
                className={`admin-row user-row${selected?.id === user.id ? ' selected' : ''}`}
                key={user.id}
                // Toute la ligne ouvre la fiche ; le bouton du nom le permet au clavier.
                onClick={(event) => {
                  if (!(event.target as HTMLElement).closest('button, a')) open(user);
                }}
              >
                <div className="admin-row-copy">
                  <h3>
                    <button
                      type="button"
                      className="user-row-open"
                      aria-label={`Ouvrir la fiche de ${user.first_name}`}
                      aria-expanded={selected?.id === user.id}
                      onClick={() => open(user)}
                    >
                      {displayName(user)}
                    </button>
                  </h3>
                  <p className="admin-hint">ID : {user.id}</p>
                  {user.username && <p>Identifiant : {user.username}</p>}
                  <p>
                    {user.category === 'adult' ? 'Sénior' : user.category}
                    {user.sex && ` · ${user.sex}`} ·{' '}
                    {user.roles.map((role) => roleName(role, user.sex)).join(', ')}
                  </p>
                  {assignmentsOf(user.id).length > 0 && (
                    <p className="user-row-teams">
                      {assignmentsOf(user.id)
                        .map((item) => {
                          const details = playerDetails(item, catalog.positions);
                          return `${teamName(item.team_id)} · ${item.kind === 'coach' ? 'Coach' : 'Joueur'}${details ? ` · ${details}` : ''}`;
                        })
                        .join(' — ')}
                    </p>
                  )}
                  <Badge tone={user.active ? 'good' : 'warning'}>
                    {user.active ? 'Actif' : 'À activer'}
                  </Badge>
                  {!user.messaging_allowed && <Badge>Écriture désactivée</Badge>}
                </div>
                {admin && (
                  <div className="admin-actions">
                    <button
                      className="admin-button"
                      aria-label={`Gérer ${user.first_name}`}
                      aria-expanded={managed?.id === user.id}
                      onClick={() => manage(user)}
                    >
                      Gérer
                    </button>
                    <button
                      className="admin-button danger"
                      aria-label={`Supprimer ${user.first_name}`}
                      onClick={() => setConfirmation({ user, action: 'delete' })}
                    >
                      Supprimer
                    </button>
                  </div>
                )}
              </article>
            ),
          )}
        </div>
      )}
      {confirmation && (
        <Confirm
          title={
            confirmation.action === 'delete'
              ? `Supprimer ${confirmation.user.first_name} ?`
              : confirmation.action === 'regenerate'
                ? 'Régénérer l’invitation ?'
                : 'Révoquer l’invitation ?'
          }
          label={confirmation.action === 'delete' ? 'Confirmer la suppression' : 'Confirmer'}
          onClose={() => setConfirmation(null)}
          onConfirm={async (signal) => {
            const { user, action } = confirmation;
            if (action === 'delete') {
              await api.request(`/users/${user.id}`, 'DELETE', undefined, signal);
              if (selected?.id === user.id) setEditing(null);
              if (managed?.id === user.id) {
                setManaging(null);
                setInvitation(null);
              }
              setNotice('Compte supprimé et données personnelles purgées.');
              if (user.id === session.account?.id) session.clear();
            } else if (action === 'regenerate') {
              const result = await api.request<Invitation>(
                `/users/${user.id}/invitation`,
                'POST',
                {},
                signal,
              );
              setInvitation(result);
              setNotice('Nouvelle invitation créée. Les anciens liens sont invalidés.');
            } else {
              await api.request(`/users/${user.id}/invitation`, 'DELETE', undefined, signal);
              setInvitation(null);
              setNotice('Invitation révoquée.');
            }
            reloadCatalog();
          }}
        >
          {confirmation.action === 'delete' ? (
            <p>
              Les données privées et les rattachements seront purgés. Les événements conserveront
              leur historique et devront recevoir un nouveau référent si nécessaire. Cette action
              est définitive.
            </p>
          ) : (
            <p>
              Les liens d’activation déjà transmis seront invalidés.{' '}
              {confirmation.action === 'regenerate' &&
                'La personne devra reprendre son activation avec le nouveau lien.'}
            </p>
          )}
        </Confirm>
      )}
    </>
  );
}

export function displayName(user: Pick<User, 'first_name' | 'last_initial'>) {
  return user.last_initial ? `${user.first_name} ${user.last_initial}.` : user.first_name;
}
