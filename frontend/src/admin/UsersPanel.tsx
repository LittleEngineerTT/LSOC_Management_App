import { useState } from 'react';
import { useSession } from '../auth/session';
import { UserCredentials } from './UserCredentials';
import { useAdmin, useResource } from './data';
import type { Assignment, Invitation, Role, User } from './types';
import {
  Badge,
  checked,
  choices,
  Confirm,
  Empty,
  EntityForm,
  LoadState,
  Notice,
  PanelHeading,
  str,
  type FormField,
} from './ui';

const roleNames: Record<Role, string> = {
  member: 'Adhérent',
  coach: 'Coach',
  admin: 'Administrateur',
};
const categories = ['adult', 'M21', 'M18', 'M15', 'M13', 'M11', 'M9'].map((value) => ({
  value,
  label: value === 'adult' ? 'Sénior' : value,
}));
export function UsersPanel() {
  const { api, catalog, reloadCatalog } = useAdmin();
  const session = useSession();
  const [editing, setEditing] = useState<User | 'new' | null>(null);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [invitation, setInvitation] = useState<Invitation | null>(null);
  const [confirmation, setConfirmation] = useState<{
    user: User;
    action: 'delete' | 'regenerate' | 'revoke';
  } | null>(null);
  const [notice, setNotice] = useState('');
  const selected =
    typeof editing === 'object' && editing
      ? (catalog.users.find((user) => user.id === editing.id) ?? editing)
      : null;
  const filtered = catalog.users.filter(
    (user) =>
      user.first_name.toLocaleLowerCase('fr').includes(query.toLocaleLowerCase('fr')) &&
      (status === 'all' || user.active === (status === 'active')),
  );
  const fields: FormField[] = [
    { name: 'first_name', label: 'Prénom', required: true, maxLength: 80 },
    {
      name: 'last_name',
      label: 'Nom',
      required: !selected,
      maxLength: 80,
      hint: selected
        ? `Seule l’initiale est conservée (actuellement ${selected.last_initial || '—'}.) ; laissez vide pour la garder.`
        : 'Seule l’initiale est conservée.',
    },
    { name: 'category', label: 'Catégorie', type: 'select', required: true, options: categories },
    {
      name: 'roles',
      label: 'Rôles',
      type: 'choices',
      options: Object.entries(roleNames).map(([value, label]) => ({ value, label })),
      hint: 'Les rôles se cumulent. Les adhérents doivent être M18 ou plus. Retirer un rôle supprime les rattachements correspondants.',
    },
    {
      name: 'messaging_allowed',
      label: 'Autoriser l’écriture dans la messagerie',
      type: 'checkbox',
      hint: 'Le retrait de ce droit laisse l’utilisateur lire ses échanges existants.',
    },
  ];
  return (
    <>
      <PanelHeading
        title="Utilisateurs"
        description="Préparez les comptes, invitez les membres et attribuez leurs rôles et équipes."
      >
        <button
          className="admin-button primary"
          onClick={() => {
            setEditing('new');
            setInvitation(null);
            setNotice('');
          }}
        >
          Ajouter un utilisateur
        </button>
      </PanelHeading>
      {notice && <Notice>{notice}</Notice>}
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
        <button className="admin-button" onClick={reloadCatalog}>
          Actualiser
        </button>
      </div>
      {editing && (
        <EntityForm
          key={selected?.id ?? 'new'}
          title={selected ? `Compte de ${selected.first_name}` : 'Nouvel utilisateur'}
          fields={fields}
          initial={
            selected
              ? {
                  first_name: selected.first_name,
                  last_name: '',
                  category: selected.category,
                  roles: selected.roles,
                  messaging_allowed: selected.messaging_allowed,
                }
              : {
                  first_name: '',
                  last_name: '',
                  category: 'adult',
                  roles: ['member'],
                  messaging_allowed: true,
                }
          }
          submit={selected ? 'Enregistrer' : 'Créer et inviter'}
          onCancel={() => {
            setEditing(null);
            setInvitation(null);
          }}
          onSave={async (values, signal) => {
            const roles = choices(values, 'roles');
            if (!roles.length) throw new Error('Sélectionnez au moins un rôle.');
            if (
              roles.includes('member') &&
              !['adult', 'M21', 'M18'].includes(str(values, 'category'))
            )
              throw new Error('Les adhérents doivent appartenir à M18 ou plus.');
            const body = {
              first_name: str(values, 'first_name'),
              ...(str(values, 'last_name') ? { last_name: str(values, 'last_name') } : {}),
              category: str(values, 'category'),
              roles,
              messaging_allowed: checked(values, 'messaging_allowed'),
            };
            if (selected) {
              const updated = await api.request<User>(`/users/${selected.id}`, 'PUT', body, signal);
              setEditing(updated);
              setNotice('Compte mis à jour.');
              reloadCatalog();
              if (selected.id === session.account?.id) session.retry();
            } else {
              const result = await api.request<Invitation>('/users', 'POST', body, signal);
              setInvitation(result);
              setEditing(result.user);
              setNotice('Compte créé. Transmettez le lien d’invitation à cette personne.');
              reloadCatalog();
            }
          }}
        />
      )}
      {selected && (
        <section className="admin-card" aria-label={`Gestion de ${selected.first_name}`}>
          <h3>Invitation et rattachements</h3>
          {!selected.active && (
            <>
              <p className="admin-hint">
                Le lien est valable 7 jours. La personne choisit son identifiant unique et son mot
                de passe. Son compte est ensuite actif. Un lien existant ne peut pas être récupéré.
              </p>
              <div className="admin-actions">
                <button
                  className="admin-button"
                  onClick={() => setConfirmation({ user: selected, action: 'regenerate' })}
                >
                  Régénérer l’invitation
                </button>
                <button
                  className="admin-button danger"
                  onClick={() => setConfirmation({ user: selected, action: 'revoke' })}
                >
                  Révoquer l’invitation
                </button>
              </div>
            </>
          )}
          {invitation?.user.id === selected.id && (
            <InvitationLink key={invitation.invitation_url} invitation={invitation} />
          )}
          {selected.active && <UserCredentials key={selected.id} user={selected} />}
          <Assignments
            key={`${selected.id}:${selected.roles.join(',')}`}
            user={selected}
            onRenamed={(id) => {
              // Sans licence, l’identifiant suit la section : le compte sélectionné le suit aussi.
              setEditing({ ...selected, id });
              reloadCatalog();
            }}
          />
        </section>
      )}
      {!filtered.length ? (
        <Empty>Aucun utilisateur ne correspond à cette recherche.</Empty>
      ) : (
        <div className="admin-list">
          {filtered.map((user) => (
            <article className="admin-row" key={user.id}>
              <div className="admin-row-copy">
                <h3>{displayName(user)}</h3>
                <p className="admin-hint">ID : {user.id}</p>
                {user.username && <p>Identifiant : {user.username}</p>}
                <p>
                  {user.category === 'adult' ? 'Sénior' : user.category} ·{' '}
                  {user.roles.map((role) => roleNames[role]).join(', ')}
                </p>
                <Badge tone={user.active ? 'good' : 'warning'}>
                  {user.active ? 'Actif' : 'À activer'}
                </Badge>
                {!user.messaging_allowed && <Badge>Écriture désactivée</Badge>}
              </div>
              <div className="admin-actions">
                <button
                  className="admin-button"
                  aria-label={`Gérer ${user.first_name}`}
                  onClick={() => {
                    setEditing(user);
                    setInvitation(null);
                    setNotice('');
                  }}
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
            </article>
          ))}
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
              if (selected?.id === user.id) {
                setEditing(null);
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
function InvitationLink({ invitation }: { invitation: Invitation }) {
  const [copy, setCopy] = useState('');
  return (
    <div className="invitation-box">
      <label htmlFor="invitation-link">Lien d’invitation</label>
      <input
        id="invitation-link"
        readOnly
        value={invitation.invitation_url}
        onFocus={(event) => event.target.select()}
      />
      <button
        className="admin-button"
        onClick={() => {
          void navigator.clipboard
            ?.writeText(invitation.invitation_url)
            .then(() => setCopy('Lien copié.'))
            .catch(() => setCopy('Sélectionnez le lien et copiez-le manuellement.'));
          if (!navigator.clipboard) setCopy('Sélectionnez le lien et copiez-le manuellement.');
        }}
      >
        Copier le lien
      </button>
      {copy && <p role="status">{copy}</p>}
    </div>
  );
}
export function displayName(user: Pick<User, 'first_name' | 'last_initial'>) {
  return user.last_initial ? `${user.first_name} ${user.last_initial}.` : user.first_name;
}
function Assignments({ user, onRenamed }: { user: User; onRenamed: (id: string) => void }) {
  const { api, catalog } = useAdmin();
  const resource = useResource<Assignment>(`/users/${user.id}/assignments`);
  const [removing, setRemoving] = useState<Assignment | null>(null);
  const [revision, setRevision] = useState(0);
  const kinds = [
    { value: 'player', label: 'Joueur' },
    { value: 'coach', label: 'Coach' },
  ].filter((kind) => user.roles.includes(kind.value === 'coach' ? 'coach' : 'member'));
  return (
    <div className="admin-assignments">
      <h4>Équipes rattachées</h4>
      <LoadState result={resource} />
      {resource.loaded && !resource.data?.length && <Empty>Aucun rattachement.</Empty>}
      {resource.data?.map((assignment) => (
        <div className="admin-inline-row" key={assignment.id}>
          <span>
            {catalog.teams.find((team) => team.id === assignment.team_id)?.name ??
              'Équipe supprimée'}{' '}
            · {assignment.kind === 'coach' ? 'Coach' : 'Joueur'}
          </span>
          <button className="admin-button danger" onClick={() => setRemoving(assignment)}>
            Retirer
          </button>
        </div>
      ))}
      {catalog.teams.length && kinds.length ? (
        <EntityForm
          key={revision}
          title="Ajouter un rattachement"
          fields={[
            {
              name: 'team_id',
              label: 'Équipe',
              type: 'select',
              required: true,
              options: catalog.teams.map((team) => ({ value: team.id, label: team.name })),
            },
            {
              name: 'kind',
              label: 'Type de rattachement',
              type: 'select',
              required: true,
              options: kinds,
            },
          ]}
          initial={{ team_id: '', kind: kinds[0]?.value ?? '' }}
          submit="Rattacher"
          onSave={async (values, signal) => {
            const created = await api.request<Assignment>(
              `/users/${user.id}/assignments`,
              'POST',
              { team_id: str(values, 'team_id'), kind: str(values, 'kind') },
              signal,
            );
            if (created?.user_id && created.user_id !== user.id) onRenamed(created.user_id);
            else resource.reload();
            setRevision((value) => value + 1);
          }}
        />
      ) : (
        <p className="admin-hint">
          Créez une équipe et attribuez le rôle adhérent ou coach pour ajouter un rattachement.
        </p>
      )}
      {removing && (
        <Confirm
          title="Retirer ce rattachement ?"
          onClose={() => setRemoving(null)}
          onConfirm={async (signal) => {
            const updated = await api.request<User>(
              `/users/${user.id}/assignments/${removing.id}`,
              'DELETE',
              undefined,
              signal,
            );
            if (updated?.id && updated.id !== user.id) onRenamed(updated.id);
            else resource.reload();
          }}
        >
          <p>L’utilisateur ne sera plus rattaché à cette équipe pour ce rôle.</p>
        </Confirm>
      )}
    </div>
  );
}
