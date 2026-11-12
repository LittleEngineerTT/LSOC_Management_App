import { useCallback, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AdminProvider, useAdmin, useLoad } from './data';
import type { EventConflict } from './types';
import { UsersPanel } from './UsersPanel';
import { SectionsTeamsPanel, GymnasiumsPanel, PositionsPanel } from './CatalogPanels';
import { BlocksPanel } from './BlocksPanel';
import { FFVBPanel } from './FFVBPanel';
import { ConflictsPanel, openConflicts } from './ConflictsPanel';
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
  const unresolved = openConflicts(conflicts.data ?? []);
  // Pastille rouge de l’onglet FFVB : sources activées en erreur (« indisponible ou
  // inexploitable », référent manquant…), relues avec le catalogue.
  const failing = admin
    ? catalog.sources.filter((source) => source.enabled && source.last_error).length
    : 0;
  type Badge = { count: number; tone: string; text: string };
  const plural = (count: number) => (count > 1 ? 's' : '');
  // Pastilles de chaque onglet, la plus urgente (rouge) d’abord ; une pastille à zéro disparaît.
  const badges: Record<string, Badge[]> = {
    ffvb: [
      {
        count: failing,
        tone: 'danger',
        text: `${failing} source${plural(failing)} FFVB indisponible${plural(failing)}`,
      },
      {
        count: unconfigured,
        tone: 'warning',
        text: `${unconfigured} source${plural(unconfigured)} FFVB à configurer`,
      },
    ].filter((badge) => badge.count > 0),
    conflicts: [
      {
        count: unresolved,
        tone: 'danger',
        text: `${unresolved} conflit${plural(unresolved)} à traiter`,
      },
    ].filter((badge) => badge.count > 0),
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
            aria-describedby={badges[item.id]?.length ? `admin-tab-${item.id}-count` : undefined}
          >
            {item.title}
            {/* Les nombres ne changent pas le nom de l’onglet : ils en sont la description. */}
            {badges[item.id]?.map((badge) => (
              <span key={badge.tone} className={`admin-tab-count ${badge.tone}`} aria-hidden="true">
                {badge.count}
              </span>
            ))}
            {badges[item.id]?.length ? (
              <span id={`admin-tab-${item.id}-count`} hidden>
                {badges[item.id]!.map((badge) => badge.text).join(', ')}
              </span>
            ) : null}
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
