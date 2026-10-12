import { Link, useSearchParams } from 'react-router-dom';
import { AdminProvider, useAdmin } from './data';
import { UsersPanel } from './UsersPanel';
import { SectionsTeamsPanel, GymnasiumsPanel } from './CatalogPanels';
import { BlocksPanel } from './BlocksPanel';
import { FFVBPanel } from './FFVBPanel';
import { LicensesPanel } from './LicensesPanel';
import { EmailsPanel, RequestsPanel } from './OperationsPanels';
import './admin.css';
import { SourceWarnings } from './SourceWarnings';

const tabs = [
  { id: 'users', title: 'Utilisateurs' },
  { id: 'sections', title: 'Sections et équipes' },
  { id: 'licenses', title: 'Licences' },
  { id: 'gymnasiums', title: 'Gymnases' },
  { id: 'blocks', title: 'Indisponibilités' },
  { id: 'requests', title: 'Validations' },
  { id: 'ffvb', title: 'FFVB' },
  { id: 'emails', title: 'E-mails' },
];
// Administration limitée des coachs, en lecture seule.
const coachTabs = ['users', 'licenses', 'sections'];
// Anciens liens (notifications) vers l’onglet Équipes, fusionné dans Sections et équipes.
const aliases: Record<string, string> = { teams: 'sections' };
export function AdminPage() {
  return (
    <div className="administration">
      <AdminProvider>
        <Administration />
      </AdminProvider>
    </div>
  );
}
function Administration() {
  const [search] = useSearchParams();
  const { catalog, admin } = useAdmin();
  const visible = admin ? tabs : tabs.filter((item) => coachTabs.includes(item.id));
  const requested = search.get('tab') ?? '';
  const tab = visible.find((item) => item.id === (aliases[requested] ?? requested))?.id ?? 'users';
  return (
    <>
      <div className="admin-overview">
        <span>
          <strong>{catalog.users.length}</strong> utilisateurs
        </span>
        <span>
          <strong>{catalog.sections.length}</strong> sections
        </span>
        <span>
          <strong>{catalog.teams.length}</strong> équipes
        </span>
        {admin && (
          <span>
            <strong>{catalog.gymnasiums.length}</strong> gymnases
          </span>
        )}
      </div>
      <nav className="admin-tabs" aria-label="Administration">
        {visible.map((item) => (
          <Link
            key={item.id}
            to={`?tab=${item.id}`}
            className={item.id === tab ? 'active' : ''}
            aria-current={item.id === tab ? 'page' : undefined}
          >
            {item.title}
          </Link>
        ))}
      </nav>
      {admin && <SourceWarnings />}
      <div className="admin-panel" key={tab}>
        {tab === 'users' && <UsersPanel />}
        {tab === 'sections' && <SectionsTeamsPanel />}
        {tab === 'licenses' && <LicensesPanel />}
        {tab === 'gymnasiums' && <GymnasiumsPanel />}
        {tab === 'blocks' && <BlocksPanel />}
        {tab === 'ffvb' && <FFVBPanel />}
        {tab === 'emails' && <EmailsPanel />}
        {tab === 'requests' && <RequestsPanel />}
      </div>
    </>
  );
}
