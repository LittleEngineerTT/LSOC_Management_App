import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { Section, Team } from '../admin/types';
import { Badge, Empty, PanelHeading } from '../admin/ui';
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

/** Pages et catalogue rapprochés : qui présente quoi, et quelles équipes a chaque section. */
function useClubPages(pages: ClubPage[]) {
  const { sections, teams } = useClub();
  const entries = pages.map((page) => ({ page, ...resolve(page, sections, teams) }));
  const sameSection = (left: Resolved['section'], right: Resolved['section']) =>
    !!left &&
    !!right &&
    (left.id && right.id ? left.id === right.id : normalize(left.name) === normalize(right.name));
  const sectionPage = (section: Resolved['section']) =>
    entries.find((entry) => entry.page.type === 'section' && sameSection(entry.section, section));
  /** Équipes d’une section : celles du catalogue et celles décrites dans la configuration. */
  const teamsOf = (section: NonNullable<Resolved['section']>) => {
    const listed = new Map<string, { name: string; page?: ClubPage }>();
    for (const team of teams.filter((item) => section.id && item.section_id === section.id))
      listed.set(normalize(team.name), { name: team.name });
    for (const entry of entries)
      if (entry.page.type === 'team' && sameSection(entry.section, section))
        listed.set(normalize(entry.name), { name: entry.name, page: entry.page });
    return [...listed.values()].sort((left, right) => left.name.localeCompare(right.name, 'fr'));
  };
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

/** Application « Notre club » : présentation des sections et équipes, configurée dans clubPages.ts. */
export function OurClubPage({ pages = clubPages }: { pages?: ClubPage[] }) {
  const [search] = useSearchParams();
  const [showTeams, setShowTeams] = useState(false);
  const { entries, sectionPage, teamsOf } = useClubPages(pages);
  const selected =
    entries.find((entry) => pageSlug(entry.page) === search.get('page')) ?? entries[0];
  // Le menu présente les sections ; une équipe y figure seulement si sa section n’a pas de page.
  const menu = entries.filter(
    (entry) => entry.page.type === 'section' || !sectionPage(entry.section),
  );
  const parent = selected?.page.type === 'team' ? sectionPage(selected.section) : undefined;
  const teams =
    selected?.page.type === 'section' && selected.section ? teamsOf(selected.section) : [];
  return (
    <>
      <PanelHeading
        title="Notre club"
        description="Nos sections et nos équipes, présentées par le club."
      />
      {!selected ? (
        <Empty>Aucune présentation pour le moment.</Empty>
      ) : (
        <div className="club-pages">
          {menu.length > 1 && (
            <nav className="club-threads" aria-label="Sections et équipes">
              {menu.map((entry) => (
                <Link
                  key={pageSlug(entry.page)}
                  to={`?page=${pageSlug(entry.page)}`}
                  className={entry === selected || entry === parent ? 'active' : ''}
                  aria-current={entry === selected ? 'page' : undefined}
                  onClick={() => setShowTeams(false)}
                >
                  <strong>{entry.name}</strong>
                  <span>{entry.page.type === 'team' ? 'Équipe' : 'Section'}</span>
                </Link>
              ))}
            </nav>
          )}
          <article className="admin-card club-page" aria-labelledby="club-page-title">
            {parent && (
              <Link
                className="club-page-back"
                to={`?page=${pageSlug(parent.page)}`}
                onClick={() => setShowTeams(true)}
              >
                ← Section {parent.name}
              </Link>
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
              <div className="club-page-teams">
                <button
                  type="button"
                  className="admin-button primary"
                  aria-expanded={showTeams}
                  aria-controls="club-page-team-list"
                  onClick={() => setShowTeams(!showTeams)}
                >
                  {showTeams ? 'Masquer les équipes' : 'Voir les équipes'}
                </button>
                {showTeams && (
                  <ul
                    id="club-page-team-list"
                    className="club-plain-list"
                    aria-label="Équipes de la section"
                  >
                    {teams.map((team) => (
                      <li key={team.name}>
                        {team.page ? (
                          <Link to={`?page=${pageSlug(team.page)}`}>{team.name}</Link>
                        ) : (
                          <>
                            {team.name} <span className="admin-hint">· présentation à venir</span>
                          </>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </article>
        </div>
      )}
    </>
  );
}
