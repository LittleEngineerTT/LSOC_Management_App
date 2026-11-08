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
      title: 'Planning et gymnases réunis',
      text: 'L’application Planning regroupe, en deux onglets, le planning du club et celui des gymnases. Sans compte, on y voit les matchs FFVB, aussi gymnase par gymnase.',
      link: { to: '/app/planning?onglet=gymnases', label: 'Voir le planning des gymnases' },
    },
    {
      kind: 'feature',
      title: 'Mon planning dans le Planning',
      text: 'L’application Mon planning devient un filtre du Planning : cochez « Mon planning » pour ne voir que les séances de vos équipes, vos favoris, les événements dont vous êtes référent ou coach et ceux où vous êtes inscrit.',
    },
    {
      kind: 'feature',
      title: 'Favoris',
      text: 'On ne « suit » plus un événement : on l’ajoute à ses favoris, seul ou avec toute sa série.',
    },
    {
      kind: 'feature',
      title: 'Vos équipes en tête',
      text: 'Dans les listes d’équipes, celles dont vous êtes référent apparaissent en premier, d’une autre couleur.',
    },
    {
      kind: 'feature',
      title: 'Contact',
      text: 'Une nouvelle application pour écrire au club, avec ou sans compte : un e-mail ou un téléphone pour la réponse, la question et les équipes concernées. Les administrateurs y suivent les demandes, les prennent en charge et les marquent comme résolues.',
      link: { to: '/app/contact', label: 'Nous contacter' },
    },
    {
      kind: 'fix',
      title: 'Correctif apporté sur la récupération des matchs FFVB de certaines équipes.',
    },
  ],
};
