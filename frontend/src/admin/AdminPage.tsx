import { useCallback, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AdminProvider, useAdmin, useLoad } from './data';
import type { EventConflict } from './types';
import { UsersPanel } from './UsersPanel';
import { SectionsTeamsPanel, GymnasiumsPanel, PositionsPanel } from './CatalogPanels';
import { BlocksPanel } from './BlocksPanel';
import { FFVBPanel } from './FFVBPanel';
import { ConflictsPanel } from './ConflictsPanel';
import { LicensesPanel } from './LicensesPanel';
import { EmailsPanel, RequestsPanel } from './OperationsPanels';
import './admin.css';
import { missingSources } from './SourceWarnings';

const tabs = [
  { id: 'users', title: 'Utilisateurs' },
  { id: 'sections', title: 'Sections et équipes' },
  { id: 'licenses', title: 'Licences' },
  { id: 'positions', title: 'Postes' },
  { id: 'gymnasiums', title: 'Gymnases' },
  { id: 'blocks', title: 'Indisponibilités' },
  { id: 'requests', title: 'Validations' },
  { id: 'conflicts', title: 'Conflits' },
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
  const { api, catalog, admin } = useAdmin();
  const visible = admin ? tabs : tabs.filter((item) => coachTabs.includes(item.id));
  const requested = search.get('tab') ?? '';
  const tab = visible.find((item) => item.id === (aliases[requested] ?? requested))?.id ?? 'users';
  // Pastille orange de l’onglet FFVB : sources FFVB à configurer.
  const unconfigured = admin ? missingSources(catalog).length : 0;
  // Pastille rouge de l’onglet Conflits : conflits ni résolus ni ignorés. Relue à chaque
  // changement d’onglet ; l’onglet Conflits la met à jour après chaque action.
  const conflictsLoader = useCallback(
    (signal: AbortSignal) =>
      admin ? api.list<EventConflict>('/event-conflicts', false, signal) : Promise.resolve([]),
    [api, admin],
  );
  const conflicts = useLoad(conflictsLoader);
  const { refresh: refreshConflicts } = conflicts;
  useEffect(() => refreshConflicts(), [tab, refreshConflicts]);
  const unresolved = (conflicts.data ?? []).filter((item) => !item.ignored).length;
  const badges: Record<string, { count: number; tone: string; text: (count: number) => string }> = {
    ffvb: {
      count: unconfigured,
      tone: 'warning',
      text: (count) => `${count} source${count > 1 ? 's' : ''} FFVB à configurer`,
    },
    conflicts: {
      count: unresolved,
      tone: 'danger',
      text: (count) => `${count} conflit${count > 1 ? 's' : ''} à traiter`,
    },
  };
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
            aria-describedby={
              (badges[item.id]?.count ?? 0) > 0 ? `admin-tab-${item.id}-count` : undefined
            }
          >
            {item.title}
            {(badges[item.id]?.count ?? 0) > 0 && (
              <>
                {/* Le nombre ne change pas le nom de l’onglet : il en est la description. */}
                <span className={`admin-tab-count ${badges[item.id]!.tone}`} aria-hidden="true">
                  {badges[item.id]!.count}
                </span>
                <span id={`admin-tab-${item.id}-count`} hidden>
                  {badges[item.id]!.text(badges[item.id]!.count)}
                </span>
              </>
            )}
          </Link>
        ))}
      </nav>
      <div className="admin-panel" key={tab}>
        {tab === 'users' && <UsersPanel />}
        {tab === 'sections' && <SectionsTeamsPanel />}
        {tab === 'licenses' && <LicensesPanel />}
        {tab === 'positions' && <PositionsPanel />}
        {tab === 'gymnasiums' && <GymnasiumsPanel />}
        {tab === 'blocks' && <BlocksPanel />}
        {tab === 'conflicts' && <ConflictsPanel onChanged={refreshConflicts} />}
        {tab === 'ffvb' && <FFVBPanel />}
        {tab === 'emails' && <EmailsPanel />}
        {tab === 'requests' && <RequestsPanel />}
      </div>
    </>
  );
}
