import type { Option } from '../admin/ui';

/** Libellé du groupe des équipes dont le compte est référent, en tête des listes. */
export const REFERENT_GROUP = 'Mes équipes (référent)';
const OTHER_GROUP = 'Autres équipes';

interface Listed {
  id: string;
  name: string;
  referent_ids?: string[];
}

export function isReferentOf(team: Listed, accountId: string | undefined): boolean {
  return !!accountId && (team.referent_ids ?? []).includes(accountId);
}

/** Les équipes dont le compte est référent d’abord, chaque groupe gardant son ordre. Une liste
 * présentée par section ne passe pas par ici : son ordre reste celui des sections. */
export function referentFirst<T extends Listed>(teams: T[], accountId: string | undefined): T[] {
  return [
    ...teams.filter((team) => isReferentOf(team, accountId)),
    ...teams.filter((team) => !isReferentOf(team, accountId)),
  ];
}

/** Options d’un formulaire (`EntityForm`) : équipes de référence en tête, groupées et colorées. */
export function teamOptions(teams: Listed[], accountId: string | undefined): Option[] {
  const mine = teams.some((team) => isReferentOf(team, accountId));
  return referentFirst(teams, accountId).map((team) => {
    const referent = isReferentOf(team, accountId);
    return {
      value: team.id,
      label: team.name,
      ...(mine ? { group: referent ? REFERENT_GROUP : OTHER_GROUP } : {}),
      ...(referent ? { highlight: true } : {}),
    };
  });
}

/** Options d’une liste déroulante d’équipes : un groupe « Mes équipes (référent) » en tête,
 * d’une autre couleur, puis les autres ; sans équipe de référence, la liste reste simple. */
export function TeamOptions({
  teams,
  accountId,
}: {
  teams: Listed[];
  accountId: string | undefined;
}) {
  const mine = teams.filter((team) => isReferentOf(team, accountId));
  const others = teams.filter((team) => !isReferentOf(team, accountId));
  const options = (items: Listed[], referent: boolean) =>
    items.map((team) => (
      <option key={team.id} value={team.id} className={referent ? 'team-referent' : undefined}>
        {team.name}
      </option>
    ));
  if (!mine.length) return <>{options(others, false)}</>;
  return (
    <>
      <optgroup label={REFERENT_GROUP} className="team-referent-group">
        {options(mine, true)}
      </optgroup>
      {others.length > 0 && <optgroup label={OTHER_GROUP}>{options(others, false)}</optgroup>}
    </>
  );
}
