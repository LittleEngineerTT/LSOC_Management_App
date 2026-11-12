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
// toujours à la dernière version mineure précédente (`previous`) : en passant de 0.5.0 à 0.5.1,
// on conserve donc les nouveautés de 0.5.0 par rapport à 0.4.0. Ne reprenez que les
// nouveautés majeures et les correctifs visibles, reformulés simplement ; les détails restent
// dans le CHANGELOG.
export const release: Release = {
  version: '0.5.1',
  previous: '0.4.0',
  notes: [
    {
      kind: 'feature',
      title: 'Mon planning dans le Planning',
      text: 'L’application Mon planning devient un filtre du Planning : cochez « Mon planning » pour ne voir que les séances de vos équipes, vos favoris, les événements dont vous êtes référent ou coach et ceux où vous êtes inscrit.',
    },
    {
      kind: 'feature',
      title: 'Planning et gymnases réunis',
      text: 'L’application Planning regroupe, en deux onglets, le planning du club et celui des gymnases. Sans compte, on y voit les matchs FFVB, aussi gymnase par gymnase.',
      link: { to: '/app/planning?onglet=gymnases', label: 'Voir le planning des gymnases' },
    },
    {
      kind: 'feature',
      title: 'Plateaux FFVB',
      text: 'Les matchs d’un même plateau (même jour, même lieu) n’apparaissent plus qu’une fois, à l’heure du premier match. Un match dont la FFVB ne donne pas encore l’heure s’affiche sur sa journée.',
      link: { to: '/app/planning', label: 'Voir le planning' },
    },
    {
      kind: 'feature',
      title: 'Filtres du planning',
      text: 'Filtrez le planning par section, équipe et gymnase, y compris sans être connecté.',
      link: { to: '/app/planning', label: 'Voir le planning' },
    },
    {
      kind: 'feature',
      title: 'Favoris',
      text: 'On ne « suit » plus un événement : on l’ajoute à ses favoris, seul ou avec toute sa série.',
    },
    {
      kind: 'feature',
      title: 'Contact',
      text: 'Une nouvelle application pour écrire au club, avec ou sans compte : un e-mail ou un téléphone pour la réponse, la question et les équipes concernées.',
      link: { to: '/app/contact', label: 'Nous contacter' },
    },
    {
      kind: 'feature',
      title: 'Les équipes des entraîneurs',
      text: 'Dans Notre club, chaque entraîneur est présenté avec les équipes qu’il entraîne.',
      link: { to: '/app/notre-club?onglet=infos', label: 'Voir les dirigeants' },
    },
    {
      kind: 'feature',
      title: 'Vos équipes en tête',
      text: 'Dans les listes d’équipes, celles dont vous êtes référent apparaissent en premier, d’une autre couleur.',
    },
    {
      kind: 'feature',
      title: 'Demandes de séances récurrentes',
      text: 'Les coachs sont prévenus des dates en conflit d’une série avant de l’envoyer, et peuvent l’envoyer quand même.',
    },
    {
      kind: 'feature',
      title: 'Notifications instantanées',
      text: 'Les pastilles de notifications et de messages se mettent à jour aussitôt, sans recharger la page.',
    },
    {
      kind: 'feature',
      title: 'Planning dans votre agenda',
      text: '« Exporter » copie les événements de vos filtres, jusqu’au 31 août, dans un fichier à ouvrir sur votre téléphone ou à importer dans votre agenda. La copie n’est pas tenue à jour : exportez de nouveau après un changement.',
      link: { to: '/app/planning', label: 'Exporter le planning' },
    },
    {
      kind: 'feature',
      title: 'Événements à l’extérieur',
      text: 'Le filtre Gymnase du planning propose « À l’extérieur » : seuls les événements hors des gymnases du club s’affichent.',
      link: { to: '/app/planning?gymnase=exterieur', label: 'Voir les événements à l’extérieur' },
    },
    {
      kind: 'feature',
      title: 'Événements en conflit',
      text: 'Un événement dont le gymnase devient indisponible passe en « Conflit » au lieu d’être annulé : il reste prévu jusqu’à une annulation réelle, et le conflit se lève seul si le gymnase se libère.',
    },
    {
      kind: 'feature',
      title: 'Notification à revoir',
      text: 'Une notification déjà lue se remet en non lue avec « Marquer comme non lu », sous « Tout afficher ».',
    },
    {
      kind: 'fix',
      title: 'Les matchs FFVB des poules en plateau ou sans horaire sont de nouveau récupérés.',
    },
    {
      kind: 'fix',
      title:
        'Un changement de coach ne déclenche plus de notifications sur les événements de l’équipe.',
    },
  ],
};
