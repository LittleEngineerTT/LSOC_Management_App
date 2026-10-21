import { Link, useSearchParams } from 'react-router-dom';
import { Badge, Empty, PanelHeading } from '../admin/ui';
import { clubPages, type ClubPage } from './clubPages';
import { useClub } from './context';

// Comparaison des noms de la configuration et du catalogue : sans accents ni casse.
const normalize = (value: string) =>
  value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
export const pageSlug = (page: ClubPage) =>
  `${page.type}-${normalize(page.target).replace(/[^a-z0-9]+/g, '-')}`;

/** Équipe ou section présentée par une page : nom du catalogue, ou nom configuré à défaut. */
function useTarget(page: ClubPage) {
  const { sections, teams } = useClub();
  const wanted = normalize(page.target);
  const matches = (item: { id: string; name: string }) =>
    item.id === page.target || normalize(item.name) === wanted;
  if (page.type === 'team') {
    const team = teams.find(matches);
    const section = sections.find((item) => item.id === team?.section_id);
    return { name: team?.name ?? page.target, section: section?.name };
  }
  return { name: sections.find(matches)?.name ?? page.target, section: undefined };
}

function PageLink({ page, active }: { page: ClubPage; active: boolean }) {
  const target = useTarget(page);
  return (
    <Link
      to={`?page=${pageSlug(page)}`}
      className={active ? 'active' : ''}
      aria-current={active ? 'page' : undefined}
    >
      <strong>{target.name}</strong>
      <span>
        {page.type === 'team' ? `Équipe${target.section ? ` · ${target.section}` : ''}` : 'Section'}
      </span>
    </Link>
  );
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

function ClubPageView({ page }: { page: ClubPage }) {
  const target = useTarget(page);
  return (
    <article className="admin-card club-page" aria-labelledby="club-page-title">
      {page.image && (
        <img className="club-page-image" src={page.image} alt={`Photo : ${target.name}`} />
      )}
      <h3 id="club-page-title">
        {target.name} <Badge>{page.type === 'team' ? 'Équipe' : 'Section'}</Badge>
        {target.section && <Badge>{target.section}</Badge>}
      </h3>
      {page.sections.map((section, index) => (
        <section key={index} className="club-page-section">
          <h4>{section.title}</h4>
          <Paragraphs content={section.content} />
        </section>
      ))}
    </article>
  );
}

/** Application « Notre club » : présentation des équipes et sections, configurée dans clubPages.ts. */
export function OurClubPage({ pages = clubPages }: { pages?: ClubPage[] }) {
  const [search] = useSearchParams();
  const selected = pages.find((page) => pageSlug(page) === search.get('page')) ?? pages[0];
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
          {pages.length > 1 && (
            <nav className="club-threads" aria-label="Sections et équipes">
              {pages.map((page) => (
                <PageLink key={pageSlug(page)} page={page} active={page === selected} />
              ))}
            </nav>
          )}
          <ClubPageView page={selected} />
        </div>
      )}
    </>
  );
}
