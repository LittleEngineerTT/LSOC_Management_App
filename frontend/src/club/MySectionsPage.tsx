import { Link } from 'react-router-dom';
import { Badge, Empty, LoadState, PanelHeading } from '../admin/ui';
import { dayLabel, horizonLabel, parisDay, timeRange } from './calendar';
import { PersonName, useClub, useMySections } from './context';
import { DetailHost } from './EventDetail';
import { useEventLink } from './events';
import { useMyEvents } from './MyPlanningPage';

const roles = { player: 'Joueur', coach: 'Coach' } as const;

export function MySectionsPage() {
  const { assignments, teams, admin } = useClub();
  const sections = useMySections();
  const { result, events } = useMyEvents();
  const link = useEventLink();
  return (
    <>
      <PanelHeading
        title="Mes sections"
        description="Vos équipes, votre rôle dans chacune et les prochains rendez-vous de vos sections."
      />
      {!sections.length && (
        <Empty>
          Vous n’êtes rattaché à aucune équipe.{' '}
          {admin ? (
            <Link to="/app/administration?tab=users">Gérer les rattachements</Link>
          ) : (
            'Un administrateur peut vous rattacher à vos équipes.'
          )}
        </Empty>
      )}
      <LoadState result={result} />
      <div className="club-sections">
        {sections.map((section) => {
          const mine = assignments
            .map((assignment) => ({
              assignment,
              team: teams.find((team) => team.id === assignment.team_id),
            }))
            .filter((item) => item.team?.section_id === section.id);
          const upcoming = events
            .map((item) => item.event)
            .filter((event) => event.section_ids.includes(section.id))
            .slice(0, 5);
          return (
            <section className="admin-card club-section" key={section.id}>
              <h3>{section.name}</h3>
              <ul className="club-plain-list">
                {mine.map(({ assignment, team }) => (
                  <li key={assignment.id}>
                    <strong>{team?.name}</strong> <Badge>{roles[assignment.kind]}</Badge>
                    <span className="admin-hint">
                      {' '}
                      Référent de l’équipe :{' '}
                      {team?.referent_id ? <PersonName id={team.referent_id} /> : 'à désigner'}
                    </span>
                  </li>
                ))}
              </ul>
              <h4>Prochains événements</h4>
              {upcoming.length ? (
                <ul className="club-plain-list">
                  {upcoming.map((event) => (
                    <li key={event.id}>
                      <Link to={link(event.id)}>{event.title}</Link> ·{' '}
                      {dayLabel(parisDay(event.starts_at))},{' '}
                      {timeRange(event.starts_at, event.ends_at)}
                    </li>
                  ))}
                </ul>
              ) : (
                result.loaded && (
                  <p className="club-day-empty">Rien de prévu d’ici au {horizonLabel()}.</p>
                )
              )}
              <Link className="admin-button" to={`/app/planning?section=${section.id}`}>
                Planning de la section
              </Link>
            </section>
          );
        })}
      </div>
      <DetailHost onChanged={result.reload} />
    </>
  );
}
