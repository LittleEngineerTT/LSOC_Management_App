import { Link, useSearchParams } from 'react-router-dom';
import { AdminProvider, useAdmin } from './data';
import { UsersPanel } from './UsersPanel';
import { SectionsPanel, TeamsPanel, GymnasiumsPanel } from './CatalogPanels';
import { BlocksPanel } from './BlocksPanel';
import { FFVBPanel } from './FFVBPanel';
import { LicensesPanel } from './LicensesPanel';
import { EmailsPanel, RequestsPanel } from './OperationsPanels';
import './admin.css';
import { SourceWarnings } from './SourceWarnings';

const tabs = [
  { id: 'users', title: 'Utilisateurs' },
  { id: 'sections', title: 'Sections' },
  { id: 'teams', title: 'Équipes' },
  { id: 'licenses', title: 'Licences' },
  { id: 'gymnasiums', title: 'Gymnases' },
  { id: 'blocks', title: 'Indisponibilités' },
  { id: 'requests', title: 'Validations' },
  { id: 'ffvb', title: 'FFVB' },
  { id: 'emails', title: 'E-mails' },
];
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
  const tab = tabs.find((item) => item.id === search.get('tab'))?.id ?? 'users';
  const { catalog } = useAdmin();
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
        <span>
          <strong>{catalog.gymnasiums.length}</strong> gymnases
        </span>
      </div>
      <nav className="admin-tabs" aria-label="Administration">
        {tabs.map((item) => (
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
      <SourceWarnings />
      <div className="admin-panel" key={tab}>
        {tab === 'users' && <UsersPanel />}
        {tab === 'sections' && <SectionsPanel />}
        {tab === 'teams' && <TeamsPanel />}
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
