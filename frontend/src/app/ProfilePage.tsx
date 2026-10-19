import { useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { createAdminApi } from '../admin/api';
import { useLoad } from '../admin/data';
import { licenseLabels, licenseTones, type LicenseStatus } from '../admin/LicensesPanel';
import { Badge, Confirm, EntityForm, LoadState, Notice, checked, str } from '../admin/ui';
import { ErrorNotice } from '../auth/components';
import { useRequest } from '../auth/useRequest';
import type { Account } from '../api/auth';
import { useSession } from '../auth/session';
import { validEmail } from '../auth/validation';
import '../admin/admin.css';

export function ProfilePage({ account }: { account: Account }) {
  const session = useSession();
  const [notice, setNotice] = useState('');
  return (
    <div className="administration">
      <section className="admin-card">
        <h2>Mon compte</h2>
        <p>
          Identifiant : <strong>{account.username}</strong>
        </p>
        <p className="admin-hint">
          Contactez un administrateur pour modifier votre identifiant ou si vous avez oublié votre
          mot de passe.
        </p>
      </section>
      <AccountSecurity />
      <MyLicense />
      {notice && <Notice>{notice}</Notice>}
      <EntityForm
        title="Notifications par e-mail"
        submit="Enregistrer les préférences"
        fields={[
          {
            name: 'email',
            label: 'Adresse e-mail de notification (facultative)',
            maxLength: 254,
            hint: 'Utilisée uniquement pour les notifications. Laissez ce champ vide pour ne recevoir aucun e-mail.',
          },
          {
            name: 'followed_email',
            label: 'Modifications des événements suivis',
            type: 'checkbox',
          },
          {
            name: 'referent_email',
            label: 'Modifications des événements dont je suis référent',
            type: 'checkbox',
          },
          ...(account.roles.includes('admin')
            ? [
                {
                  name: 'admin_email',
                  label: 'Notifications d’administration',
                  type: 'checkbox' as const,
                },
              ]
            : []),
        ]}
        initial={{
          email: account.email ?? '',
          followed_email: account.followed_email,
          referent_email: account.referent_email,
          admin_email: account.admin_email,
        }}
        onSave={async (values, signal) => {
          const address = str(values, 'email').trim();
          if (address && !validEmail(address))
            throw new Error('Saisissez une adresse e-mail valide ou laissez le champ vide.');
          const csrf = session.csrfToken();
          if (!csrf) throw new Error('Rechargez la page pour retrouver votre session.');
          const api = createAdminApi(session.csrfToken, session.clear);
          const updated = await api.request<Account>(
            '/preferences',
            'PUT',
            {
              email: address ? address.toLowerCase() : null,
              followed_email: checked(values, 'followed_email'),
              referent_email: checked(values, 'referent_email'),
              admin_email: checked(values, 'admin_email'),
            },
            signal,
          );
          session.connected({ user: updated, csrf_token: csrf });
          setNotice('Préférences enregistrées.');
        }}
      />
      <MyData />
    </div>
  );
}

/** Changement du mot de passe et fermeture des sessions ouvertes sur d’autres appareils. */
function AccountSecurity() {
  const { csrfToken, clear } = useSession();
  const api = useMemo(() => createAdminApi(csrfToken, clear), [csrfToken, clear]);
  const change = useRequest();
  const revoke = useRequest();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [invalid, setInvalid] = useState('');
  const [done, setDone] = useState('');
  return (
    <section className="admin-card" aria-labelledby="account-security">
      <h2 id="account-security">Sécurité du compte</h2>
      {done && <Notice>{done}</Notice>}
      <ErrorNotice message={invalid || change.error || revoke.error} />
      <form
        className="admin-form"
        onSubmit={(event) => {
          event.preventDefault();
          setDone('');
          const value = next.trim();
          if (!current.trim()) return setInvalid('Saisissez votre mot de passe actuel.');
          if (value.length < 12 || value.length > 128)
            return setInvalid('Le nouveau mot de passe doit faire entre 12 et 128 caractères.');
          if (value !== confirmation.trim())
            return setInvalid('Les deux nouveaux mots de passe ne correspondent pas.');
          setInvalid('');
          void change.run(async (signal) => {
            await api.request<void>(
              '/me/password',
              'POST',
              { current_password: current.trim(), new_password: value },
              signal,
            );
            setCurrent('');
            setNext('');
            setConfirmation('');
            setDone('Mot de passe modifié. Vos autres appareils ont été déconnectés.');
          });
        }}
      >
        <label>
          Mot de passe actuel
          <input
            type="password"
            autoComplete="current-password"
            value={current}
            onChange={(event) => setCurrent(event.target.value)}
          />
        </label>
        <label>
          Nouveau mot de passe (12 caractères minimum)
          <input
            type="password"
            autoComplete="new-password"
            value={next}
            onChange={(event) => setNext(event.target.value)}
          />
        </label>
        <label>
          Confirmer le nouveau mot de passe
          <input
            type="password"
            autoComplete="new-password"
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
          />
        </label>
        <div className="admin-actions">
          <button type="submit" className="admin-button" disabled={change.pending}>
            {change.pending ? 'Modification…' : 'Changer le mot de passe'}
          </button>
        </div>
      </form>
      <p className="admin-hint">
        Appareil perdu ou session restée ouverte ailleurs : déconnectez tous vos autres appareils.
        Cette session reste ouverte.
      </p>
      <div className="admin-actions">
        <button
          type="button"
          className="admin-button"
          disabled={revoke.pending}
          onClick={() => {
            setDone('');
            void revoke.run(async (signal) => {
              await api.request<void>('/me/sessions/revoke', 'POST', undefined, signal);
              setDone('Vos autres appareils ont été déconnectés.');
            });
          }}
        >
          Déconnecter mes autres appareils
        </button>
      </div>
    </section>
  );
}

/** Droits RGPD en libre-service : accès et portabilité, effacement immédiat. */
function MyData() {
  const session = useSession();
  const { csrfToken, clear } = session;
  const api = useMemo(() => createAdminApi(csrfToken, clear), [csrfToken, clear]);
  const download = useRequest();
  const [erasing, setErasing] = useState(false);
  const [password, setPassword] = useState('');
  return (
    <section className="admin-card" aria-labelledby="my-data">
      <h2 id="my-data">Mes données</h2>
      <p className="admin-hint">
        Ce que le club conserve et pendant combien de temps :{' '}
        <Link to="/confidentialite">politique de confidentialité</Link>.
      </p>
      <ErrorNotice message={download.error} />
      <div className="admin-actions">
        <button
          type="button"
          className="admin-button"
          disabled={download.pending}
          onClick={() =>
            void download.run(async (signal) => {
              const data = await api.request<unknown>('/me/export', 'GET', undefined, signal);
              const url = URL.createObjectURL(
                new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
              );
              const link = document.createElement('a');
              link.href = url;
              link.download = 'mes-donnees-lsoc.json';
              link.click();
              URL.revokeObjectURL(url);
            })
          }
        >
          {download.pending ? 'Préparation…' : 'Télécharger mes données'}
        </button>
        <button type="button" className="admin-button danger" onClick={() => setErasing(true)}>
          Supprimer mon compte
        </button>
      </div>
      {erasing && (
        <Confirm
          title="Supprimer définitivement votre compte ?"
          label="Supprimer mon compte"
          onClose={() => {
            setErasing(false);
            setPassword('');
          }}
          onConfirm={async (signal) => {
            if (!password) throw new Error('Saisissez votre mot de passe pour confirmer.');
            await api.request('/me/delete', 'POST', { password }, signal);
            session.clear();
          }}
        >
          <p>
            Vos inscriptions, suivis, messages, notifications et préférences sont effacés
            immédiatement. Les événements dont vous êtes référent devront être réattribués par un
            administrateur. Cette action est irréversible.
          </p>
          <label className="admin-field">
            Mot de passe
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
        </Confirm>
      )}
    </section>
  );
}

/** Statut de licence du compte ; le numéro et la gestion restent réservés aux administrateurs. */
function MyLicense() {
  const { csrfToken, clear } = useSession();
  const api = useMemo(() => createAdminApi(csrfToken, clear), [csrfToken, clear]);
  const loader = useCallback(
    (signal: AbortSignal) =>
      api.request<{ status: LicenseStatus; coach_status?: LicenseStatus; coach?: boolean }>(
        '/licenses/me',
        'GET',
        undefined,
        signal,
      ),
    [api],
  );
  const result = useLoad(loader);
  const data = result.data;
  return (
    <section className="admin-card" aria-labelledby="my-license">
      <h2 id="my-license">Ma licence</h2>
      <LoadState result={result} />
      {data && (
        <p>
          Licence joueur :{' '}
          <Badge tone={licenseTones[data.status]}>{licenseLabels[data.status]}</Badge>
        </p>
      )}
      {data?.coach && data.coach_status && (
        <p>
          Licence coach :{' '}
          <Badge tone={licenseTones[data.coach_status]}>{licenseLabels[data.coach_status]}</Badge>
        </p>
      )}
      <p className="admin-hint">
        Les licences sont gérées par les administrateurs du club et sont à refaire chaque saison :
        leur statut repart de zéro le 1er août.
      </p>
    </section>
  );
}
