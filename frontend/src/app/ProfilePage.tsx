import { useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { createAdminApi } from '../admin/api';
import { useLoad } from '../admin/data';
import { licenseLabels, licenseTones, type LicenseStatus } from '../admin/LicensesPanel';
import { Badge, Confirm, EntityForm, LoadState, Notice, checked, str } from '../admin/ui';
import { ErrorNotice, Icon } from '../auth/components';
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
const MIN_PASSWORD = 12;

/** Champ mot de passe avec bouton afficher / masquer et aide sous le champ. */
function PasswordField({
  id,
  label,
  value,
  onChange,
  autoComplete,
  hint,
  tone,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: 'current-password' | 'new-password';
  hint?: string;
  tone?: 'good' | 'warning';
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="admin-field profile-password">
      <label htmlFor={id}>{label}</label>
      <div className="profile-password-input">
        <input
          id={id}
          type={visible ? 'text' : 'password'}
          autoComplete={autoComplete}
          value={value}
          aria-describedby={hint ? `${id}-hint` : undefined}
          onChange={(event) => onChange(event.target.value)}
        />
        <button
          type="button"
          className="profile-password-reveal"
          aria-label={`${visible ? 'Masquer' : 'Afficher'} : ${label.toLowerCase()}`}
          aria-pressed={visible}
          onClick={() => setVisible(!visible)}
        >
          {visible ? 'Masquer' : 'Afficher'}
        </button>
      </div>
      {hint && (
        <p
          id={`${id}-hint`}
          className={`profile-password-hint${tone ? ` ${tone}` : ''}`}
          aria-live="polite"
        >
          {hint}
        </p>
      )}
    </div>
  );
}

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
  const [revoking, setRevoking] = useState(false);
  const length = next.trim().length;
  const long = length >= MIN_PASSWORD;
  const matching = !!confirmation && confirmation.trim() === next.trim();
  return (
    <section className="admin-card profile-security" aria-labelledby="account-security">
      <h2 id="account-security">Sécurité du compte</h2>
      <p className="admin-hint">
        Gardez la main sur l’accès à votre compte : mot de passe et appareils connectés.
      </p>
      {done && <Notice>{done}</Notice>}
      <div className="profile-security-grid">
        <form
          className="profile-security-block"
          aria-labelledby="password-title"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            setDone('');
            const value = next.trim();
            if (!current.trim()) return setInvalid('Saisissez votre mot de passe actuel.');
            if (value.length < MIN_PASSWORD || value.length > 128)
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
          <h3 id="password-title">
            <Icon name="lock" /> Mot de passe
          </h3>
          <p className="admin-hint">
            Au moins {MIN_PASSWORD} caractères. Le changer déconnecte vos autres appareils.
          </p>
          <ErrorNotice message={invalid || change.error} />
          <PasswordField
            id="password-current"
            label="Mot de passe actuel"
            autoComplete="current-password"
            value={current}
            onChange={setCurrent}
          />
          <PasswordField
            id="password-new"
            label="Nouveau mot de passe"
            autoComplete="new-password"
            value={next}
            onChange={setNext}
            hint={long ? 'Longueur suffisante' : `${length} / ${MIN_PASSWORD} caractères minimum`}
            tone={long ? 'good' : length ? 'warning' : undefined}
          />
          <PasswordField
            id="password-confirmation"
            label="Confirmer le nouveau mot de passe"
            autoComplete="new-password"
            value={confirmation}
            onChange={setConfirmation}
            hint={
              confirmation
                ? matching
                  ? 'Les mots de passe correspondent'
                  : 'Les mots de passe sont différents'
                : undefined
            }
            tone={confirmation ? (matching ? 'good' : 'warning') : undefined}
          />
          <div className="admin-actions">
            <button type="submit" className="admin-button primary" disabled={change.pending}>
              {change.pending ? 'Modification…' : 'Changer le mot de passe'}
            </button>
          </div>
        </form>
        <div className="profile-security-block" role="group" aria-labelledby="devices-title">
          <h3 id="devices-title">
            <Icon name="exit" /> Appareils connectés
          </h3>
          <p className="admin-hint">
            Appareil perdu, ordinateur partagé ou session restée ouverte ailleurs : déconnectez tous
            vos autres appareils. Cette session reste ouverte.
          </p>
          <ErrorNotice message={revoke.error} />
          <div className="admin-actions">
            <button
              type="button"
              className="admin-button"
              disabled={revoke.pending}
              onClick={() => {
                setDone('');
                setRevoking(true);
              }}
            >
              Déconnecter mes autres appareils
            </button>
          </div>
        </div>
      </div>
      {revoking && (
        <Confirm
          title="Déconnecter vos autres appareils ?"
          label="Déconnecter"
          onClose={() => setRevoking(false)}
          onConfirm={async (signal) => {
            await api.request<void>('/me/sessions/revoke', 'POST', undefined, signal);
            setDone('Vos autres appareils ont été déconnectés.');
          }}
        >
          <p>
            Toutes vos autres sessions seront fermées : il faudra vous reconnecter sur ces
            appareils. Cette session reste ouverte.
          </p>
        </Confirm>
      )}
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
