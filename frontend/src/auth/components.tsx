import {
  useEffect,
  useId,
  useRef,
  useState,
  type InputHTMLAttributes,
  type ReactNode,
} from 'react';
import { Link } from 'react-router-dom';

const paths = {
  arrow: 'M5 12h14m-6-6 6 6-6 6',
  back: 'M19 12H5m6-6-6 6 6 6',
  mail: 'M3 5h18v14H3z M3 5l9 7 9-7',
  lock: 'M5 10h14v11H5z M8 10V7a4 4 0 0 1 8 0v3 M12 14v3',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
  check: 'M5 12l4 4L19 6',
  shield: 'M12 3l8 3v6c0 5-8 9-8 9s-8-4-8-9V6z M8 12l3 3 5-6',
  home: 'M3 10l9-7 9 7 M5 9v12h14V9 M9 21v-7h6v7',
  calendar: 'M4 5h16v16H4z M8 3v4 M16 3v4 M4 10h16 M8 14h2 M14 14h2 M8 17h2',
  court: 'M3 5h18v14H3z M12 5v14 M3 10h18 M7 5v5 M17 10v9',
  message: 'M4 4h16v13H9l-5 4z M8 8h8 M8 12h5',
  layers: 'M12 3l10 5-10 5L2 8z M2 12l10 5 10-5 M2 16l10 5 10-5',
  profile: 'M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0 M4 21v-3c0-3 3-5 8-5s8 2 8 5v3',
  exit: 'M10 4H4v16h6 M10 12h11 M17 8l4 4-4 4',
  chevron: 'M6 9l6 6 6-6',
  menu: 'M4 6h16 M4 12h16 M4 18h16',
  clipboard: 'M9 3h6v4H9z M7 5H5v16h14V5h-2 M8 12h8 M8 16h5',
};
export function Icon({ name, className = '' }: { name: keyof typeof paths; className?: string }) {
  return (
    <svg
      className={className}
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  );
}

export function ClubMark({ compact = false }: { compact?: boolean }) {
  return (
    <span className={`club-mark${compact ? ' compact' : ''}`}>
      <img src="/lsoc_logo.png" alt="" width="250" height="416" />
      {!compact && (
        <span>
          <strong>LSO COLOMBES</strong>
          <span>VOLLEY</span>
        </span>
      )}
    </span>
  );
}

export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="auth-layout">
      <aside className="club-panel" aria-label="LSO Colombes Volley">
        <ClubMark />
        <div className="club-message">
          <span className="eyebrow">VOTRE CLUB. VOTRE ÉQUIPE.</span>
          <h2>
            Le collectif
            <br />
            commence <span>ici.</span>
          </h2>
          <p>
            Un même espace pour partager
            <br className="desktop-break" /> la vie du club.
          </p>
        </div>
        <div className="court-art" aria-hidden="true">
          <div className="court-lines">
            <i />
            <b />
            <em />
          </div>
          <div className="volley-ball">
            <svg viewBox="0 0 180 180" fill="none">
              <circle cx="90" cy="90" r="86" />
              <path d="M90 4c-17 25-18 55 0 86m85 0c-33-8-54-1-85 0m0 85c23-27 34-54 0-85M18 47c34-4 59 12 72 43m-74 49c16-34 40-49 74-49m53-68c-2 30-21 57-53 68" />
            </svg>
          </div>
          <span className="court-dot one" />
          <span className="court-dot two" />
        </div>
        <div className="club-panel-footer">
          <span>ENSEMBLE, SUR TOUS LES TERRAINS.</span>
          <span className="club-coordinate">COLOMBES · 92</span>
        </div>
      </aside>
      <div className="auth-side">
        <header className="mobile-brand">
          <ClubMark />
        </header>
        <main className="auth-main">
          <div className="auth-card">{children}</div>
        </main>
        <footer className="auth-footer">
          <span>LSO Colombes Volley</span>
          <span>Votre espace club</span>
        </footer>
      </div>
    </div>
  );
}

export function Heading({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description?: string;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
    document.title = `${title} · LSO Colombes Volley`;
  }, [title]);
  return (
    <div className="form-heading">
      <span className="eyebrow">{eyebrow}</span>
      <h1 ref={heading} tabIndex={-1}>
        {title}
      </h1>
      {description && <p>{description}</p>}
    </div>
  );
}

interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
  hint?: string;
  password?: boolean;
}
export function Field({ label, error, hint, password = false, ...props }: FieldProps) {
  const id = useId();
  const [visible, setVisible] = useState(false);
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className={`input-wrap${error ? ' invalid' : ''}`}>
        <Icon name={password ? 'lock' : 'mail'} />
        <input
          {...props}
          id={id}
          type={password ? (visible ? 'text' : 'password') : (props.type ?? 'text')}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
        />
        {password && (
          <button
            className="reveal-password"
            type="button"
            onClick={() => setVisible(!visible)}
            aria-label={`${visible ? 'Masquer' : 'Afficher'} le mot de passe${props.autoComplete === 'new-password' && label.startsWith('Confirmer') ? ' de confirmation' : ''}`}
            aria-pressed={visible}
          >
            <Icon name="eye" />
          </button>
        )}
      </div>
      {error && (
        <span id={`${id}-error`} className="field-error">
          {error}
        </span>
      )}
      {hint && !error && (
        <span id={`${id}-hint`} className="field-hint">
          {hint}
        </span>
      )}
    </div>
  );
}

export function Submit({
  pending,
  children,
  progress = 'Envoi en cours…',
}: {
  pending: boolean;
  children: ReactNode;
  progress?: string;
}) {
  return (
    <button className="button primary" type="submit" disabled={pending}>
      {pending ? (
        <>
          <span className="spinner" />
          {progress}
        </>
      ) : (
        <>
          {children}
          <Icon name="arrow" />
        </>
      )}
    </button>
  );
}
export function ErrorNotice({ message }: { message: string }) {
  return message ? (
    <div className="error-notice" role="alert">
      {message}
    </div>
  ) : null;
}
export function BackLink() {
  return (
    <Link className="back-link" to="/login">
      <Icon name="back" />
      Retour à la connexion
    </Link>
  );
}
export function Success({
  title,
  children,
  verification = false,
}: {
  title: string;
  children: ReactNode;
  verification?: boolean;
}) {
  return (
    <div className="success-view">
      <span className="result-symbol">
        <Icon name={verification ? 'mail' : 'check'} />
      </span>
      <Heading eyebrow="UNE ÉTAPE DE PLUS" title={title} />
      <div className="success-copy" role="status">
        {children}
      </div>
      <BackLink />
    </div>
  );
}
export function SessionStatus({ error, retry }: { error?: string; retry?: () => void }) {
  return (
    <div className="session-status">
      <Heading
        eyebrow="ESPACE CLUB"
        title={error ? 'Connexion au club indisponible.' : 'Vérification de votre session…'}
      />
      <ErrorNotice message={error ?? ''} />
      {retry ? (
        <button className="button primary" type="button" onClick={retry}>
          Réessayer
          <Icon name="arrow" />
        </button>
      ) : (
        <span role="status" className="loading-line">
          <span className="spinner" />
          Un instant, nous préparons votre accès.
        </span>
      )}
    </div>
  );
}
