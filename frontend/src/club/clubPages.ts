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
// Chaque section et chaque équipe créée dans l’administration a déjà une page « En cours de
// rédaction », affichée après celles-ci : en écrire une ici la remplace (même nom ou identifiant).
// Une page de section mène à ses équipes (« Voir les équipes ») ; une page d’équipe à sa section.
export const clubPages: ClubPage[] = [
  {
    type: 'section',
    target: 'Séniors féminins',
    image: '/notre-club/sf1_team_photo.jpeg',
    sections: [
      {
        title: 'La section',
        content:
          'La section Séniors féminins rassemble les joueuses qui pratiquent le volley en compétition, au sein des équipes du club engagées en championnat. Chacune y trouve sa place, quel que soit son parcours, et progresse au contact du collectif.\n\nEsprit d’équipe, engagement et plaisir du jeu sont au cœur de la section : découvrez nos équipes ci-dessous.',
      },
      {
        title: 'Nous rejoindre',
        content:
          'Vous souhaitez rejoindre l’une de nos équipes ? Contactez le club pour convenir d’une séance d’essai.',
      },
    ],
  },
  {
    type: 'section',
    target: 'Séniors masculins',
    image: '/notre-club/sm1_team_photo.jpeg',
    sections: [
      {
        title: 'La section',
        content:
          'La section Séniors masculins rassemble les joueurs adultes qui pratiquent le volley en compétition, au sein des équipes du club engagées en championnat. Chacun y trouve sa place, quel que soit son parcours, et progresse au contact du collectif.\n\nEsprit d’équipe, engagement et plaisir du jeu sont au cœur de la section : découvrez nos équipes ci-dessous.',
      },
      {
        title: 'Nous rejoindre',
        content:
          'Vous souhaitez rejoindre l’une de nos équipes ? Contactez le club pour convenir d’une séance d’essai.',
      },
    ],
  },
  {
    type: 'section',
    target: 'Jeunes féminins',
    image: '/notre-club/m18f1_team_photo.jpeg',
    sections: [
      {
        title: 'La section',
        content:
          'La section Jeunes féminins accueille les jeunes joueuses du club, qui apprennent et progressent ensemble au sein d’équipes engagées en championnat. Dans un cadre convivial et encadré, chacune développe sa technique et prend confiance, séance après séance.\n\nEsprit d’équipe, envie d’apprendre et plaisir du jeu sont au cœur de la section : découvrez nos équipes ci-dessous.',
      },
      {
        title: 'Nous rejoindre',
        content:
          'Vous souhaitez rejoindre l’une de nos équipes ? Contactez le club pour convenir d’une séance d’essai.',
      },
    ],
  },
  {
    type: 'section',
    target: 'Jeunes masculins',
    image: '/notre-club/placeholder.svg',
    sections: [
      {
        title: 'La section',
        content:
          'La section Jeunes masculins accueille les jeunes joueurs du club, qui apprennent et progressent ensemble au sein d’équipes engagées en championnat. Dans un cadre convivial et encadré, chacun développe sa technique et prend confiance, séance après séance.\n\nEsprit d’équipe, envie d’apprendre et plaisir du jeu sont au cœur de la section : découvrez nos équipes ci-dessous.',
      },
      {
        title: 'Nous rejoindre',
        content:
          'Vous souhaitez rejoindre l’une de nos équipes ? Contactez le club pour convenir d’une séance d’essai.',
      },
    ],
  },
  {
    type: 'section',
    target: 'Loisirs',
    image: '/notre-club/placeholder.svg',
    sections: [
      {
        title: 'La section',
        content:
          'La section Loisirs réunit les adultes qui aiment le volley pour le plaisir du jeu, quel que soit leur niveau. On y vient pour se dépenser, progresser à son rythme et partager un moment convivial.\n\nSelon ses envies, chacun peut jouer en loisir ou rejoindre l’une de nos équipes engagées en championnat : découvrez-les ci-dessous.',
      },
      {
        title: 'Nous rejoindre',
        content:
          'Vous souhaitez rejoindre l’une de nos équipes ? Contactez le club pour convenir d’une séance d’essai.',
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
          'Lundi : 20 h 30 – 22 h 30\nJeudi : 21 h 00 – 22 h 30\nSamedi : 12 h 00 – 14 h 00\n\nAu gymnase Ambroise Paré, Colombes.',
      },
    ],
  },
  {
    type: 'team',
    target: 'SM1',
    section: 'Séniors masculins',
    image: '/notre-club/sm1_team_photo.jpeg',
    sections: [
      {
        title: 'Notre équipe',
        content:
          'SM1 est l’équipe fanion de la section Séniors masculins. Elle dispute le championnat régional avec l’ambition de jouer les premières places, portée par un groupe soudé où joueurs expérimentés et jeunes du club progressent ensemble.\n\nLes matchs se jouent le week-end, à domicile comme à l’extérieur : venez nombreux encourager l’équipe !',
      },
      {
        title: 'Entraînements',
        content:
          'Mercredi : 19 h 30 – 22 h 30\nVendredi : 20 h 30 – 22 h 30\n\nAu gymnase Henri Dunant, Colombes.',
      },
    ],
  },
  {
    type: 'team',
    target: 'SF1',
    section: 'Séniors féminins',
    image: '/notre-club/sf1_team_photo.jpeg',
    sections: [
      {
        title: 'Notre équipe',
        content:
          "Depuis deux saisons, notre équipe senior féminine évolue au niveau régional avec détermination et passion. Fortes d'un collectif soudé et d'une progression constante, nos joueuses s'entraînent intensément pour se perfectionner et relever de nouveaux défis.\n\nAvec l'ambition affichée de monter en division supérieure, l'équipe ne cesse de viser plus haut. Sous la direction d'un staff expérimenté, elles travaillent leur technique, leur cohésion, et leur esprit de compétition pour atteindre cet objectif.\n\nChaque match est une nouvelle occasion de prouver leur potentiel, et avec le soutien de nos supporters.",
      },
      {
        title: 'Entraînements',
        content:
          'Mercredi : 20 h 30 – 22 h 30\nVendredi : 20 h 30 – 22 h 30\n\nAu gymnase AMBROISE PARE  => 140 Rue Saint-Denis, 92700 Colombes',
      },
    ],
  },
  {
    type: 'team',
    target: 'M18 F1',
    section: 'Jeunes féminins',
    image: '/notre-club/m18f1_team_photo.jpeg',
    sections: [
      {
        title: 'Notre équipe',
        content:
          'L’équipe M18 filles se distingue par un excellent esprit de groupe et une ambiance positive, aussi bien à l’entraînement qu’en compétition. Soudées et motivées, les joueuses évoluent ensemble dans un cadre convivial, propice à la progression et au plaisir de jouer.\n\nGrâce à un collectif uni et impliqué, l’équipe travaille régulièrement pour développer ses qualités techniques et renforcer la cohésion. Chaque séance et chaque match sont l’occasion d’apprendre, de progresser et de gagner en confiance.\n\nPortée par cette dynamique et l’engagement de chacune, l’équipe avance avec sérieux et enthousiasme, soutenue par l’encadrement du club et l’énergie de ses supporters.',
      },
      {
        title: 'Entraînements',
        content:
          'Mardi : 19 h 30 – 21 h 15\nVendredi : 19 h – 20 h 45\n\nAu gymnase Lakanal => 17 Rue Lakanal, 92700 Colombes',
      },
    ],
  },
  {
    type: 'team',
    target: 'SM2',
    section: 'Séniors masculins',
    image: '/notre-club/sm2_team_photo.jpeg',
    sections: [
      {
        title: 'Notre équipe',
        content:
          'Toute nouvelle au sein du club, l’équipe 2 masculine débute son aventure avec motivation et envie de progresser. Composée de joueurs engagés, elle se construit progressivement autour de valeurs essentielles : esprit d’équipe, apprentissage et plaisir du jeu.\n\nCette équipe a pour objectif de prendre de l’expérience, de développer un collectif solide et de poser des bases durables pour les saisons à venir. Les entraînements sont l’occasion de travailler la technique, la cohésion et la confiance, match après match.\n\nChaque rencontre permet à l’équipe de grandir et d’affirmer son identité, soutenue par l’encadrement du club et l’enthousiasme de ses supporters.',
      },
      {
        title: 'Entraînements',
        content:
          'Mercredi : 20 h – 22 h 30\nVendredi : 20 h – 22 h 30\n\nAu gymnase AMBROISE PARE => 140 Rue Saint-Denis, 92700 Colombes',
      },
    ],
  },
  {
    type: 'team',
    target: 'SF2',
    section: 'Séniors féminins',
    image: '/notre-club/sf2_team_photo.jpeg',
    sections: [
      {
        title: 'Notre équipe',
        content:
          'Créée il y a maintenant deux ans, notre équipe départementale de jeunes filles se développe avec enthousiasme, sérieux et esprit collectif. Saison après saison, les joueuses progressent ensemble, portées par l’envie d’apprendre, de se dépasser et de prendre du plaisir sur le terrain.\n\nGrâce à un groupe motivé et soudé, les entraînements sont menés avec engagement afin de renforcer la technique, la cohésion et la confiance de chacune. L’équipe avance pas à pas, en relevant chaque défi avec détermination.\n\nChaque rencontre est une nouvelle opportunité de montrer les progrès réalisés et de continuer à grandir, soutenues par l’encadrement et l’énergie de nos supporters.',
      },
      {
        title: 'Entraînements',
        content:
          'Lundi : 21 h – 22 h 30\nJeudi : 19 h 30 – 21 h 30\n\nAu gymnase AMBROISE PARE => 140 Rue Saint-Denis, 92700 Colombes',
      },
    ],
  },
];
