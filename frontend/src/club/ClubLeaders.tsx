import { useCallback } from 'react';
import { useLoad } from '../admin/data';
import { Empty, LoadState } from '../admin/ui';
import { Icon } from '../auth/components';
import { useClub } from './context';

const functionNames = {
  president: 'Président(e)',
  vice_president: 'Vice-président(e)',
  coach: 'Entraineur(e)',
};

/** Personne du bureau ou de l’encadrement, telle que l’API publique la présente. */
export interface StaffMember {
  first_name: string;
  /** Toutes ses fonctions, bureau d’abord. */
  functions: (keyof typeof functionNames)[];
  /** Photo facultative ; à défaut, un emplacement vide. */
  photo?: string | null;
}

/** Sous-onglet « Dirigeants » des infos du club : le bureau et les entraîneurs, en trombinoscope. */
export function ClubLeaders() {
  const { api } = useClub();
  const loader = useCallback(
    (signal: AbortSignal) => api.list<StaffMember>('/public/staff', false, signal),
    [api],
  );
  const result = useLoad(loader);
  const people = result.data ?? [];
  return (
    <section className="admin-card club-staff" aria-labelledby="club-staff-title">
      <h3 id="club-staff-title">Le bureau et les entraîneurs</h3>
      <LoadState result={result} />
      {result.loaded && !people.length && (
        <Empty>Aucune personne à présenter pour le moment.</Empty>
      )}
      <ul className="club-staff-list">
        {people.map((person, index) => (
          <li key={`${person.first_name}-${index}`}>
            <figure>
              {person.photo ? (
                <img className="club-staff-photo" src={person.photo} alt={person.first_name} />
              ) : (
                <div
                  className="club-staff-photo empty"
                  role="img"
                  aria-label={`Pas encore de photo de ${person.first_name}`}
                >
                  <Icon name="camera" />
                </div>
              )}
              <figcaption>
                <strong>{person.first_name}</strong>
                {person.functions.map((name) => (
                  <span key={name}>{functionNames[name]}</span>
                ))}
              </figcaption>
            </figure>
          </li>
        ))}
      </ul>
    </section>
  );
}
