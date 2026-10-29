import { Link, useSearchParams } from 'react-router-dom';
import { ClubLeaders } from './ClubLeaders';

// Rubriques de l’onglet, dans l’ordre d’affichage ; la première s’ouvre par défaut.
const sections = [{ id: 'dirigeants', title: 'Dirigeants' }] as const;
type Section = (typeof sections)[number]['id'];

/** Onglet « Infos du club » de Notre club, en sous-onglets (`?rubrique=`). */
export function ClubInfoTab() {
  const [search] = useSearchParams();
  const section: Section =
    sections.find((item) => item.id === search.get('rubrique'))?.id ?? sections[0].id;
  return (
    <>
      <nav className="club-page-tabs" aria-label="Infos du club">
        {sections.map((item) => (
          <Link
            key={item.id}
            to={`?onglet=infos&rubrique=${item.id}`}
            className={item.id === section ? 'active' : undefined}
            aria-current={item.id === section ? 'page' : undefined}
          >
            {item.title}
          </Link>
        ))}
      </nav>
      {section === 'dirigeants' && <ClubLeaders />}
    </>
  );
}
