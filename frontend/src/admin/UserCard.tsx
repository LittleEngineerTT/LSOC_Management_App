import { useEffect, useId, useState, type FormEvent } from 'react';
import { ErrorNotice } from '../auth/components';
import { useSession } from '../auth/session';
import { TeamOptions } from '../club/teamOrder';
import { CoachPhotoPicker, photoError, usePreview } from './CoachPhoto';
import { useAdmin } from './data';
import { Confirm } from './ui';
import type { Assignment, Invitation, Role, User } from './types';

export const roleNames: Record<Role, string> = {
  member: 'Adhérent',
  coach: 'Coach',
  admin: 'Administrateur',
  president: 'Président(e)',
  vice_president: 'Vice-président(e)',
};
const categories = ['adult', 'M21', 'M18', 'M15', 'M13', 'M11', 'M9'];
const categoryLabel = (value: string) => (value === 'adult' ? 'Sénior' : value);
// Les adhérents (et donc les joueurs) appartiennent à M18 ou plus.
const MEMBER_CATEGORIES = ['adult', 'M21', 'M18'];

interface Info {
  first_name: string;
  last_name: string;
  category: string;
  sex: string;
  roles: Role[];
  messaging_allowed: boolean;
}
/** Rattachement en cours d’édition ; `id` : rattachement existant. */
interface Draft {
  key: string;
  id?: string;
  team_id: string;
  number: string;
  position_id: string;
}

let counter = 0;
const newKey = () => `nouveau-${++counter}`;
const fromAssignment = (item: Assignment): Draft => ({
  key: item.id,
  id: item.id,
  team_id: item.team_id,
  number: item.number != null ? String(item.number) : '',
  position_id: item.position_id ?? '',
});

/** Fiche d’un utilisateur : ses informations et, en onglets, ses rattachements joueur (équipe,
 * numéro, poste). Un rattachement coach ne crée pas d’onglet : il se choisit dans les
 * informations. Un seul enregistrement envoie le compte puis les rattachements modifiés. La
 * gestion du compte (identifiants, invitation) n’y figure pas : elle s’ouvre par « Gérer ». */
export function UserCard({
  user,
  assignments,
  editable,
  onSaved,
  onClose,
}: {
  /** Compte existant ; nul : création. */
  user: User | null;
  /** Rattachements connus du compte, quand l’administration ne peut pas les relire (coach). */
  assignments: Assignment[];
  editable: boolean;
  onSaved: (id: string, message: string, invitation?: Invitation) => void;
  onClose: () => void;
}) {
  const { api, catalog } = useAdmin();
  const session = useSession();
  const accountId = session.account?.id;
  const titleId = useId();
  const [info, setInfo] = useState<Info>({
    first_name: user?.first_name ?? '',
    last_name: '',
    category: user?.category ?? 'adult',
    sex: user?.sex ?? '',
    roles: user?.roles ?? ['member'],
    messaging_allowed: user?.messaging_allowed ?? true,
  });
  const [players, setPlayers] = useState<Draft[]>([]);
  const [coaches, setCoaches] = useState<Draft[]>([]);
  const [original, setOriginal] = useState<Assignment[]>([]);
  // Les rattachements du compte se relisent à l’ouverture (l’administrateur y a accès).
  const [loaded, setLoaded] = useState(!user);
  const [loadError, setLoadError] = useState('');
  const [tab, setTab] = useState('infos');
  const [choosing, setChoosing] = useState(false);
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoProblem, setPhotoProblem] = useState('');
  const photoPreview = usePreview(photo);
  const [pending, setPending] = useState(false);
  // Équipe coachée dont le retrait attend confirmation.
  const [uncoaching, setUncoaching] = useState<Draft | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!user) return;
    const controller = new AbortController();
    const apply = (items: Assignment[]) => {
      setOriginal(items);
      setPlayers(items.filter((item) => item.kind === 'player').map(fromAssignment));
      setCoaches(items.filter((item) => item.kind === 'coach').map(fromAssignment));
      setLoaded(true);
    };
    if (!editable) {
      apply(assignments);
      return;
    }
    api
      .request<Assignment[]>(
        `/users/${encodeURIComponent(user.id)}/assignments`,
        'GET',
        undefined,
        controller.signal,
      )
      .then((items) => apply(Array.isArray(items) ? items : []))
      .catch((failure: unknown) => {
        if (controller.signal.aborted) return;
        setLoadError(failure instanceof Error ? failure.message : 'Lecture impossible.');
        setLoaded(true);
      });
    return () => controller.abort();
    // Relu à l’ouverture de la fiche seulement : les brouillons ne sont pas écrasés.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, user?.id, editable]);

  const teamName = (id: string) => catalog.teams.find((team) => team.id === id)?.name;
  const toggleRole = (role: Role, on: boolean) => {
    setInfo((previous) => ({
      ...previous,
      roles: on
        ? [...new Set([...previous.roles, role])]
        : previous.roles.filter((item) => item !== role),
    }));
    // Sans le rôle coach, ses rattachements coach disparaissent, comme sur le serveur.
    if (role === 'coach' && !on) setCoaches([]);
  };
  const patch = (list: 'players' | 'coaches', key: string, values: Partial<Draft>) =>
    (list === 'players' ? setPlayers : setCoaches)((previous) =>
      previous.map((item) => (item.key === key ? { ...item, ...values } : item)),
    );
  function addAssignment(kind: 'player' | 'coach') {
    setChoosing(false);
    setError('');
    const draft: Draft = { key: newKey(), team_id: '', number: '', position_id: '' };
    // Le rôle correspondant est requis : il est coché d’office.
    toggleRole(kind === 'player' ? 'member' : 'coach', true);
    if (kind === 'player') {
      setPlayers((previous) => [...previous, draft]);
      setTab(draft.key);
    } else {
      setCoaches((previous) => [...previous, draft]);
      setTab('infos');
    }
  }
  const removeCoach = (key: string) =>
    setCoaches((previous) => previous.filter((item) => item.key !== key));
  function removePlayer(key: string) {
    setPlayers((previous) => previous.filter((item) => item.key !== key));
    setTab('infos');
  }

  function validate(): string | null {
    if (!info.first_name.trim()) return 'Le prénom est obligatoire.';
    if (!user && !info.last_name.trim()) return 'Le nom est obligatoire.';
    if (!info.roles.length) return 'Sélectionnez au moins un rôle.';
    if (info.roles.includes('member') && !MEMBER_CATEGORIES.includes(info.category))
      return 'Les adhérents doivent appartenir à M18 ou plus.';
    if (players.length && !info.roles.includes('member'))
      return 'Le rôle Adhérent est requis pour un rattachement joueur.';
    if (coaches.length && !info.roles.includes('coach'))
      return 'Le rôle Coach est requis pour un rattachement coach.';
    if ([...players, ...coaches].some((item) => !item.team_id))
      return 'Choisissez l’équipe de chaque rattachement.';
    for (const list of [players, coaches]) {
      const teams = list.map((item) => item.team_id);
      if (new Set(teams).size !== teams.length)
        return 'Une même équipe ne peut être choisie qu’une fois par type de rattachement.';
    }
    const wrong = players.find(
      (item) => item.number && !(Number(item.number) >= 1 && Number(item.number) <= 99),
    );
    if (wrong) return 'Le numéro de maillot va de 1 à 99.';
    return null;
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    const problem = validate();
    if (problem) {
      setError(problem);
      return;
    }
    setError('');
    setPending(true);
    try {
      const body = {
        first_name: info.first_name.trim(),
        ...(info.last_name.trim() ? { last_name: info.last_name.trim() } : {}),
        category: info.category,
        sex: info.sex || null,
        roles: info.roles,
        messaging_allowed: info.messaging_allowed,
      };
      let id: string;
      let created: Invitation | undefined;
      let message: string;
      if (user) {
        id = (await api.request<User>(`/users/${encodeURIComponent(user.id)}`, 'PUT', body)).id;
        message = 'Compte mis à jour.';
        if (user.id === accountId) session.retry();
      } else {
        created = await api.request<Invitation>('/users', 'POST', body);
        id = created.user.id;
        message = 'Compte créé. Transmettez le lien d’invitation à cette personne.';
        if (photo && info.roles.includes('coach')) {
          try {
            await api.request(`/users/${encodeURIComponent(id)}/photo`, 'PUT', photo);
          } catch (failure) {
            // Le compte existe : seule la photo reste à déposer, depuis le profil du coach.
            message += ` La photo n’a pas pu être déposée : ${
              failure instanceof Error ? failure.message : 'erreur inconnue'
            }`;
          }
        }
      }
      if (user || players.length || coaches.length)
        id = await syncAssignments(id, created ? [] : original);
      onSaved(id, message, created);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Enregistrement impossible.');
    } finally {
      setPending(false);
    }
  }

  /** Applique les rattachements voulus ; renvoie l’identifiant du compte, qui suit la section
   * d’un compte sans licence. Les retraits d’abord : ils libèrent les numéros de maillot. */
  async function syncAssignments(start: string, before: Assignment[]): Promise<string> {
    let id = start;
    const path = () => `/users/${encodeURIComponent(id)}/assignments`;
    // Le serveur a pu retirer des rattachements avec un rôle : on repart de son état.
    const current = user ? await api.request<Assignment[]>(path(), 'GET') : before;
    const wanted = [
      ...players.map((item) => ({ ...item, kind: 'player' as const })),
      ...coaches.map((item) => ({ ...item, kind: 'coach' as const })),
    ];
    const kept = new Set<string>();
    for (const item of current) {
      const draft = wanted.find((entry) => entry.id === item.id);
      if (!draft || draft.team_id !== item.team_id) {
        const updated = await api.request<User>(
          `${path()}/${encodeURIComponent(item.id)}`,
          'DELETE',
        );
        if (updated?.id) id = updated.id;
        continue;
      }
      kept.add(item.id);
      const number = draft.number ? Number(draft.number) : null;
      const position = draft.position_id || null;
      if (
        item.kind === 'player' &&
        (number !== (item.number ?? null) || position !== (item.position_id ?? null))
      )
        await api.request(`${path()}/${encodeURIComponent(item.id)}`, 'PUT', {
          number,
          position_id: position,
        });
    }
    for (const draft of wanted.filter((entry) => !entry.id || !kept.has(entry.id))) {
      const created = await api.request<Assignment>(path(), 'POST', {
        team_id: draft.team_id,
        kind: draft.kind,
        ...(draft.kind === 'player'
          ? {
              number: draft.number ? Number(draft.number) : null,
              position_id: draft.position_id || null,
            }
          : {}),
      });
      if (created?.user_id) id = created.user_id;
    }
    return id;
  }

  const title = user ? `Fiche de ${user.first_name}` : 'Nouvel utilisateur';
  const tabs = [
    { key: 'infos', label: 'Informations' },
    ...players.map((item, index) => ({
      key: item.key,
      label: `Joueur · ${teamName(item.team_id) ?? `rattachement ${index + 1}`}`,
    })),
  ];
  const active = tabs.some((item) => item.key === tab) ? tab : 'infos';
  const player = players.find((item) => item.key === active);

  return (
    <section className="admin-card user-card" aria-labelledby={titleId}>
      <header className="user-card-head">
        <h3 id={titleId}>{title}</h3>
        <button type="button" className="admin-button" onClick={onClose}>
          Fermer
        </button>
      </header>
      {!loaded && (
        <p className="admin-loading" role="status">
          Chargement des rattachements…
        </p>
      )}
      <ErrorNotice message={loadError} />
      <form onSubmit={(event) => void save(event)} aria-label={title}>
        <fieldset disabled={!editable || pending || !loaded} className="user-card-body">
          <div className="user-card-tabs" role="tablist" aria-label={`Onglets de ${title}`}>
            {tabs.map((item) => (
              <button
                key={item.key}
                type="button"
                role="tab"
                id={`${titleId}-${item.key}`}
                aria-selected={item.key === active}
                aria-controls={`${titleId}-panel`}
                className={item.key === active ? 'selected' : undefined}
                onClick={() => setTab(item.key)}
              >
                {item.label}
              </button>
            ))}
          </div>
          <div
            className="user-card-panel"
            role="tabpanel"
            id={`${titleId}-panel`}
            aria-labelledby={`${titleId}-${active}`}
          >
            {active === 'infos' ? (
              <>
                <div className="admin-fields">
                  <div className="admin-field">
                    <label htmlFor={`${titleId}-first`}>Prénom</label>
                    <input
                      id={`${titleId}-first`}
                      maxLength={80}
                      value={info.first_name}
                      onChange={(change) => setInfo({ ...info, first_name: change.target.value })}
                    />
                  </div>
                  <div className="admin-field">
                    <label htmlFor={`${titleId}-last`}>Nom</label>
                    <input
                      id={`${titleId}-last`}
                      maxLength={80}
                      value={info.last_name}
                      onChange={(change) => setInfo({ ...info, last_name: change.target.value })}
                    />
                    <p className="admin-hint">
                      {user
                        ? `Seule l’initiale est conservée (actuellement ${user.last_initial || '—'}.) ; laissez vide pour la garder.`
                        : 'Seule l’initiale est conservée.'}
                    </p>
                  </div>
                  <div className="admin-field">
                    <label htmlFor={`${titleId}-category`}>Catégorie</label>
                    <select
                      id={`${titleId}-category`}
                      value={info.category}
                      onChange={(change) => setInfo({ ...info, category: change.target.value })}
                    >
                      {categories.map((value) => (
                        <option key={value} value={value}>
                          {categoryLabel(value)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="admin-field">
                    <label htmlFor={`${titleId}-sex`}>Sexe</label>
                    <select
                      id={`${titleId}-sex`}
                      value={info.sex}
                      onChange={(change) => setInfo({ ...info, sex: change.target.value })}
                    >
                      <option value="">Non renseigné</option>
                      <option value="M">M</option>
                      <option value="F">F</option>
                    </select>
                    <p className="admin-hint">Facultatif.</p>
                  </div>
                </div>
                <fieldset className="admin-choice-group">
                  <legend>Rôles</legend>
                  {(Object.entries(roleNames) as [Role, string][]).map(([role, label]) => (
                    <label key={role}>
                      <input
                        type="checkbox"
                        checked={info.roles.includes(role)}
                        onChange={(change) => toggleRole(role, change.target.checked)}
                      />
                      {label}
                    </label>
                  ))}
                  <p className="admin-hint">
                    Les rôles se cumulent. Les adhérents doivent être M18 ou plus. Retirer un rôle
                    supprime les rattachements correspondants. Président(e) et vice-président(e)
                    sont des titres, sans droit particulier, tenus chacun par une seule personne.
                  </p>
                </fieldset>
                <label className="admin-check user-card-check">
                  <input
                    type="checkbox"
                    checked={info.messaging_allowed}
                    onChange={(change) =>
                      setInfo({ ...info, messaging_allowed: change.target.checked })
                    }
                  />
                  Autoriser l’écriture dans la messagerie
                </label>
                {!user && info.roles.includes('coach') && (
                  <div className="admin-field coach-photo-field">
                    <span className="coach-photo-title">Photo de l’entraîneur</span>
                    <CoachPhotoPicker
                      label={photo ? 'Changer la photo' : 'Choisir une photo'}
                      preview={photoPreview}
                      onPick={(file) => {
                        const problem = photoError(file);
                        setPhotoProblem(problem ?? '');
                        if (!problem) setPhoto(file);
                      }}
                    />
                    {photo && (
                      <p className="admin-hint">
                        Photo choisie : {photo.name}.{' '}
                        <button
                          type="button"
                          className="admin-button"
                          onClick={() => setPhoto(null)}
                        >
                          Retirer la photo
                        </button>
                      </p>
                    )}
                    <ErrorNotice message={photoProblem} />
                  </div>
                )}
                {/* Seulement pour un coach rattaché à au moins une équipe. */}
                {info.roles.includes('coach') && coaches.length > 0 && (
                  <section className="user-card-coach" aria-label="Rattachements coach">
                    <h4>Coach des équipes</h4>
                    <ul className="user-card-badges" aria-label="Équipes coachées">
                      {coaches
                        .filter((item) => item.team_id)
                        .map((item) => (
                          <li key={item.key} className="user-card-badge">
                            <span>{teamName(item.team_id) ?? 'Équipe supprimée'}</span>
                            <button
                              type="button"
                              aria-label={`Retirer ${teamName(item.team_id) ?? 'l’équipe'}`}
                              onClick={() => setUncoaching(item)}
                            >
                              ×
                            </button>
                          </li>
                        ))}
                    </ul>
                    {/* Un rattachement coach qui vient d’être ajouté : choisir son équipe, qui devient
                        un badge. */}
                    {coaches
                      .filter((item) => !item.team_id)
                      .map((item) => (
                        <div className="admin-inline-row" key={item.key}>
                          <select
                            aria-label="Équipe à coacher"
                            value=""
                            onChange={(change) =>
                              patch('coaches', item.key, { team_id: change.target.value })
                            }
                          >
                            <option value="">Choisir l’équipe à coacher…</option>
                            <TeamOptions
                              teams={catalog.teams.filter(
                                (team) => !coaches.some((entry) => entry.team_id === team.id),
                              )}
                              accountId={accountId}
                            />
                          </select>
                          <button
                            type="button"
                            className="admin-button"
                            onClick={() => removeCoach(item.key)}
                          >
                            Annuler
                          </button>
                        </div>
                      ))}
                  </section>
                )}
              </>
            ) : (
              player && (
                <div className="admin-fields">
                  <div className="admin-field">
                    <label htmlFor={`${titleId}-${player.key}-team`}>Équipe</label>
                    <select
                      id={`${titleId}-${player.key}-team`}
                      value={player.team_id}
                      onChange={(change) =>
                        patch('players', player.key, { team_id: change.target.value })
                      }
                    >
                      <option value="">Choisir…</option>
                      <TeamOptions teams={catalog.teams} accountId={accountId} />
                    </select>
                  </div>
                  <div className="admin-field">
                    <label htmlFor={`${titleId}-${player.key}-number`}>Numéro de maillot</label>
                    <input
                      id={`${titleId}-${player.key}-number`}
                      type="number"
                      min={1}
                      max={99}
                      value={player.number}
                      onChange={(change) =>
                        patch('players', player.key, { number: change.target.value })
                      }
                    />
                  </div>
                  <div className="admin-field">
                    <label htmlFor={`${titleId}-${player.key}-position`}>Poste</label>
                    <select
                      id={`${titleId}-${player.key}-position`}
                      value={player.position_id}
                      onChange={(change) =>
                        patch('players', player.key, { position_id: change.target.value })
                      }
                    >
                      <option value="">Non renseigné</option>
                      {catalog.positions.map((position) => (
                        <option key={position.id} value={position.id}>
                          {position.name}
                        </option>
                      ))}
                    </select>
                    {!catalog.positions.length && (
                      <p className="admin-hint">Définissez les postes dans l’onglet Postes.</p>
                    )}
                  </div>
                  <div className="admin-actions">
                    <button
                      type="button"
                      className="admin-button danger"
                      onClick={() => removePlayer(player.key)}
                    >
                      Retirer ce rattachement
                    </button>
                  </div>
                </div>
              )
            )}
          </div>
          <ErrorNotice message={error} />
          {editable && (
            <div className="admin-actions user-card-actions">
              <div className="user-card-add">
                <button
                  type="button"
                  className="admin-button"
                  aria-expanded={choosing}
                  disabled={!catalog.teams.length}
                  onClick={() => setChoosing(!choosing)}
                >
                  Ajouter un rattachement
                </button>
                {choosing && (
                  <div className="user-card-kinds" role="group" aria-label="Type de rattachement">
                    <button
                      type="button"
                      className="admin-button"
                      onClick={() => addAssignment('player')}
                    >
                      Joueur
                    </button>
                    <button
                      type="button"
                      className="admin-button"
                      onClick={() => addAssignment('coach')}
                    >
                      Coach
                    </button>
                  </div>
                )}
              </div>
              <button type="submit" className="admin-button primary">
                {pending ? 'Enregistrement…' : user ? 'Enregistrer' : 'Créer et inviter'}
              </button>
            </div>
          )}
          {editable && !catalog.teams.length && (
            <p className="admin-hint">Créez une équipe pour ajouter un rattachement.</p>
          )}
        </fieldset>
      </form>
      {uncoaching && (
        <Confirm
          title={`Retirer le coaching de ${teamName(uncoaching.team_id) ?? 'cette équipe'} ?`}
          label="Retirer le coaching"
          onClose={() => setUncoaching(null)}
          onConfirm={async () => removeCoach(uncoaching.key)}
        >
          <p>
            {user?.first_name ?? 'Cette personne'} ne sera plus coach de cette équipe ni référent de
            ses événements. Le retrait prend effet à l’enregistrement de la fiche.
          </p>
        </Confirm>
      )}
    </section>
  );
}

export function InvitationLink({ invitation }: { invitation: Invitation }) {
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
