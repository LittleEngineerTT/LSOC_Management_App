/** Bloc d’une page « Notre club » : un titre et son contenu.
 *
 * Dans `content`, une ligne vide sépare deux paragraphes ; un simple retour à la ligne est gardé.
 */
export interface ClubPageSection {
  title: string;
  content: string;
}

/** Page de présentation d’une équipe ou d’une section, dans l’application « Notre club ». */
export interface ClubPage {
  type: 'team' | 'section';
  /** Nom (ou identifiant) de l’équipe ou de la section présentée. */
  target: string;
  /** Image facultative, servie depuis `frontend/public` : « /notre-club/mon-image.jpg ». */
  image?: string;
  sections: ClubPageSection[];
}

// Pages de l’application « Notre club », dans l’ordre d’affichage ; ajoutez-en autant que voulu.
export const clubPages: ClubPage[] = [
  {
    type: 'section',
    target: 'Loisirs compétition',
    image: '/notre-club/placeholder.svg',
    sections: [
      {
        title: 'Notre section',
        content:
          'La section Loisirs compétition accueille les joueuses et joueurs adultes qui veulent pratiquer le volley dans une ambiance conviviale, tout en disputant un vrai championnat départemental.\n\nDébutants motivés comme joueurs confirmés y trouvent leur place : les entraînements alternent travail technique, jeu en situation et matchs, pour progresser ensemble à son rythme.\n\nLes rencontres du championnat se jouent en semaine, en soirée, à domicile comme à l’extérieur.',
      },
      {
        title: 'Entraînements',
        content:
          'Lundi : 20 h 30 – 22 h 30\nJeudi : 21 h 00 – 22 h 30\n\nAu gymnase Ambroise Paré, Colombes.',
      },
    ],
  },
];
