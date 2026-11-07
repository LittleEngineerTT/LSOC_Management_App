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

// Tenir cette liste à jour à chaque changement visible pour l’utilisateur. Elle se compare
// toujours à la dernière version mineure précédente (`previous`) : en passant de 0.4.0 à 0.4.2,
// on conserve donc les nouveautés de 0.4.0 et 0.4.1 par rapport à 0.2.0. Ne reprenez que les
// nouveautés majeures et les correctifs visibles, reformulés simplement ; les détails restent
// dans le CHANGELOG.
export const release: Release = {
  version: '0.4.2',
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
      kind: 'feature',
      title: 'Places réservées',
      text: 'Un événement peut réserver des places à certains postes d’une section ; un joueur peut choisir un autre poste que celui de son équipe, son coach en est prévenu.',
      link: { to: '/app/planning', label: 'Voir le planning' },
    },
    {
      kind: 'feature',
      title: 'Demandes d’inscription',
      text: 'Les coachs et administrateurs traitent les inscriptions depuis Messagerie › Demandes, ou directement sur l’événement.',
    },
    {
      kind: 'feature',
      title: 'Notifications instantanées',
      text: 'Les pastilles de notifications et de messages se mettent à jour aussitôt, sans recharger la page.',
    },
    {
      kind: 'feature',
      title: 'Filtres du planning',
      text: 'Filtrez le planning par section, équipe et gymnase, y compris sans être connecté.',
      link: { to: '/app/planning', label: 'Voir le planning' },
    },
    {
      kind: 'feature',
      title: 'Matchs sur tout le gymnase',
      text: 'Un match FFVB peut occuper tout le gymnase, quel que soit son nombre de terrains, et ne bloque plus les autres matchs.',
    },
    {
      kind: 'feature',
      title: 'Mes équipes',
      text: 'La page « Mes sections » devient « Mes équipes » : une carte par équipe, avec vos prochains rendez-vous et un accès direct au planning de l’équipe.',
      link: { to: '/app/equipes', label: 'Voir mes équipes' },
    },
    {
      kind: 'feature',
      title: 'Planning et gymnases réunis',
      text: 'L’application Planning regroupe, en deux onglets, le planning du club et celui des gymnases. Sans compte, on y voit les matchs FFVB, aussi gymnase par gymnase.',
      link: { to: '/app/planning?onglet=gymnases', label: 'Voir le planning des gymnases' },
    },
    {
      kind: 'feature',
      title: 'Conflits du planning',
      text: 'Les administrateurs retrouvent dans Administration > Conflits les événements à venir où la capacité d’un gymnase est dépassée, et ceux qui comportent une erreur : match à domicile sans gymnase, référent manquant, écart avec le calendrier FFVB, vérification FFVB désactivée ou suspendue, qu’on réactive sur place.',
    },
    {
      kind: 'feature',
      title: 'Annulation d’un événement',
      text: 'Le référent ou un administrateur peut annuler et rétablir un événement ; le motif (gymnase indisponible, capacité dépassée, décision du référent ou d’un administrateur) s’affiche en tête de sa fiche.',
    },
    {
      kind: 'feature',
      title: 'Notifications dans le bandeau',
      text: 'Les notifications quittent l’accueil : la cloche en haut de l’écran affiche leur nombre et présente les 20 dernières, non lues en tête ; les déjà lues apparaissent avec « Tout afficher ». Une notification ne passe en lue qu’avec « Marquer comme lu ».',
    },
    {
      kind: 'feature',
      title: 'Demandes signalées dans la Messagerie',
      text: 'Pour les coachs et administrateurs, une nouvelle demande ou une décision ajoute une pastille sur la Messagerie et sur son onglet Demandes, jusqu’à ce que sa notification soit marquée comme lue.',
    },
    {
      kind: 'fix',
      title: 'Correctif apporté sur la récupération des matchs FFVB de certaines équipes.',
    },
  ],
};
