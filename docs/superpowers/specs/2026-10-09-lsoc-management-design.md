# LSOC Management App — spécification de conception

Date : 9 octobre 2026.
Statut : proposition écrite à relire avant le plan d'implémentation.
Dépôt cible : https://github.com/LittleEngineerTT/LSOC_Management_App.git

## 1. Objectif et périmètre

Centraliser les emplois du temps des sections de volley et l'occupation des gymnases du club. Les membres consultent un planning cohérent avec les matchs FFVB ; les administrateurs gèrent les comptes, les événements, les demandes de changement et les conflits.

La V1 comprend les comptes individuels, les rôles cumulables, les plannings par gymnase et section, les entraînements récurrents, les indisponibilités, les référents, les validations, l'historique, la synchronisation FFVB, les questions liées aux événements et les notifications.

La V2 ajoutera les séances ouvertes ou fermées et les inscriptions réservées aux sections autorisées. Le mécanisme d'acceptation des inscriptions sera cadré avant cette version.

Les règles désignées comme « proposition » complètent les décisions exprimées par l'utilisateur ; elles restent à valider avec cette spécification.

## 2. Choix techniques et organisation

Choix validés : deux dossiers distincts backend/ et frontend/, Python avec FastAPI et typage strict, React avec TypeScript, PostgreSQL, gestion de Node avec nvm.

Architecture proposée :

    backend/
      app/
        api/             # Routes, schémas d'entrée/sortie, dépendances
        domain/          # Règles métier et permissions
        services/        # Cas d'usage et transactions
        persistence/     # Modèles et accès PostgreSQL
        integrations/    # Lecture FFVB et transport des e-mails
        jobs/            # Synchronisation et notifications différées
        core/            # Configuration et authentification
      migrations/
      tests/
      pyproject.toml
    frontend/
      src/
        api/             # Client API et types issus d'OpenAPI
        features/        # Comptes, calendriers, événements, administration
        components/
      package.json
    docs/
    .nvmrc
    compose.yaml
    .env.example

Proposition : Python 3.12, modèles Pydantic pour les contrats API, SQLAlchemy avec modèles annotés, Alembic pour les migrations, mypy en mode strict et Ruff pour les contrôles Python. React est construit avec Vite ; TypeScript fonctionne en mode strict. Les versions des dépendances seront fixées à l'installation dans les fichiers de verrouillage.

Node 24.11.1 est déjà installé via nvm ; proposition de le fixer dans .nvmrc. Python 3.12.3 est disponible. Le déploiement final et le fournisseur d'e-mails ne sont pas choisis ; un transport SMTP configurable conserve cette indépendance.

Deux organisations des tâches différées ont été considérées :

1. Dans le processus FastAPI : moins de processus, mais les multiples workers API et leurs redémarrages compliquent la maîtrise des vérifications périodiques.
2. Un processus Python séparé partageant les services métier et PostgreSQL : proposition recommandée pour isoler les vérifications et les envois. Une file persistante en base permet les reprises sans ajouter Redis à la V1.

Le frontend appelle une API REST versionnée sous /api/v1. Proposition : un même domaine de production dessert le frontend et transmet /api au backend. Aucun accès PostgreSQL depuis le navigateur.

## 3. Comptes et authentification

L'administrateur prépare un compte avec prénom, catégorie, rôles et rattachements, puis obtient un lien d'invitation copiable. L'utilisateur renseigne son e-mail privé et choisit son mot de passe à l'activation. Ce parcours remplace la proposition initiale de mot de passe temporaire transmis par l'admin.

Proposition : invitation valable sept jours, à usage unique, révocable et régénérable. Elle n'offre aucun accès aux plannings avant activation. L'e-mail est unique parmi les comptes actifs et vérifié par un lien envoyé à l'adresse saisie avant activation complète.

Connexion par e-mail et mot de passe. Réinitialisation par lien temporaire à usage unique envoyé à l'adresse vérifiée ; proposition d'expiration après une heure. Les réponses de récupération ne révèlent pas si une adresse possède un compte.

Proposition de sécurité : mots de passe hachés avec Argon2id, jetons stockés uniquement sous forme de condensats, sessions serveur avec cookies HttpOnly, Secure en production et SameSite, protection CSRF des opérations de modification, limitation des tentatives de connexion et de récupération. Réinitialiser le mot de passe invalide les sessions existantes.

L'accès des adhérents commence à M18 ; cette restriction ne concerne pas les coachs. Les admins attribuent les catégories : aucune date de naissance n'est nécessaire. Les rôles, rattachements et données d'authentification restent internes ; l'e-mail ne figure pas sur les profils visibles des adhérents.

Proposition : premier administrateur créé par une commande locale dédiée, sans inscription publique ni mot de passe prédéfini dans le dépôt.

## 4. Rôles et permissions

Les rôles adhérent, coach et administrateur sont cumulables sur un compte. Les rattachements comme joueur et comme coach sont distincts ; un coach peut encadrer plusieurs équipes et être joueur.

Une section représente un groupe de pratique ; une équipe représente notamment une équipe engagée en compétition et se rattache à une section. Proposition : autoriser plusieurs rattachements comme joueur.

| Action | Utilisateur autorisé |
| --- | --- |
| Consulter les plannings des sections et gymnases | Comptes actifs autorisés |
| Créer un événement manuel | Administrateur |
| Gérer comptes, rôles, sections, équipes et gymnases | Administrateur |
| Demander une modification d'événement | Référent de cet événement ou administrateur |
| Appliquer directement une modification | Administrateur, ou référent autorisé sur cet événement |
| Accorder la modification sans validation | Administrateur |
| Forcer un dépassement de capacité | Administrateur avec avertissement |
| Modifier date, heure ou gymnase d'un match FFVB | Administrateur avec avertissement |
| Résoudre un conflit FFVB ou suspendre sa vérification | Administrateur |
| Poser une question sur un événement | Adhérent disposant du droit de messagerie |
| Lire les questions et répondre | Administrateurs ; l'adhérent lit uniquement ses propres échanges |

Le statut de coach seul ne permet pas de modifier un événement sans en être le référent. Un adhérent peut exceptionnellement être référent ; ses permissions sur cet événement s'ajoutent à celles de son rôle.

Le droit de modification sans validation appartient à l'événement, et non au compte ou à l'équipe. Il est faux par défaut. Proposition : changer le référent remet ce droit à faux sauf attribution explicite par un admin. Une série n'accorde pas implicitement ce droit à toutes ses occurrences.

## 5. Événements et récurrence

Un événement comporte son type, son titre, les sections concernées, son lieu, un début et une fin, le nombre de terrains occupés, un référent et le droit éventuel de modification directe. Types de V1 : entraînement, match, autre activité. Les indisponibilités sont des blocages de capacité administrés séparément.

Chaque événement possède un référent actif. Après suppression du compte de ce référent, l'événement est temporairement sans référent, signalé aux admins pour réattribution. Chaque équipe possède un référent par défaut pour ses matchs importés ; il est modifiable sur chaque événement. Proposition : une équipe ne peut être mise en synchronisation automatique qu'après configuration de ce référent et de son rattachement à une section.

Entraînements récurrents hebdomadaires avec date de début et de fin. Proposition : matérialiser les occurrences de la période, conserver un lien de série et permettre la modification ou l'annulation d'une occurrence, ou de celle-ci et des suivantes. Une exception individuelle ne doit pas être écrasée par une régénération de série.

Proposition : appliquer atomiquement une modification de série sur toutes les occurrences sélectionnées ; présenter tous les conflits avant application. Les droits sont vérifiés pour chaque occurrence : être référent d'une séance ne donne pas de droit sur le reste de la série.

Proposition : une annulation conserve l'événement et son historique, mais libère immédiatement sa réservation.

## 6. Capacité des gymnases

Un gymnase possède une capacité entière positive de terrains occupables. Chaque événement local indique une quantité de terrains ; aucune affectation à un terrain numéroté n'est nécessaire en V1.

Les admins peuvent bloquer une partie des terrains ou l'ensemble d'un gymnase sur un créneau ou une période. Ces blocages réduisent la capacité disponible ; ceux affectant un événement existant déclenchent un signalement.

À chaque instant :

    occupation = terrains des événements actifs + terrains indisponibles
    disponibilité = capacité du gymnase - occupation

Une occupation égale à la capacité est autorisée : le gymnase est complet. Proposition : intervalles de type [début, fin), afin qu'une séance finissant à 20 h ne chevauche pas une séance commençant à 20 h. Le calcul évalue chaque changement d'occupation au fil des créneaux, sans additionner artificiellement des événements qui ne sont pas simultanés.

Un référent est bloqué en cas de dépassement, même avec le droit de modification directe. Un admin peut forcer après confirmation de l'avertissement ; le forçage est historisé. Le planning expose le dépassement explicitement : zéro terrain disponible et quantité excédentaire dans le détail.

Les écritures sont transactionnelles : verrouiller les gymnases concernés, recalculer la capacité puis écrire empêche deux opérations simultanées de réserver les mêmes derniers terrains. Lors d'un déplacement, les verrous sont acquis dans un ordre déterministe. Ces règles concernent également blocages, séries, synchronisation et restauration de modifications.

Dates stockées avec fuseau ; affichage et récurrences en Europe/Paris, y compris lors des changements d'heure.

## 7. Demandes de changement et historique

Une demande conserve la version de l'événement sur laquelle elle s'appuie et les valeurs proposées. En attente de validation, elle ne modifie ni l'EDT ni les disponibilités.

Un admin accepte ou refuse. À l'acceptation, les permissions et la capacité sont contrôlées à nouveau. Proposition : une demande devenue obsolète après une autre modification doit être réexaminée et ne peut écraser silencieusement cette modification.

Le référent autorisé applique directement les champs permis ; les admins sont notifiés et peuvent annuler l'action. L'annulation est historisée. Proposition : si des changements plus récents existent, les admins examinent les valeurs à restaurer plutôt que de remplacer tout l'événement.

L'historique contient l'origine de l'action, son auteur, sa date, les champs changés, les anciennes et nouvelles valeurs, les décisions et les forçages. Il distingue actions humaines et synchronisations FFVB.

## 8. Synchronisation FFVB

### Source observée

Le HTML fourni par l'utilisateur contient composition de poule, codes match, journées, dates, heures, équipes recevantes et visiteuses, noms de gymnase.

Configuration fournie : saison 2026/2027, entité PTIDF92, poule BRC, équipe LSO COLOMBES, numéro d'équipe 6 dans cette poule, code club 0926620.

| Code | Date et coup d'envoi | Équipes | Gymnase |
| --- | --- | --- | --- |
| BRC005 | 15/10/2026, 20:50 | MEUDON CHAVILLE SEVRES VOLLEY 2 / LSO COLOMBES | GYMNASE JULES LADOUMEGUE |
| BRC007 | 02/11/2026, 20:30 | LSO COLOMBES / AS SP BOURG LA REINE 2 | GYMNASE AMBROISE PARE |

Un match est identifié par saison + entité + code match. Le numéro d'équipe est relatif à une poule et une saison, sans être l'identifiant global du club. Les sources sont configurées par équipe et saison.

### Import et réservation

L'import crée et met à jour les événements automatiquement dans le cadre de la configuration effectuée par les admins ; il constitue l'exception système à la création manuelle réservée aux admins.

Un match extérieur figure dans l'EDT sans réserver de terrain du club. Un match à domicile réserve par défaut trois terrains, de 75 minutes avant le coup d'envoi jusqu'à 150 minutes après. Total : 225 minutes, soit 3 h 45. Pour un coup d'envoi à 20 h 30 : réservation de 19 h 15 à 23 h.

Les admins modifient les paramètres de durée par défaut et les ajustent par événement. Modifier les défauts n'affecte pas les événements existants. Le nombre de terrains est ajustable par événement ; proposition de rendre aussi son défaut de trois terrains configurable.

Le backend conserve séparément coup d'envoi officiel, marges de réservation et paramètres locaux. Un déplacement officiel recalcule début et fin de réservation avec les marges de l'événement.

Proposition : associer explicitement les noms de gymnase FFVB aux gymnases locaux. Si un nouveau lieu ne peut être associé, actualiser l'EDT, alerter les admins et signaler que l'occupation locale est indéterminée ; aucun gymnase n'est choisi arbitrairement.

Les changements officiels sont appliqués automatiquement, y compris s'ils provoquent un dépassement de capacité : conserver le nouvel horaire, recalculer EDT et disponibilités, puis avertir les admins.

### Vérifications et erreurs

Proposition : vérification toutes les quinze minutes, paramétrable, avec déclenchement manuel possible par un admin. Synchronisation périodique, sans promesse de flux instantané FFVB.

Chaque événement affiche sa dernière date de vérification réussie. Elle avance même si le match est identique ou si sa comparaison révèle un conflit avec une valeur manuelle. La date du dernier changement effectif est distincte.

Une réponse réseau ne suffit pas : page et données du match doivent être correctement interprétées. Une erreur réseau, un HTML inexploitable ou un match absent conservent les données et la dernière vérification réussie. Proposition : signaler un match disparu sans le supprimer automatiquement. Les scripts et publicités du HTML ne sont jamais exécutés.

### Modifications manuelles et conflits

Seuls les admins modifient localement date, heure et gymnase, avec avertissement indiquant que ces informations se mettent normalement à jour automatiquement.

Chaque champ modifié manuellement est protégé et son auteur mémorisé. La prochaine vérification réussie qui contredit ces valeurs ouvre un conflit ; les valeurs manuelles sont conservées en attendant résolution. Proposition : les autres champs officiels non protégés continuent d'être synchronisés.

L'e-mail de conflit est envoyé uniquement à l'auteur de la modification concernée, admin ou non. Dans les permissions de V1, l'auteur de ces champs sera un admin ; la notification dépend néanmoins de l'auteur, et non de son rôle. Seuls les admins résolvent le conflit ; tous le voient dans l'interface.

Un administrateur peut :

1. Accepter la version FFVB : appliquer les valeurs officielles et retirer la protection manuelle correspondante.
2. Suspendre les vérifications pendant 48 heures : conserver les valeurs locales, puis reprendre automatiquement les comparaisons. Proposition : conserver la protection manuelle ; une divergence persistante à la reprise ouvre de nouveau le conflit.
3. Désactiver définitivement la vérification pour cet événement précis : conserver les valeurs locales et sortir l'événement des mises à jour automatiques.

L'événement affiche sa suspension ou désactivation et l'échéance de suspension. La dernière vérification réussie n'avance pas tant qu'il n'est pas vérifié. Proposition : permettre une réactivation explicite par un admin.

Proposition : un conflit inchangé n'envoie pas d'e-mail à chaque passage ; notifier une nouvelle divergence, avec réouverture après suspension. Si l'auteur a été supprimé, aucun e-mail n'est envoyé ; le conflit reste visible aux admins.

## 9. Questions liées aux événements

La messagerie sert uniquement aux questions d'un adhérent sur un événement et aux réponses des admins. Aucun échange entre adhérents ni conversation générale. Chaque fil appartient à un événement et à un adhérent ; seuls cet adhérent et le groupe admin le voient. Le référent n'accède pas aux questions privées du seul fait de son affectation.

Le droit d'écrire est accordé par défaut et révocable individuellement par un admin. Proposition : la révocation empêche les nouveaux messages mais laisse lire les échanges et réponses déjà reçus.

Les notifications adhérents ont été limitées aux mises à jour de compte et aux modifications d'événements suivis. Proposition : les réponses aux questions restent visibles dans le fil avec indicateur de lecture, sans nouvelle catégorie d'e-mails ou de notifications adhérent. L'arrivée d'une question peut notifier les admins.

## 10. Notifications et suivis

Notifications dans l'application et par e-mail. Proposition : les envois se déclenchent après validation de la transaction, sont persistés pour reprise et dédupliqués.

Un adhérent suit un événement ou une série. Les e-mails de modifications suivies sont activés par défaut et désactivables dans ses préférences. Proposition : suivre une série couvre ses occurrences présentes et futures ; retirer ce suivi conserve les autres suivis individuels explicites.

Les seules notifications d'un adhérent en sa qualité d'adhérent concernent les mises à jour de compte et modifications des événements suivis. Un utilisateur également référent ou admin reçoit celles liées à ses autres responsabilités.

Le référent reçoit un e-mail pour les modifications d'un autre utilisateur ou de la FFVB, sauf désactivation de cette fonction. L'auteur ne reçoit pas d'e-mail pour sa propre modification d'événement, même s'il le suit. Le conflit FFVB est une alerte ultérieure distincte à son auteur.

Les admins sont notifiés des demandes, changements directs de référents, conflits de capacité et événements devenus sans référent. L'e-mail de divergence manuelle/FFVB reste limité à l'auteur.

Proposition : activation, vérification d'e-mail et récupération du mot de passe restent des messages de service indépendants des préférences de suivi. Les canaux des alertes admin sont activés par défaut. Une vérification sans changement réel ne déclenche pas de notification.

## 11. Suppression d'un compte

La suppression retire immédiatement de la base active et des files applicatives profil, e-mail, secrets d'accès, sessions, invitations et jetons, préférences, rattachements, suivis, inscriptions futures et données de messagerie de l'utilisateur. Les envois en attente à son adresse sont annulés. Aucune fiche de compte inactif n'est conservée.

Seul le prénom est conservé pour attribuer les actions historiques. Supprimer les identifiants permettant de relier ces actions au compte, y compris dans les anciennes/nouvelles valeurs d'historique et les tâches ou notifications. Le prénom restant n'est pas présenté comme une anonymisation complète.

Événements et historique utile des modifications subsistent sans profil associé. Les références de référent d'événement et par défaut d'équipe sont retirées avec alerte aux admins. Proposition : rendre non exécutables les demandes en attente de l'auteur et retirer leur lien au compte ; conserver les conflits pour résolution admin.

Proposition : suppression réservée aux admins et dernier administrateur actif non supprimable sans remplaçant. Les logs ne conservent ni e-mails, ni secrets, ni corps de messages. La politique d'expiration des sauvegardes devra être définie avec l'hébergement ; la suppression immédiate porte ici sur les données actives, pas sur les e-mails déjà livrés dans des boîtes externes.

## 12. Modèle de données proposé

| Entité | Responsabilité |
| --- | --- |
| User, UserRole, Invitation, Session, RecoveryToken | Compte, activation, accès et récupération |
| Section, Team, Membership, CoachingAssignment | Pratique, compétition, rattachements joueur et coach |
| Gymnasium, AvailabilityBlock | Capacité et indisponibilités |
| Event, EventSeries | Séances, matchs, occurrences et référent |
| ChangeRequest, EventRevision | Validation et historique versionné |
| FFVBSource, FFVBMatchState, FFVBConflict | Source, dernier état officiel et divergence locale |
| EventFollow, SeriesFollow, NotificationPreference | Suivis et canaux souhaités |
| QuestionThread, QuestionMessage | Questions privées sur un événement |
| Notification, EmailJob | Notifications et envois persistants |

Contraintes SQL pour les clés uniques, relations et quantités positives. Permissions et états métier sont contrôlés côté backend ; masquer un bouton React ne constitue pas un contrôle d'accès.

## 13. Parcours frontend

Interface française sur ordinateur et téléphone. Pages proposées : activation, connexion, mot de passe oublié ; planning par section ; planning des gymnases et disponibilités ; détail d'événement avec suivi, référent et état FFVB ; questions de l'adhérent ; préférences ; espace admin.

Le détail sépare horaires de match et de réservation et présente terrains, lieu, historique autorisé, dernière vérification et conflits. Le référent voit les actions correspondant à ses droits effectifs.

L'espace admin rassemble comptes et invitations, rattachements, gymnases et blocages, séries, demandes, historique, sources FFVB et conflits. Les erreurs indiquent les créneaux de dépassement et les changements devenus obsolètes.

## 14. Vérification attendue

Avant livraison V1, vérifier :

- Invitation, choix/vérification de l'e-mail, expiration et usage unique, connexion, récupération et révocation des sessions.
- Rôles cumulables, coach multiéquipes, adhérent référent, droit direct par occurrence, accès interdits.
- Capacité sur chevauchements partiels, égalité autorisée, limites des créneaux, blocages, concurrence et forçage admin.
- Récurrences, exceptions, changements d'heure, modification atomique de série et demandes obsolètes.
- Lecture du HTML fourni, identité des matchs, absence de doublons, association des gymnases.
- Trois terrains et 75 + 150 minutes, extérieur sans réservation locale, conservation des réglages individuels.
- Vérification identique actualisant la date sans notification ; erreur ou match absent conservant les données.
- Déplacement FFVB avec dépassement signalé ; divergence manuelle conservée, e-mail auteur seul, résolution admin seule.
- Suspension 48 heures, reprise, désactivation par événement, absence d'e-mails répétitifs.
- Suivis de séances/séries, préférences, absence d'e-mail de sa propre modification, notification référent pour modification externe.
- Confidentialité des questions et révocation du droit d'écrire.
- Suppression de compte, accès invalidé immédiatement, purge des données actives, prénom historique seul et réattribution des référents.
- Tests PostgreSQL réels des transactions/concurrence, typage strict Python/TypeScript, construction du frontend et parcours clés dans le navigateur.

## 15. État du cadrage et étapes

- [x] Besoin, utilisateurs et règles métier recueillis.
- [x] Stack principale et dépôt cible choisis.
- [x] Architecture proposée et variantes des tâches différées documentées.
- [x] Spécification écrite, décisions distinguées des propositions.
- [ ] Relecture et validation de cette spécification par l'utilisateur.
- [ ] Plan d'implémentation écrit et choix du mode d'exécution.
- [ ] Implémentation et vérifications.

Le dossier local ne contient ni code applicatif ni métadonnées Git exploitables. La lecture du dépôt distant a échoué par résolution DNS et via l'outil web ; cette spécification est enregistrée localement, sans commit ni envoi GitHub. L'accès au dépôt doit être rétabli pour examiner ses consignes et intégrer le travail dans son historique réel.

## Références techniques consultées

- [FastAPI — annotations Python et modèles](https://fastapi.tiangolo.com/python-types/).
- [React — TypeScript](https://react.dev/learn/typescript).
- [SQLAlchemy — modèles déclaratifs annotés](https://docs.sqlalchemy.org/en/20/orm/declarative_tables.html).
- [PostgreSQL — verrous explicites](https://www.postgresql.org/docs/current/explicit-locking.html).
- [mypy — prise en main](https://mypy.readthedocs.io/en/stable/getting_started.html).
- [Vite — prise en main](https://vite.dev/guide/).
