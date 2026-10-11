import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { authApi } from '../../api/auth';
import { ErrorNotice, Field, Heading, Icon, SessionStatus, Submit } from '../components';
import { useSession } from '../session';
import { useRequest } from '../useRequest';
import { validUsername } from '../validation';

export function LoginPage() {
  const session = useSession();
  const request = useRequest();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState({ username: '', password: '' });
  if (session.state === 'idle' || session.state === 'loading') return <SessionStatus />;
  if (session.state === 'error')
    return <SessionStatus error={session.error} retry={session.retry} />;
  if (session.account) return <Navigate to="/app" replace />;
  function submit(event: FormEvent) {
    event.preventDefault();
    const next = {
      username: validUsername(username) ? '' : 'Saisissez votre identifiant (3 à 80 caractères).',
      password: password.trim() ? '' : 'Saisissez votre mot de passe.',
    };
    setErrors(next);
    if (next.username || next.password) return;
    void request.run(async (signal) =>
      session.connected(
        await authApi.login(username.trim().toLowerCase(), password.trim(), signal),
      ),
    );
  }
  return (
    <>
      <Heading
        eyebrow="BIENVENUE DANS VOTRE ESPACE CLUB"
        title="Heureux de vous retrouver."
        description="Connectez-vous pour retrouver la vie de votre club."
      />
      <form noValidate onSubmit={submit} aria-label="Connexion">
        <ErrorNotice message={request.error} />
        <Field
          label="Identifiant"
          placeholder="Votre identifiant"
          autoComplete="username"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          error={errors.username}
          maxLength={80}
          required
        />
        <Field
          label="Mot de passe"
          password
          autoComplete="current-password"
          placeholder="Votre mot de passe"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          error={errors.password}
          maxLength={128}
          required
        />
        <div className="form-options">
          <Link to="/forgot-password">Mot de passe oublié ?</Link>
        </div>
        <Submit pending={request.pending} progress="Connexion en cours…">
          Se connecter
        </Submit>
      </form>
      <div className="guest-access">
        <span>Pas encore de compte ?</span>
        <button
          type="button"
          className="guest-button"
          onClick={() => {
            session.continueAsGuest();
            navigate('/app');
          }}
        >
          Continuer en tant qu’invité
        </button>
        <p>Accès limité à l’accueil et aux matchs FFVB du club.</p>
      </div>
      <div className="invitation-note">
        <span className="note-icon">
          <Icon name="shield" />
        </span>
        <p>
          <strong>Vous rejoignez le club ?</strong>
          <br />
          Votre compte s’active depuis le lien d’invitation transmis par votre administrateur.
        </p>
      </div>
    </>
  );
}
