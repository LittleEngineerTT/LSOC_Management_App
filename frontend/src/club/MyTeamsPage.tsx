import { Link } from 'react-router-dom';
import { Badge, Empty, LoadState, PanelHeading, playerDetails } from '../admin/ui';
import { dayLabel, horizonLabel, parisDay, eventHours } from './calendar';
import { PersonNames, useClub } from './context';
import { DetailHost } from './EventDetail';
import { concernsTeam, useEventLink } from './events';
import { useMyEvents } from './myEvents';
import { isReferentOf } from './teamOrder';

const roles = { player: 'Joueur', coach: 'Coach' } as const;

export function MyTeamsPage() {
  const { account, assignments, teams, sections, positions, admin } = useClub();
  const { result, events } = useMyEvents();
  const link = useEventLink();
  const linked = assignments.flatMap((assignment) => {
    const team = teams.find((item) => item.id === assignment.team_id);
    return team ? [{ assignment, team }] : [];
  });
  // Les équipes dont je suis référent d’abord, mises en avant.
  const mine = [
    ...linked.filter(({ team }) => isReferentOf(team, account.id)),
    ...linked.filter(({ team }) => !isReferentOf(team, account.id)),
  ];
  return (
    <>
      <PanelHeading
        title="Mes équipes"
        description="Vos équipes, votre rôle dans chacune et les prochains rendez-vous de chaque équipe."
      />
      {!mine.length && (
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
        {mine.map(({ assignment, team }) => {
          const upcoming = events
            .map((item) => item.event)
            .filter((event) => concernsTeam(event, team))
            .slice(0, 5);
          return (
            <section
              className={`admin-card club-section ${isReferentOf(team, account.id) ? 'team-referent-card' : 'team-other-card'}`}
              key={assignment.id}
            >
              <h3>
                {team.name}
                {isReferentOf(team, account.id) && (
                  <>
                    {' '}
                    <Badge tone="referent">Référent</Badge>
                  </>
                )}
              </h3>
              <p>
                <Badge>{roles[assignment.kind]}</Badge>{' '}
                <span className="admin-hint">
                  {sections.find((item) => item.id === team.section_id)?.name}
                </span>{' '}
                {playerDetails(assignment, positions)}
              </p>
              <p className="admin-hint">
                Référents de l’équipe : <PersonNames ids={team.referent_ids} empty="à désigner" />
              </p>
              <h4>Prochains événements</h4>
              {upcoming.length ? (
                <ul className="club-plain-list">
                  {upcoming.map((event) => (
                    <li key={event.id}>
                      <Link to={link(event.id)}>{event.title}</Link> ·{' '}
                      {dayLabel(parisDay(event.starts_at))}, {eventHours(event)}
                    </li>
                  ))}
                </ul>
              ) : (
                result.loaded && (
                  <p className="club-day-empty">Rien de prévu d’ici au {horizonLabel()}.</p>
                )
              )}
              <Link
                className="admin-button"
                to={`/app/planning?equipe=${encodeURIComponent(team.id)}`}
              >
                Planning de l’équipe
              </Link>
            </section>
          );
        })}
      </div>
      <DetailHost onChanged={result.reload} />
    </>
  );
}
