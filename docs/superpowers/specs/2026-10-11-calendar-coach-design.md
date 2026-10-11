# Calendrier, dates françaises et demandes des coachs

## Intentions et état de départ

Projet resynchronisé sur a567657 : sections de l’espace club, événements et séries, inscriptions plafonnées et planning personnel jusqu’au 31 août suivant existent déjà. Les rattachements coach à plusieurs équipes sont déjà gérés et sont réutilisés.

Directives du 11 octobre : afficher le planning en calendrier ; distinguer FFVB des événements locaux ; réparer la sélection de l’heure Du/Au des indisponibilités avec dates françaises ; permettre à un coach de demander un événement pour une de ses équipes et de l’ouvrir à d’autres équipes ou sections.

## Choix de réalisation

- Calendrier React sans dépendance supplémentaire : semaine avec jours/horaires et événements superposés côte à côte ; mois avec six semaines complètes et sélection de journée. Navigation et filtres dans l’URL. Sur téléphone, défilement interne de la semaine et grille mensuelle compacte avec détail de journée. Le calendrier personnel conserve son horizon et ses filtres.
- Origine fondée exclusivement sur `ffvb_match_id`, pas sur le type match : bleu FFVB, vert local, libellés visibles et filtre d’origine. Fiches, suivis, questions et inscriptions existantes restent accessibles.
- Champ français réutilisable : date jj/mm/aaaa, calendrier pour sélectionner la date, choix séparés des heures (00–23) et minutes (00–59). Valeur interne ISO locale, conversion Europe/Paris existante et validation des changements d’heure. S’applique aux indisponibilités Du/Au/Début/Fin ; les autres formulaires peuvent conserver leur contrôle existant.
- Demande de création distincte des demandes de modification : coach choisit une équipe possédant un rattachement `kind=coach` ; la section organisatrice vient de cette équipe, le référent est le demandeur. Il propose titre, type, dates, lieu, terrains, commentaire et ouverture aux sections/équipes, avec limite obligatoire si ouverte. Pas de série ni forçage par le coach. Aucun événement avant acceptation administrateur.
- L’administrateur examine la proposition et accepte/refuse avec motif. Validation transactionnelle, vérification du rôle/rattachement actuel à l’acceptation, capacité vérifiée ; seul l’admin peut forcer. Les doublons de décision ne créent pas un second événement. Notification du demandeur et des admins. Demandes privées : coach voit les siennes, admin voit toutes. Suppression de compte purge les données personnelles et retire les demandes en attente.
- Ouverture à une équipe : `registration_team_ids` ajouté à EventInput/Patch/View, union avec les sections ouvertes pour l’éligibilité ; même limite globale et mêmes verrous de capacité. Les données et contrats actuels sont conservés par migration.

## Validation et contraintes

Écritures exclusivement dans le projet. Tests existants inchangés sauf assertions rendues obsolètes par une directive ; ajouter des tests de régression avant les changements. Conserver React sans effets pour les calculs dérivés. Pas de commit, déploiement ou modification de données métier pour la vérification. Bases de test dédiées uniquement ; un seul processus de tests backend à la fois. Vérifier clavier, mobile et résolutions 320–2560 px, frontières de jours, DST, provenance, droits, approbation atomique et inscriptions.

## Ajouts de cadrage du 11 octobre

Toutes les modales et menus contextuels doivent se fermer au clic extérieur. Un clic dans le contenu ou sa marge interne ne ferme pas une modale ; un glissement depuis l’intérieur vers le fond ne constitue pas un clic extérieur.

La sous-application Gymnases doit présenter les disponibilités en calendrier semaine/mois, en conservant le choix du gymnase, les événements et les indisponibilités. Chaque créneau indique les terrains libres, complets ou excédentaires. Les périodes traversant minuit sont réparties entre les jours concernés, en Europe/Paris, avec une fin exclusive. L’affichage reste contenu sur téléphone, avec défilement interne des colonnes horaires.
