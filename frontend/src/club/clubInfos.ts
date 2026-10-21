import testImage from './assets/encart-test.svg';

/** Information générique de l’accueil : un titre, un contenu et, au besoin, une image. */
export interface ClubInfo {
  id: string;
  title: string;
  content: string;
  image?: { src: string; alt: string };
}

// Informations affichées dans l’encart de l’accueil, adhérents comme invités ; ajoutez-en ici.
export const clubInfos: ClubInfo[] = [
  {
    id: 'test',
    title: 'Encart de test',
    content:
      'Ceci est un encart de test pour les informations du club. Il accepte un texte, une image et un bouton « Voir plus » lorsque le texte est trop long pour l’encart. Remplacez-le par les informations du moment : reprise des entraînements, assemblée générale, tournoi, stage ou recherche de bénévoles. Le texte complet reste lisible en dépliant l’encart, et le défilement s’arrête pendant la lecture.',
    image: { src: testImage, alt: 'Image de test : terrain de volley et ballon' },
  },
];
