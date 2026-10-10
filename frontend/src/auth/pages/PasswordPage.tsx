import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { authApi } from '../../api/auth';
import { BackLink, ErrorNotice, Field, Heading, Submit } from '../components';
import { LinkMissing, useLinkToken } from '../linkToken';
import { useSession } from '../session';
import { useRequest } from '../useRequest';
import { validUsername } from '../validation';

export function PasswordPage({ invitation = false }: { invitation?: boolean }) {
  const { token, valid } = useLinkToken();
  const navigate = useNavigate();
  const session = useSession();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [errors, setErrors] = useState({ username: '', password: '', confirmation: '' });
  const request = useRequest();
  if (!valid) return <LinkMissing invitation={invitation} />;
  function submit(event: FormEvent) {
    event.preventDefault();
    const next = {
      username:
        invitation && !validUsername(username)
          ? 'Utilisez 3 à 80 caractères : lettres sans accents, chiffres, point, tiret ou underscore.'
          : '',
      password:
        password.trim().length < 12 || password.trim().length > 128
          ? 'Utilisez entre 12 et 128 caractères.'
          : '',
      confirmation:
        password.trim() !== confirmation.trim()
          ? 'Les mots de passe ne correspondent pas.'
          : !confirmation
            ? 'Confirmez votre mot de passe.'
            : '',
    };
    setErrors(next);
    if (Object.values(next).some(Boolean)) return;
    void request.run(async (signal) => {
      if (invitation)
        await authApi.activate(token, username.trim().toLowerCase(), password.trim(), signal);
      else {
        await authApi.resetPassword(token, password.trim(), signal);
        session.clear();
      }
      const flow = invitation ? 'activate' : 'reset-password';
      navigate(`/${flow}/success`, { replace: true, state: { authResult: flow } });
    });
  }
  return (
    <>
      <BackLink />
      <Heading
        eyebrow={invitation ? 'BIENVENUE DANS L’ÉQUIPE' : 'UN NOUVEAU DÉPART'}
        title={invitation ? 'Votre place est ici.' : 'Choisissez un nouveau mot de passe.'}
        description={
          invitation
            ? 'Choisissez votre identifiant unique et un mot de passe personnel pour activer votre compte.'
            : 'Choisissez un mot de passe que vous n’utilisez pas ailleurs.'
        }
      />
      <form
        onSubmit={submit}
        noValidate
        aria-label={invitation ? 'Activation du compte' : 'Réinitialisation du mot de passe'}
      >
        <ErrorNotice message={request.error} />
        {invitation && (
          <Field
            label="Identifiant"
            autoComplete="username"
            placeholder="camille.volley"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            error={errors.username}
            hint="3 à 80 caractères : lettres sans accents, chiffres, point, tiret, underscore, ou une adresse e-mail."
            maxLength={80}
            required
          />
        )}
        <Field
          label={invitation ? 'Mot de passe' : 'Nouveau mot de passe'}
          password
          autoComplete="new-password"
          placeholder="12 caractères minimum"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          error={errors.password}
          hint="Entre 12 et 128 caractères. Les espaces en début et fin sont ignorés."
          maxLength={128}
          required
        />
        <Field
          label="Confirmer le mot de passe"
          password
          autoComplete="new-password"
          placeholder="Saisissez-le une seconde fois"
          value={confirmation}
          onChange={(event) => setConfirmation(event.target.value)}
          error={errors.confirmation}
          maxLength={128}
          required
        />
        <Submit pending={request.pending}>
          {invitation ? 'Activer mon compte' : 'Enregistrer le mot de passe'}
        </Submit>
      </form>
      {request.error &&
        (invitation ? (
          <p className="form-footnote">
            Si votre invitation a expiré, demandez un nouveau lien à l’administrateur.
          </p>
        ) : (
          <Link className="subtle-link" to="/forgot-password">
            Demander un nouveau lien
          </Link>
        ))}
    </>
  );
}
