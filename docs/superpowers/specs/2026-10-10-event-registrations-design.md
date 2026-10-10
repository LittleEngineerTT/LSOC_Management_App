# Séances ouvertes et inscriptions

Directive utilisateur du 10 octobre : « mettre un évènement comme ouvert à certaines sections. Pour un évènement ouvert, les adhérents peuvent s'inscrire si et seulement si la limite de l'évènement n'est pas atteinte. » Cette fonctionnalité anticipe le volet V2 de la [spécification](2026-10-09-lsoc-management-design.md).

## Règles

- Un administrateur ouvre une séance en choisissant une ou plusieurs sections (`registration_section_ids`), qui peuvent différer des sections organisatrices. Il fixe obligatoirement une limite d’inscrits (`registration_limit`, de 1 à 1000). Une liste vide ferme la séance.
- Peut s’inscrire un compte actif qui a le rôle adhérent et un rattachement, joueur ou coach, à une équipe d’une section ouverte. La séance ne doit être ni annulée ni commencée, et le nombre d’inscrits doit être inférieur à la limite. Aucune validation n’est requise : l’inscription est immédiate.
- L’adhérent se désinscrit librement avant le début. Un administrateur peut retirer une inscription ; l’adhérent en est notifié.
- La limite ne peut pas descendre sous le nombre d’inscrits. Fermer ou annuler une séance conserve les inscriptions existantes, et les inscrits sont prévenus des modifications comme s’ils suivaient la séance.
- Les prénoms des inscrits sont visibles des administrateurs et du référent ; les autres comptes voient seulement le nombre de places.

## Choix techniques

Il y a une table `registrations`, unique par compte et événement, effacée en cascade avec le compte ou l’événement (migration `0006_event_registrations`). Le nombre d’inscrits est calculé par une sous-requête corrélée (`registration_count`), qui ne figure pas dans l’historique. Inscriptions et changements de limite prennent le verrou du planning, ce qui empêche tout dépassement concurrent.

Dans le frontend :
- l’éditeur d’événement (admin) contient deux champs ;
- le détail montre le bloc « Inscriptions » ;
- le planning porte le badge « Ouvert · n/limite » ou « Complet » ;
- Mon planning ajoute les filtres « Inscrit » et « Ouvertes à mes sections ».

## Vérification

- [x] Tests unitaires frontend (inscription, séance complète, section non autorisée, limite obligatoire) et scénarios Chromium avec matrice 320–2560 px.
- [x] Ruff, mypy strict, TypeScript, ESLint, Prettier, build.
- [ ] `backend/tests/test_registrations.py` (sections, limite, concurrence, droits, notifications) et `alembic check` sur PostgreSQL : non exécutés le 10 octobre, faute de PostgreSQL dans l’environnement de travail.
