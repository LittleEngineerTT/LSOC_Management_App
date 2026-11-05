# Changelog

Les changements notables de l’application LSOC sont consignés ici. Le format suit
[Keep a Changelog](https://keepachangelog.com/fr/1.1.0/) et la numérotation
[Semantic Versioning](https://semver.org/lang/fr/).

## [Non publié]

### Ajouté

- **Notre club, Résultats des équipes** : le classement FFVB de chaque équipe dotée d’une source,
  groupé par section, avec les points, les matchs joués, gagnés et perdus et la répartition des
  scores (3-0, 3-1, 3-2, 2-3, 1-3, 0-3). On passe d’une équipe à l’autre dans chaque section ;
  l’équipe du club est mise en avant. Le classement est relevé à chaque synchronisation de la
  source, une fois par jour et le soir des matchs. Sous le classement, les matchs de l’équipe :
  à venir avec la date, l’heure et le lieu, puis joués avec le score, le détail des sets et la
  victoire ou la défaite. Visible aussi des invités.
- **Photos des entraîneurs** : facultatives, ajoutées par le coach depuis son profil ou par un
  administrateur à la création d’un compte coach. Stockées sur le S3, elles sont présentées dans
  les dirigeants de Notre club, invités compris. Retirer le rôle coach ou supprimer le compte
  efface la photo.

### Modifié

- **Planning, Mes demandes d’événements** : seules les 5 dernières demandes sont affichées.
- **Accueil** : l’encart « Informations du club » devient « Quoi de neuf ? », qui présente
  simplement les nouveautés de la version, adhérents comme invités.

### Corrigé

- **FFVB, poules à nombre impair d’équipes** : la journée où l’équipe du club est exempte
  (adversaire « xxxxx », sans date) faisait rejeter toute la page ; plus aucun match de la
  source n’était importé. Elle est désormais ignorée.
- **FFVB, choix de l’équipe d’une source** : une équipe sans set perdu (coefficient « MAX »)
  n’est plus proposée sous le nom « MAX ».

## [0.2.0] - 2026-10-29

### Ajouté

- **Notre club en onglets** : « Infos du club », « Nos équipes » et « Inscriptions ». « Nos
  équipes » reprend la présentation des sections et des équipes ; les liens existants vers une
  section ou une équipe y mènent toujours.
- **Infos du club, Dirigeants** : trombinoscope du président ou de la présidente, du
  vice-président ou de la vice-présidente et des entraîneurs, avec le prénom et toutes les
  fonctions de chacun. Sans photo, un emplacement vide l’annonce. Visible aussi des invités, qui
  n’en voient que le prénom et les fonctions.
- **Inscriptions** : inscription en ligne sur myFFvolley, cotisations par catégorie et
  modalités de paiement.
- **Rôles Président(e) et Vice-président(e)** : titres sans droit particulier, tenus chacun par
  une seule personne. L’administration les accorde au sexe du compte.
- **E-mails** : un bouton ouvre l’application sur l’écran où l’e-mail se traite (événement,
  demande à examiner, message…), après connexion s’il le faut.

### Modifié

- **E-mails** : mise en page aux couleurs du club, en HTML avec une version texte. Tout e-mail
  lié à un événement en donne la fiche : date, horaire, lieu, type, équipes, référents.
- **E-mails de modification** : l’événement avant et après, les informations changées
  surlignées, avec l’auteur de la modification. Une modification de série donne le nombre
  d’occurrences concernées et le détail de la première.
- **E-mails groupés** : chaque notification y est détaillée, avec son propre lien, au lieu d’une
  liste de titres.
- **Demandes** : l’application Inscriptions s’appelle désormais Demandes.
- **Notre club** : SM1 s’entraîne le mercredi au gymnase Ambroise Paré et le vendredi à la salle
  polyvalente Henri Dunant.

## [0.1.2] - 2026-10-23

### Ajouté

- **Notre club** : pages des sections Séniors féminins, Jeunes féminins et Jeunes masculins, et
  présentations des équipes SF1, SF2, SM2 et M18 F1 avec leurs entraînements. Les photos des
  équipes illustrent leurs pages et celles de leur section.
- **Notre club** : chaque section et chaque équipe créée dans l’administration a d’elle-même sa
  page « En cours de rédaction », en attendant sa présentation. Toutes les équipes d’une section
  s’ouvrent ainsi depuis ses cartes « Nos équipes ».
- **Notre club** : chaque page de section se termine par « Nous rejoindre », qui invite à
  contacter le club pour une séance d’essai.

### Modifié

- **Notre club** : les onglets suivent l’ordre Séniors féminins, Séniors masculins, Jeunes
  féminins, Jeunes masculins, Loisirs. Les photos s’affichent entières, sans être recadrées.

## [0.1.1] - 2026-10-22

### Modifié

- **Calendriers** (planning, mon planning, gymnases) : un clic n’importe où dans la case d’un
  jour (vue mois) ou dans sa colonne (vue semaine) sélectionne ce jour, et plus seulement sur sa
  date. Un clic sur un événement l’ouvre et sélectionne son jour au passage.

## [0.1.0] - 2026-10-22

### Ajouté

- **Planning** : en vue semaine, un clic sur un jour le sélectionne et affiche ses événements
  sous le calendrier, comme en vue mois. « Nouvel événement » propose ce jour par défaut.
- **Planning sur téléphone** : un bandeau des sept jours tient en largeur et la liste du jour
  choisi remplace la grille horaire ; plus de défilement dans le planning. Navigation, légende
  et vue mois sont plus compactes sur petit écran.
- **Messagerie** : chacun peut supprimer une conversation de sa messagerie. Elle reste visible
  pour les autres participants et réapparaît si un nouveau message y est écrit.
- **Synchronisation FFVB** : les référents de l’équipe et les administrateurs sont prévenus des
  matchs ajoutés.

### Modifié

- **Notifications groupées** : les alertes d’une même opération (matchs ajoutés, gymnases FFVB à
  associer, matchs absents, dépassements de capacité, référents à réattribuer) forment une seule
  notification par compte, avec un décompte et le détail. Une synchronisation FFVB les réunit
  sous « Calendrier FFVB {équipe} ». Modifications, annulations, suppressions et demandes à
  valider restent unitaires.
- **E-mails groupés** : un e-mail de notification attend quelques minutes, puis tous ceux de
  même catégorie (capacité dépassée, annulations, demandes…) partent en un seul message
  (« 3 événements ont une capacité dépassée »). Le détail reste dans l’application.
- **Sources FFVB** : supprimer une source supprime définitivement tous les matchs importés
  depuis elle, passés comme à venir, avec leur historique, suivis et inscriptions. Les personnes
  concernées sont prévenues. L’option d’annulation des matchs à venir disparaît.
- **Référents** : seuls les coachs et les administrateurs peuvent être désignés référents d’une
  équipe ou d’un événement. Un coach rattaché à une équipe en devient référent ; retirer ce
  rattachement le retire des référents de l’équipe et de ses événements.
- **Notre club** : créneau du samedi 12 h – 14 h pour Loisirs compétition et présentation de
  l’équipe SM1.

### Corrigé

- Une demande d’événement ne peut plus être acceptée quand son auteur a perdu son rôle de coach
  ou son rattachement à l’équipe ; elle peut toujours être refusée.
- Tests unitaires qui échouaient au hasard quand la suite complète tournait : ils attendent
  désormais la fin du chargement.

### Mise à jour

- Appliquer les migrations `0028_email_categories` et `0029_hidden_threads`
  (`alembic upgrade head`) avant de redémarrer l’API et le worker.
- Nouveau réglage `LSOC_EMAIL_GROUP_MINUTES` : délai de regroupement des e-mails de
  notification, 10 minutes par défaut ; 0 les envoie sans délai.
- Le paramètre `cancel_upcoming` de `DELETE /ffvb/sources/{id}` est retiré.

## [0.0.3] - 2026-10-21

### Corrigé

- Régressions de l’interface : la déconnexion depuis une page réservée ramène à l’accueil.

## [0.0.2] - 2026-10-21

### Ajouté

- Informations générales sur le club, en remplacement de Clubeo.

## [0.0.1] - 2026-10-20

Première version en production.

[0.2.0]: https://github.com/LittleEngineerTT/LSOC_Management_App/compare/v0.1.2...v0.2.0
[0.1.2]: https://github.com/LittleEngineerTT/LSOC_Management_App/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/LittleEngineerTT/LSOC_Management_App/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/LittleEngineerTT/LSOC_Management_App/compare/v0.0.3...v0.1.0
[0.0.3]: https://github.com/LittleEngineerTT/LSOC_Management_App/compare/v0.0.2...v0.0.3
[0.0.2]: https://github.com/LittleEngineerTT/LSOC_Management_App/compare/v0.0.1...v0.0.2
[0.0.1]: https://github.com/LittleEngineerTT/LSOC_Management_App/tree/v0.0.1
