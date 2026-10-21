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
  /** Équipe seulement : sa section, si l’équipe n’est pas encore dans le catalogue du club. */
  section?: string;
  sections: ClubPageSection[];
}

// Pages de l’application « Notre club », dans l’ordre d’affichage ; ajoutez-en autant que voulu.
// Une page de section mène à ses équipes (« Voir les équipes ») ; une page d’équipe à sa section.
export const clubPages: ClubPage[] = [
  {
    type: 'section',
    target: 'Loisirs',
    image: '/notre-club/placeholder.svg',
    sections: [
      {
        title: 'La section',
        content:
          'La section Loisirs réunit les adultes qui aiment le volley pour le plaisir du jeu, quel que soit leur niveau. On y vient pour se dépenser, progresser et partager un moment convivial en fin de journée.\n\nSelon ses envies, chacun peut jouer en loisir pur ou rejoindre une équipe engagée dans un championnat : découvrez nos équipes ci-dessous.',
      },
      {
        title: 'Nous rejoindre',
        content:
          'Les inscriptions sont ouvertes toute la saison, dans la limite des places. Deux séances d’essai sont possibles avant de prendre sa licence.',
      },
    ],
  },
  {
    type: 'team',
    target: 'Loisirs compétition',
    section: 'Loisirs',
    image: '/notre-club/placeholder.svg',
    sections: [
      {
        title: 'Notre équipe',
        content:
          'L’équipe Loisirs compétition accueille les joueuses et joueurs adultes qui veulent pratiquer le volley dans une ambiance conviviale, tout en disputant un vrai championnat départemental.\n\nDébutants motivés comme joueurs confirmés y trouvent leur place : les entraînements alternent travail technique, jeu en situation et matchs, pour progresser ensemble à son rythme.\n\nLes rencontres du championnat se jouent en semaine, en soirée, à domicile comme à l’extérieur.',
      },
      {
        title: 'Entraînements',
        content:
          'Lundi : 20 h 30 – 22 h 30\nJeudi : 21 h 00 – 22 h 30\n\nAu gymnase Ambroise Paré, Colombes.',
      },
    ],
  },
];
