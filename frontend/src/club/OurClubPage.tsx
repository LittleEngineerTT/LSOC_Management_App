import { Link, useSearchParams } from 'react-router-dom';
import { PanelHeading } from '../admin/ui';
import { ClubInfoTab } from './ClubInfoTab';
import { ClubRegistrationTab } from './ClubRegistrationTab';
import { ClubStandingsTab } from './ClubStandingsTab';
import { ClubTeamsTab } from './ClubTeamsTab';
import type { ClubPage } from './clubPages';

const tabs = [
  { id: 'infos', title: 'Infos du club' },
  { id: 'equipes', title: 'Nos équipes' },
  { id: 'resultats', title: 'Résultats des équipes' },
  { id: 'inscriptions', title: 'Inscriptions' },
] as const;
type Tab = (typeof tabs)[number]['id'];

/** Onglet affiché : celui demandé, sinon « Nos équipes » pour un lien vers une section ou une
 * équipe (`?page=`, liens d’avant les onglets), sinon le premier. */
function currentTab(search: URLSearchParams): Tab {
  const requested = tabs.find((item) => item.id === search.get('onglet'));
  if (requested) return requested.id;
  return search.has('page') ? 'equipes' : tabs[0].id;
}

/** Application « Notre club » : infos du club, présentation des équipes, leurs classements FFVB
 * et inscriptions, chacun dans son onglet (`?onglet=`).
 */
export function OurClubPage({ pages }: { pages?: ClubPage[] }) {
  const [search] = useSearchParams();
  const tab = currentTab(search);
  return (
    <>
      <PanelHeading
        title="Notre club"
        description="Le club, ses équipes et comment nous rejoindre."
      />
      <nav className="admin-tabs" aria-label="Notre club">
        {tabs.map((item) => (
          <Link
            key={item.id}
            to={`?onglet=${item.id}`}
            className={item.id === tab ? 'active' : undefined}
            aria-current={item.id === tab ? 'page' : undefined}
          >
            {item.title}
          </Link>
        ))}
      </nav>
      <div key={tab}>
        {tab === 'infos' && <ClubInfoTab />}
        {tab === 'equipes' && <ClubTeamsTab pages={pages} />}
        {tab === 'resultats' && <ClubStandingsTab />}
        {tab === 'inscriptions' && <ClubRegistrationTab />}
      </div>
    </>
  );
}
