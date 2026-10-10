import { useState } from 'react';
import { createAdminApi } from '../admin/api';
import { EntityForm, Notice, checked, str } from '../admin/ui';
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
          Contactez un administrateur pour modifier votre identifiant ou obtenir un lien de
          réinitialisation du mot de passe.
        </p>
      </section>
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
    </div>
  );
}
