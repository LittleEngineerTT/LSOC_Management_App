import type { ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Icon } from '../auth/components';

const tabs = [
  { id: 'club', title: 'Planning du club' },
  { id: 'gymnases', title: 'Planning des gymnases' },
  // Recherche de créneau : un onglet loupe, réservé aux adhérents connectés.
  { id: 'recherche', title: 'Recherche de créneau' },
] as const;
type Tab = (typeof tabs)[number]['id'];

// Paramètres communs aux deux onglets, conservés en passant de l’un à l’autre : la période
// affichée et le gymnase (filtre du planning du club, gymnase choisi dans celui des gymnases).
const shared = ['semaine', 'vue', 'jour', 'gymnase'];

function tabLink(search: URLSearchParams, tab: Tab): string {
  const next = new URLSearchParams();
  for (const name of shared) {
    const value = search.get(name);
    if (value) next.set(name, value);
  }
  next.set('onglet', tab);
  return `?${next.toString()}`;
}

/** Application « Planning » : le planning du club et celui des gymnases, chacun dans son
 * onglet (`?onglet=`). Les pages diffèrent pour un adhérent et pour un invité, qui ne voit
 * que les matchs FFVB. */
export function PlanningApp({
  club,
  gyms,
  finder,
}: {
  club: ReactNode;
  gyms: ReactNode;
  /** Recherche de créneau ; absente pour un invité. */
  finder?: ReactNode;
}) {
  const [search] = useSearchParams();
  const visible = tabs.filter((item) => item.id !== 'recherche' || finder);
  const tab: Tab = visible.find((item) => item.id === search.get('onglet'))?.id ?? tabs[0].id;
  return (
    <>
      <nav className="admin-tabs" aria-label="Planning">
        {visible.map((item) => (
          <Link
            key={item.id}
            to={tabLink(search, item.id)}
            className={`${item.id === tab ? 'active' : ''}${item.id === 'recherche' ? ' planning-search-tab' : ''}`}
            aria-current={item.id === tab ? 'page' : undefined}
            aria-label={item.id === 'recherche' ? item.title : undefined}
            title={item.id === 'recherche' ? item.title : undefined}
          >
            {item.id === 'recherche' ? <Icon name="search" /> : item.title}
          </Link>
        ))}
      </nav>
      <div key={tab}>
        {tab === 'club' && club}
        {tab === 'gymnases' && gyms}
        {tab === 'recherche' && finder}
      </div>
    </>
  );
}
