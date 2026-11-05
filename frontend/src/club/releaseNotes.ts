/** Changement d’une version visible pour l’utilisateur, dit en une phrase et sans jargon. */
export interface ReleaseNote {
  kind: 'feature' | 'fix';
  title: string;
  text?: string;
  /** Page où découvrir la nouveauté, accessible aussi aux invités. */
  link?: { to: string; label: string };
}

/** Note de version de l’accueil : les changements majeurs depuis la version précédente. */
export interface Release {
  version: string;
  previous: string;
  notes: ReleaseNote[];
}

// À chaque version, ne reprenez du CHANGELOG que les nouveautés majeures et les correctifs
// visibles, reformulés simplement ; les détails restent dans le CHANGELOG.
export const release: Release = {
  version: '0.3.0',
  previous: '0.2.0',
  notes: [
    {
      kind: 'feature',
      title: 'Résultats des équipes',
      text: 'Le classement, les prochains matchs et les résultats de chaque équipe, dans Notre club.',
      link: { to: '/app/notre-club?onglet=resultats', label: 'Voir les résultats' },
    },
    {
      kind: 'feature',
      title: 'Photos des entraîneurs',
      text: 'Les entraîneurs peuvent ajouter leur photo, présentée avec les dirigeants du club.',
      link: { to: '/app/notre-club?onglet=infos', label: 'Voir les dirigeants' },
    },
    {
      kind: 'fix',
      title: 'Correctif apporté sur la récupération des matchs FFVB de certaines équipes.',
    },
  ],
};
