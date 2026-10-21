import { useEffect, useRef, useState } from 'react';
import { Link, Navigate, NavLink, useLocation } from 'react-router-dom';
import type { Account } from '../api/auth';
import { AuthLayout, ClubMark, ErrorNotice, Icon, SessionStatus } from '../auth/components';
import { useSession } from '../auth/session';
import { useRequest } from '../auth/useRequest';
import { createAdminApi } from '../admin/api';
import { AdminPage } from '../admin/AdminPage';
import { ProfilePage } from './ProfilePage';
import { CountBadge, UnreadProvider, useUnread } from './unread';
import { ClubProvider, GuestClubProvider } from '../club/context';
import { GuestHome, GuestPlanning } from '../club/GuestPages';
import { HomePage } from '../club/HomePage';
import { PlanningPage } from '../club/PlanningPage';
import { GymnasiumsPage } from '../club/GymnasiumsPage';
import { MessagingPage } from '../club/MessagingPage';
import { MyPlanningPage } from '../club/MyPlanningPage';
import { MySectionsPage } from '../club/MySectionsPage';
import { OurClubPage } from '../club/OurClubPage';
import { InscriptionsPage } from '../club/InscriptionsPage';

const clubSections = [
  'Accueil',
  'Planning',
  'Gymnases',
  'Messagerie',
  'Mon planning',
  'Mes sections',
  'Notre club',
  'Inscriptions',
];

const applications = [
  { path: '/app', title: 'Accueil', icon: 'home' },
  { path: '/app/planning', title: 'Planning', icon: 'calendar' },
  { path: '/app/notre-club', title: 'Notre club', icon: 'users' },
  { path: '/app/gymnases', title: 'Gymnases', icon: 'court' },
  { path: '/app/messagerie', title: 'Messagerie', icon: 'message' },
  { path: '/app/inscriptions', title: 'Inscriptions', icon: 'clipboard' },
  { path: '/app/administration', title: 'Administration', icon: 'shield' },
] as const;
// Application réservée aux administrateurs et aux coachs.
const staffOnly = ['/app/administration'];
// Ouverte à l’encadrement, et à un joueur pendant le traitement de son dossier d’inscription.
const DOSSIER_PATH = '/app/inscriptions';
// Un invité ne voit que l’accueil et les matchs FFVB du planning.
const guestSections = ['Accueil', 'Planning', 'Notre club'];
const sectionTitles: Record<string, string> = {
  '/app': 'Accueil',
  ...Object.fromEntries(applications.map((item) => [item.path, item.title])),
  '/app/mon-planning': 'Mon planning',
  '/app/sections': 'Mes sections',
  '/app/profil': 'Mon profil',
};

export function AppShell() {
  const session = useSession();
  const location = useLocation();
  const section = sectionTitles[location.pathname];
  if (session.state === 'idle' || session.state === 'loading')
    return (
      <AuthLayout>
        <SessionStatus />
      </AuthLayout>
    );
  if (session.state === 'error')
    return (
      <AuthLayout>
        <SessionStatus error={session.error} retry={session.retry} />
      </AuthLayout>
    );
  if (!session.account) {
    if (!session.guest) return <Navigate to="/login" replace />;
    if (!section || !guestSections.includes(section)) return <Navigate to="/app" replace />;
    return <Workspace key={`invité:${location.pathname}`} account={null} section={section} />;
  }
  // Les coachs ont une administration limitée : sections, équipes et licences de leurs équipes.
  const staff = session.account.roles.some((role) => role === 'admin' || role === 'coach');
  if (!section || (staffOnly.includes(location.pathname) && !staff))
    return <Navigate to="/app" replace />;
  return (
    <UnreadProvider key={session.account.id}>
      <Workspace
        key={`${session.account.id}:${location.pathname}`}
        account={session.account}
        section={section}
      />
    </UnreadProvider>
  );
}

/** Coque de l’application ; sans compte (`account` nul), la version réduite des invités. */
function Workspace({ account, section }: { account: Account | null; section: string }) {
  const session = useSession();
  const request = useRequest();
  const [profileOpen, setProfileOpen] = useState(false);
  const [navigationOpen, setNavigationOpen] = useState(false);
  const navigation = useRef<HTMLElement>(null);
  const navigationButton = useRef<HTMLButtonElement>(null);
  const profile = useRef<HTMLDivElement>(null);
  const profileButton = useRef<HTMLButtonElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const admin = account?.roles.includes('admin') ?? false;
  const staff = admin || (account?.roles.includes('coach') ?? false);
  const unread = useUnread();
  // Relu à chaque nouvelle notification : une demande de pièces fait apparaître l’application.
  const dossier = useOpenDossier(account, unread.notifications);
  const badges: Partial<Record<string, { count: number; label: [string, string] }>> = {
    Accueil: {
      count: unread.notifications,
      label: ['notification non lue', 'notifications non lues'],
    },
    Messagerie: {
      count: unread.messages,
      label: admin
        ? ['question non lue', 'questions non lues']
        : ['réponse non lue', 'réponses non lues'],
    },
    Inscriptions: {
      count: dossier.pending,
      label: ['pièce à déposer', 'pièces à déposer'],
    },
  };
  const { refresh } = unread;
  // Chaque changement de section relit les compteurs.
  useEffect(refresh, [refresh]);
  useEffect(() => {
    document.title = `${section} · LSO Colombes Volley`;
    title.current?.focus();
  }, [section]);
  useEffect(() => {
    if (!profileOpen) return;
    function outside(event: PointerEvent) {
      if (event.target instanceof Node && !profile.current?.contains(event.target))
        setProfileOpen(false);
    }
    function escape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setProfileOpen(false);
        profileButton.current?.focus();
      }
    }
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [profileOpen]);
  useEffect(() => {
    if (!navigationOpen) return;
    function outside(event: PointerEvent) {
      if (
        event.target instanceof Node &&
        !navigation.current?.contains(event.target) &&
        !navigationButton.current?.contains(event.target)
      )
        setNavigationOpen(false);
    }
    function escape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setNavigationOpen(false);
        navigationButton.current?.focus();
      }
    }
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [navigationOpen]);
  return (
    <div className="app-shell">
      <a className="skip-link" href="#section-content">
        Aller au contenu
      </a>
      <aside ref={navigation} className={`app-sidebar${navigationOpen ? ' expanded' : ''}`}>
        <Link to="/app" className="sidebar-brand" aria-label="LSO Colombes Volley — accueil">
          <ClubMark compact />
        </Link>
        <nav aria-label="Applications">
          {applications
            .filter((item) =>
              account
                ? item.path === DOSSIER_PATH
                  ? staff || dossier.open
                  : !staffOnly.includes(item.path) || staff
                : guestSections.includes(item.title),
            )
            .map((item) => (
              <NavLink
                key={item.path}
                to={item.path}
                end
                className={({ isActive }) => `app-nav-link${isActive ? ' active' : ''}`}
              >
                <Icon name={item.icon} />
                <span>{item.title}</span>
                {account && item.title in badges && <CountBadge {...badges[item.title]!} />}
              </NavLink>
            ))}
        </nav>
        <span className="sidebar-bottom">
          LSOC<span>ESPACE CLUB</span>
        </span>
      </aside>
      <div className="app-body">
        <header className="app-header">
          <button
            ref={navigationButton}
            className="mobile-menu"
            type="button"
            aria-label={navigationOpen ? 'Fermer les applications' : 'Ouvrir les applications'}
            aria-expanded={navigationOpen}
            onClick={() => setNavigationOpen(!navigationOpen)}
          >
            <Icon name="menu" />
            {unread.messages + unread.notifications > 0 && (
              <span className="nav-dot" aria-hidden="true" />
            )}
          </button>
          <div className="app-title">
            <span className="eyebrow">{account ? 'ESPACE CLUB' : 'ESPACE CLUB · INVITÉ'}</span>
            <h1 ref={title} tabIndex={-1}>
              {section}
            </h1>
          </div>
          {account ? (
            <div className="account-tools">
              <NavLink to="/app/mon-planning" className="header-link" aria-label="Mon planning">
                <Icon name="calendar" />
                <span>Mon planning</span>
              </NavLink>
              <NavLink to="/app/sections" className="header-link" aria-label="Mes sections">
                <Icon name="layers" />
                <span>Mes sections</span>
              </NavLink>
              <span className="header-separator" />
              <div className="profile-control" ref={profile}>
                <button
                  ref={profileButton}
                  className="profile-button"
                  type="button"
                  aria-label={`Options du profil de ${account.first_name}`}
                  aria-expanded={profileOpen}
                  aria-controls="profile-options"
                  onClick={() => setProfileOpen(!profileOpen)}
                >
                  <span className="avatar">{account.first_name.slice(0, 2).toUpperCase()}</span>
                  <span className="profile-name">{account.first_name}</span>
                  <Icon name="chevron" />
                </button>
                {profileOpen && (
                  <div className="profile-popover" id="profile-options">
                    <span className="profile-caption">MON COMPTE</span>
                    <Link to="/app/profil">
                      <Icon name="profile" />
                      Mon profil
                    </Link>
                    <Link to="/confidentialite">
                      <Icon name="shield" />
                      Confidentialité
                    </Link>
                    <div className="popover-divider" />
                    <button
                      type="button"
                      disabled={request.pending}
                      onClick={() => {
                        void request.run(session.logout);
                      }}
                    >
                      <Icon name="exit" />
                      {request.pending ? 'Déconnexion en cours…' : 'Se déconnecter'}
                    </button>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="account-tools">
              <Link to="/confidentialite" className="header-link">
                <Icon name="shield" />
                <span>Confidentialité</span>
              </Link>
              <Link to="/login" className="admin-button primary guest-signin">
                <Icon name="profile" />
                <span>Se connecter</span>
              </Link>
            </div>
          )}
        </header>
        {request.error && (
          <div className="shell-error">
            <ErrorNotice message={request.error} />
          </div>
        )}
        <main
          id="section-content"
          className="section-content"
          aria-label={`Contenu de la section ${section}`}
          tabIndex={-1}
        >
          {section === 'Administration' && <AdminPage />}
          {section === 'Mon profil' && account && <ProfilePage account={account} />}
          {!account && (
            <GuestClubProvider>
              {section === 'Accueil' && <GuestHome />}
              {section === 'Planning' && <GuestPlanning />}
              {section === 'Notre club' && <OurClubPage />}
            </GuestClubProvider>
          )}
          {account && clubSections.includes(section) && (
            <ClubProvider account={account}>
              <ClubPage section={section} />
            </ClubProvider>
          )}
        </main>
      </div>
    </div>
  );
}

function ClubPage({ section }: { section: string }) {
  return (
    <>
      {section === 'Accueil' && <HomePage />}
      {section === 'Planning' && <PlanningPage />}
      {section === 'Gymnases' && <GymnasiumsPage />}
      {section === 'Messagerie' && <MessagingPage />}
      {section === 'Mon planning' && <MyPlanningPage />}
      {section === 'Mes sections' && <MySectionsPage />}
      {section === 'Notre club' && <OurClubPage />}
      {section === 'Inscriptions' && <InscriptionsPage />}
    </>
  );
}

/** Dossier d’inscription en cours : il ouvre l’application Inscriptions au joueur. */
/** Dossier d’inscription en cours du compte et nombre de pièces qu’il lui reste à déposer. */
function useOpenDossier(
  account: Account | null,
  notifications: number,
): { open: boolean; pending: number } {
  const { csrfToken, clear } = useSession();
  const [state, setState] = useState({ open: false, pending: 0 });
  useEffect(() => {
    if (!account) return;
    const controller = new AbortController();
    createAdminApi(csrfToken, clear)
      .request<{ id?: string; documents?: { status: string }[] } | null>(
        '/dossiers/me',
        'GET',
        undefined,
        controller.signal,
      )
      .then((value) =>
        setState({
          open: Boolean(value?.id),
          pending: value?.id
            ? (value.documents ?? []).filter((item) =>
                ['requested', 'rejected'].includes(item.status),
              ).length
            : 0,
        }),
      )
      .catch(() => undefined);
    return () => controller.abort();
  }, [account, notifications, csrfToken, clear]);
  return state;
}
