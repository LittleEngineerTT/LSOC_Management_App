# Changelog

Les changements notables de l’application LSOC sont consignés ici. Le format suit
[Keep a Changelog](https://keepachangelog.com/fr/1.1.0/) et la numérotation
[Semantic Versioning](https://semver.org/lang/fr/).

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
  équipe ou d’un événement. Un coach rattaché à une équipe en devient référent.
- **Notre club** : créneau du samedi 12 h – 14 h pour Loisirs compétition et présentation de
  l’équipe SM1.

### Corrigé

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

[0.1.0]: https://github.com/LittleEngineerTT/LSOC_Management_App/compare/v0.0.3...v0.1.0
[0.0.3]: https://github.com/LittleEngineerTT/LSOC_Management_App/compare/v0.0.2...v0.0.3
[0.0.2]: https://github.com/LittleEngineerTT/LSOC_Management_App/compare/v0.0.1...v0.0.2
[0.0.1]: https://github.com/LittleEngineerTT/LSOC_Management_App/tree/v0.0.1
