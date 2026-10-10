# Administration V1

L’administrateur doit pouvoir gérer le club depuis le frontend, en utilisant le contrat API V1 déjà livré. L’architecture React/TypeScript, FastAPI, sessions cookies et CSRF reste celle validée. La sous-application Accueil est retirée du menu ; `/app` conserve une page d’arrivée vide.

L’administration propose des onglets accessibles dans l’URL : utilisateurs, sections, équipes, gymnases, indisponibilités, validations, FFVB et e-mails. Les autres sous-applications restent vides. Les permissions sont vérifiées par le backend ; l’accès frontend est réservé au rôle admin. Une session expirée revient à la connexion.

Les utilisateurs sont créés avec prénom, catégorie, rôles cumulables et autorisation de messagerie. Le lien d’invitation apparaît uniquement après création ou régénération et reste en mémoire, sans stockage navigateur. Il peut être copié ; révocation et suppression sont explicites. Les rattachements joueur/coach sont gérés par équipe. Les contraintes de catégorie et de dernier administrateur restent appliquées.

Sections, équipes et gymnases disposent de création, modification et suppression avec confirmation. Les équipes ont une section et un référent actif facultatif. Les gymnases indiquent leur capacité ; les refus pour objets utilisés restent visibles. Les indisponibilités définissent un intervalle, un gymnase et un nombre de terrains.

Décision de cadrage de l’utilisateur : création/modification des événements, séries et restauration d’historique sont réservées à la future sous-application Planning. Les dates des indisponibilités sont saisies et affichées en Europe/Paris, indépendamment du fuseau du navigateur. Les validations conservent leur contrôle des versions et le forçage de capacité et les modifications FFVB demandent une confirmation explicite.

Les validations présentent les changements demandés et permettent acceptation/refus motivés. FFVB expose sources, activation, synchronisation manuelle, associations de gymnases, marges par défaut, matchs, conflits et actions accepter/suspendre 48 h/désactiver/réactiver.

Directives complémentaires de l’utilisateur : la fréquence est un entier en jours (1 à 365). Le code du club est configuré une seule fois, puis verrouillé côté API et grisé dans tous les formulaires de sources. L’administrateur peut coller une URL FFVB : le backend vérifie le domaine et le chemin officiels, extrait saison/entité/poule et lit la composition de poule pour identifier l’équipe du club. Si une équipe et un rattachement local avec référent actif sont identifiés sans ambiguïté, le frontend crée directement la source dans le gestionnaire de cet événement utilisateur. Sinon, il conserve le formulaire prérempli et propose le choix entre les équipes identifiées. Aucune équipe ou section locale n’est inventée. Une erreur réseau conserve la saisie manuelle ; seuls les liens HTTPS du calendrier officiel sont lus, sans redirection ni exécution de scripts.

Les valeurs initiales connues sont 2026/2027, PTIDF92, BRC, équipe LSO COLOMBES n°6, club 0926620. Les réglages sont persistés seulement sur action explicite. Le backend conserve `interval_minutes` pour compatibilité avec le worker et les anciens clients, accepte `interval_days` et expose les deux unités. La migration convertit les sources existantes à un nombre entier de jours (arrondi supérieur) et reprend le code d’un club existant unique.

Le suivi des e-mails propose les états en attente, échec et envoyé, avec reprise des envois non livrés. Le contenu des messages et les jetons ne sont pas exposés. Les conversations restent dans la future Messagerie.

Les listes paginées de l’API sont parcourues sans troncature silencieuse. Chargement, erreurs, liste vide et reprise sont visibles. Les formulaires se réinitialisent par clé et les listes filtrées sont calculées au rendu, conformément au guide React fourni ; les effets servent uniquement aux lectures réseau et au DOM. Aucun ajout de dépendance n’est nécessaire. Les contrôles existants sont conservés ; de nouveaux tests couvrent les nouveaux parcours.
