import { Link, useSearchParams } from 'react-router-dom';
import type { Section, Team } from '../admin/types';
import { Badge, Empty, PanelHeading } from '../admin/ui';
import { Icon } from '../auth/components';
import { clubPages, type ClubPage } from './clubPages';
import { useClub } from './context';

// Comparaison des noms de la configuration et du catalogue : sans accents, sans casse, et
// sans s final, pour que « Loisirs » retrouve la section « Loisir ».
const normalize = (value: string) =>
  value
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map((word) => word.replace(/s$/, ''))
    .join(' ');
export const pageSlug = (page: ClubPage) =>
  `${page.type}-${normalize(page.target).replace(/ /g, '-')}`;
const same = (item: { id: string; name: string }, target: string) =>
  item.id === target || normalize(item.name) === normalize(target);

interface Resolved {
  name: string;
  /** Section de la page : la section elle-même, ou celle de l’équipe. */
  section: { id?: string; name: string } | null;
}

function resolve(page: ClubPage, sections: Section[], teams: Team[]): Resolved {
  if (page.type === 'section') {
    const section = sections.find((item) => same(item, page.target));
    const name = section?.name ?? page.target;
    return { name, section: { id: section?.id, name } };
  }
  const team = teams.find((item) => same(item, page.target));
  const section =
    sections.find((item) => item.id === team?.section_id) ??
    (page.section ? sections.find((item) => same(item, page.section!)) : undefined);
  return {
    name: team?.name ?? page.target,
    section: section ? section : page.section ? { name: page.section } : null,
  };
}

/** Texte d’une présentation pas encore écrite dans clubPages.ts. */
export const DRAFT = 'En cours de rédaction.';

/** Bloc « Nous rejoindre » d’une page de section pas encore écrite dans clubPages.ts. */
export const JOIN = {
  title: 'Nous rejoindre',
  content:
    'Vous souhaitez rejoindre l’une de nos équipes ? Contactez le club pour convenir d’une séance d’essai.',
};

/** Pages de clubPages.ts, complétées d’une page « en cours de rédaction » pour chaque section
 * et chaque équipe du club qui n’en a pas encore : une nouvelle section ou équipe créée dans
 * l’administration apparaît ainsi d’elle-même.
 */
function withCatalog(pages: ClubPage[], sections: Section[], teams: Team[]): ClubPage[] {
  const described = (type: ClubPage['type'], item: { id: string; name: string }) =>
    pages.some((page) => page.type === type && same(item, page.target));
  return [
    ...pages,
    ...sections
      .filter((section) => !described('section', section))
      .map((section): ClubPage => ({
        type: 'section',
        target: section.name,
        sections: [{ title: 'La section', content: DRAFT }, JOIN],
      })),
    ...teams
      .filter((team) => !described('team', team))
      .map((team): ClubPage => ({
        type: 'team',
        target: team.name,
        sections: [{ title: 'Notre équipe', content: DRAFT }],
      })),
  ];
}

/** Pages et catalogue rapprochés : qui présente quoi, et quelles équipes a chaque section. */
function useClubPages(configured: ClubPage[]) {
  const { sections, teams } = useClub();
  const pages = withCatalog(configured, sections, teams);
  const entries = pages.map((page) => ({ page, ...resolve(page, sections, teams) }));
  const sameSection = (left: Resolved['section'], right: Resolved['section']) =>
    !!left &&
    !!right &&
    (left.id && right.id ? left.id === right.id : normalize(left.name) === normalize(right.name));
  const sectionPage = (section: Resolved['section']) =>
    entries.find((entry) => entry.page.type === 'section' && sameSection(entry.section, section));
  /** Équipes d’une section : chacune a sa page, écrite ou en cours de rédaction. */
  const teamsOf = (section: NonNullable<Resolved['section']>) =>
    entries
      .filter((entry) => entry.page.type === 'team' && sameSection(entry.section, section))
      .sort((left, right) => left.name.localeCompare(right.name, 'fr'));
  return { entries, sectionPage, teamsOf };
}

/** Contenu : une ligne vide sépare les paragraphes, un retour à la ligne simple est conservé. */
function Paragraphs({ content }: { content: string }) {
  return (
    <>
      {content
        .split(/\n\s*\n/)
        .map((paragraph) => paragraph.trim())
        .filter(Boolean)
        .map((paragraph, index) => (
          <p key={index}>
            {paragraph.split('\n').map((line, row) => (
              <span key={row}>
                {row > 0 && <br />}
                {line}
              </span>
            ))}
          </p>
        ))}
    </>
  );
}

/** Application « Notre club » : présentation des sections et équipes du club, écrite dans
 * clubPages.ts ou, à défaut, « en cours de rédaction ».
 *
 * Les sections sont des onglets en haut ; leurs équipes s’affichent en cartes sous la
 * présentation, et une page d’équipe garde sa section active avec un fil d’Ariane.
 */
export function OurClubPage({ pages = clubPages }: { pages?: ClubPage[] }) {
  const [search] = useSearchParams();
  const { entries, sectionPage, teamsOf } = useClubPages(pages);
  const selected =
    entries.find((entry) => pageSlug(entry.page) === search.get('page')) ?? entries[0];
  // Onglets : les sections, et une équipe seulement si sa section n’a pas de page.
  const tabs = entries.filter(
    (entry) => entry.page.type === 'section' || !sectionPage(entry.section),
  );
  const parent = selected?.page.type === 'team' ? sectionPage(selected.section) : undefined;
  const home = parent ?? selected;
  const teams = home?.page.type === 'section' && home.section ? teamsOf(home.section) : [];
  return (
    <>
      <PanelHeading
        title="Notre club"
        description="Nos sections et nos équipes, présentées par le club."
      />
      {!selected || !home ? (
        <Empty>Aucune présentation pour le moment.</Empty>
      ) : (
        <>
          {tabs.length > 1 && (
            <nav className="club-page-tabs" aria-label="Sections du club">
              {tabs.map((entry) => (
                <Link
                  key={pageSlug(entry.page)}
                  to={`?page=${pageSlug(entry.page)}`}
                  className={entry === home ? 'active' : undefined}
                  aria-current={entry === home ? 'page' : undefined}
                >
                  {entry.name}
                </Link>
              ))}
            </nav>
          )}
          <article className="admin-card club-page" aria-labelledby="club-page-title">
            {parent && (
              <>
                <nav className="club-page-breadcrumb" aria-label="Fil d’Ariane">
                  <Link to={`?page=${pageSlug(parent.page)}`}>{parent.name}</Link>
                  <span aria-hidden="true"> › </span>
                  <span aria-current="page">{selected.name}</span>
                </nav>
                {teams.length > 1 && (
                  <nav className="club-page-team-switch" aria-label={`Équipes ${parent.name}`}>
                    {teams.map((team) => (
                      <Link
                        key={pageSlug(team.page)}
                        to={`?page=${pageSlug(team.page)}`}
                        className={team.page === selected.page ? 'active' : undefined}
                        aria-current={team.page === selected.page ? 'page' : undefined}
                      >
                        {team.name}
                      </Link>
                    ))}
                  </nav>
                )}
              </>
            )}
            {selected.page.image && (
              <img
                className="club-page-image"
                src={selected.page.image}
                alt={`Photo : ${selected.name}`}
              />
            )}
            <h3 id="club-page-title">
              {selected.name} <Badge>{selected.page.type === 'team' ? 'Équipe' : 'Section'}</Badge>
              {selected.page.type === 'team' && selected.section && (
                <Badge>{selected.section.name}</Badge>
              )}
            </h3>
            {selected.page.sections.map((section, index) => (
              <section key={index} className="club-page-section">
                <h4>{section.title}</h4>
                <Paragraphs content={section.content} />
              </section>
            ))}
            {selected.page.type === 'section' && teams.length > 0 && (
              <section className="club-page-teams" aria-labelledby="club-page-teams-title">
                <h4 id="club-page-teams-title">Nos équipes</h4>
                <ul className="club-team-cards">
                  {teams.map((team) => (
                    <li key={pageSlug(team.page)}>
                      <Link className="club-team-card" to={`?page=${pageSlug(team.page)}`}>
                        <strong>{team.name}</strong>
                        <span className="club-team-card-action">
                          <span>Présentation de l’équipe</span>
                          <Icon name="arrow" />
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </article>
        </>
      )}
    </>
  );
}
