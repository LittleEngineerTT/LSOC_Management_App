import { useState } from 'react';
import { ErrorNotice } from '../auth/components';
import { useRequest } from '../auth/useRequest';
import { useSession } from '../auth/session';
import { useAdmin } from './data';
import { dateLabel } from './time';
import type { User } from './types';
import { EntityForm, Notice, str } from './ui';

interface Recovery {
  reset_url: string;
  expires_at: string;
}
export function UserCredentials({ user }: { user: User }) {
  const { api, reloadCatalog } = useAdmin();
  const session = useSession();
  const request = useRequest();
  const [link, setLink] = useState<Recovery | null>(null);
  const [notice, setNotice] = useState('');
  return (
    <>
      <EntityForm
        key={user.username}
        title="Identifiant de connexion"
        fields={[
          {
            name: 'username',
            label: 'Identifiant',
            required: true,
            minLength: 3,
            maxLength: 80,
            pattern: '[A-Za-z0-9][A-Za-z0-9._+\\-]*(@[A-Za-z0-9][A-Za-z0-9.\\-]*)?',
            hint: 'Unique, de 3 à 80 caractères ; une adresse e-mail est acceptée. Une modification déconnecte les sessions du compte.',
          },
        ]}
        initial={{ username: user.username ?? '' }}
        submit="Modifier l’identifiant"
        onSave={async (values, signal) => {
          await api.request(
            `/users/${user.id}/username`,
            'PUT',
            { username: str(values, 'username').toLowerCase() },
            signal,
          );
          setNotice('Identifiant mis à jour.');
          reloadCatalog();
          if (
            user.id === session.account?.id &&
            str(values, 'username').toLowerCase() !== user.username
          )
            session.clear();
        }}
      />
      {notice && <Notice>{notice}</Notice>}
      <h4>Réinitialisation du mot de passe</h4>
      <p className="admin-hint">
        Générez un lien valable une heure et transmettez-le à la personne. Chaque nouveau lien
        remplace le précédent. Aucun e-mail n’est envoyé.
      </p>
      <ErrorNotice message={request.error} />
      <button
        className="admin-button"
        disabled={request.pending}
        onClick={() => {
          setLink(null);
          void request.run(async (signal) =>
            setLink(
              await api.request<Recovery>(`/users/${user.id}/password-reset`, 'POST', {}, signal),
            ),
          );
        }}
      >
        Générer un lien de réinitialisation
      </button>
      {link && <RecoveryLink key={link.reset_url} link={link} />}
    </>
  );
}
function RecoveryLink({ link }: { link: Recovery }) {
  const [copy, setCopy] = useState('');
  return (
    <div className="invitation-box">
      <label htmlFor="recovery-link">Lien de réinitialisation</label>
      <input
        id="recovery-link"
        value={link.reset_url}
        readOnly
        onFocus={(event) => event.target.select()}
      />
      <p>Expire le {dateLabel(link.expires_at)}</p>
      <button
        className="admin-button"
        onClick={() => {
          if (!navigator.clipboard) {
            setCopy('Sélectionnez le lien et copiez-le manuellement.');
            return;
          }
          void navigator.clipboard
            .writeText(link.reset_url)
            .then(() => setCopy('Lien copié.'))
            .catch(() => setCopy('Sélectionnez le lien et copiez-le manuellement.'));
        }}
      >
        Copier le lien de réinitialisation
      </button>
      {copy && <p role="status">{copy}</p>}
    </div>
  );
}
