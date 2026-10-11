# Reprise du projet LSOC Management App

## État du projet

Le backend V1 est implémenté dans `backend/` : FastAPI, PostgreSQL, migrations Alembic, sessions/CSRF, invitations et comptes, catalogue, planning/récurrences/capacités, validations et historique, suivis, messagerie privée, notifications, worker SMTP et synchronisation FFVB. Le frontend dans `frontend/` livre l'authentification par identifiant, l'administration et toutes les sections de l'espace club : accueil, planning, gymnases, messagerie, mon planning, mes sections et profil.

Entrées de reprise : [README](../README.md), [guide API frontend](backend-api.md), [contrat OpenAPI](../backend/openapi.json), [plan d'implémentation](superpowers/plans/2026-10-09-backend-v1.md). La configuration de développement est dans `compose.yaml` et `.env.example` ; `lsoc create-admin` crée le premier administrateur sans identifiants prédéfinis. `lsoc seed-demo` ajoute facultativement les données de démonstration.

Frontend : [spécification authentification/accueil](superpowers/specs/2026-10-10-frontend-auth-design.md) et [plan/compte rendu](superpowers/plans/2026-10-10-frontend-auth.md). Suites : [administration](superpowers/specs/2026-10-10-administration-design.md), [identifiant de connexion](superpowers/specs/2026-10-10-username-auth-design.md) (l'identifiant peut être une adresse e-mail, jamais vérifiée), [sections de l'espace club](superpowers/specs/2026-10-10-club-sections-design.md) [séances ouvertes/inscriptions](superpowers/specs/2026-10-10-event-registrations-design.md) et [calendrier/demandes des coachs](superpowers/specs/2026-10-11-calendar-coach-design.md). Le 11 octobre ont aussi été ajoutés :

- les pastilles de non-lus dans le menu (Accueil : notifications ; Messagerie : questions ou réponses non lues) et par conversation, avec « Marquer comme lu » et « Tout marquer comme lu » dans la messagerie ;
- le bouton « Nouvel événement » du planning visible pour tout compte coach ou référent d’équipe ; sans équipe éligible, il explique comment le devenir ;
- le report du référent d’équipe sur ses événements (migration 0009 de rattrapage) ;
- Mon planning et Mes sections présents seulement dans la barre du haut, plus dans le menu du compte ;
- récurrences sur plusieurs jours de la semaine, fin par défaut au prochain 31 juillet, et suppression d’une occurrence ou de la suite d’une série ;
- notifications cliquables vers l’action à réaliser, validation ouverte depuis la notification, décisions et messages des admins écrits dans la messagerie du référent ;
- licences par adhérent (Administration › Licences ; statut visible dans Mon profil) ;
- suppression des sources FFVB ;
- FFVB : terrains et marges réglables par source (migration 0010), gymnases rattachés sans accents ni casse et par nom pour les rencontres reçues par « LSO COLOMBES », pages de poule à codes lettrés ;
- des notifications qui disparaissent une fois marquées comme lues ;
- la description des événements ;
- une session déconnectée seulement après 7 jours d’inactivité (`LSOC_SESSION_IDLE_DAYS`). Le compte administrateur local demandé a été créé dans la base Compose ; ses identifiants ont été fournis dans la conversation, jamais ajoutés au code du frontend.

Dernière vérification backend : 37 tests passent sur PostgreSQL 14 / Python 3.13, migrations aller-retour et comparaison du schéma, concurrence, HTML FFVB réellement récupéré, SMTP réel de test, Ruff, mypy strict et parcours HTTP réel. L'utilisateur a depuis démarré les conteneurs PostgreSQL 16/API/worker/Mailpit ; l'API et la base sont saines. PostgreSQL est exposé sur `127.0.0.1:5433` pour éviter le conflit avec le PostgreSQL local en 5432. Un avertissement de dépréciation tiers Starlette/httpx subsiste dans les tests. La commande reproductible est `backend/.venv/bin/python backend/scripts/verify.py`, avec une base dédiée uniquement : le script efface son schéma.

Dernière vérification frontend (10 octobre, sections du club) : 54 tests unitaires, 26 scénarios Chromium desktop/mobile (4 exclusions spécifiques au format), ESLint des hooks, Prettier, TypeScript strict et build passent, avec une API simulée. Les matrices contrôlent authentification, administration et sections de 320 à 2560 px. Vérification précédente avec le backend réel : Les parcours réels navigateur/API/SMTP ont vérifié connexion et restauration de l'administrateur, invitation, activation et vérification d'e-mail dans Mailpit, récupération/reset, révocation de session et nouvelle connexion. Le compte temporaire a été supprimé ; l'administrateur est conservé sans changement de mot de passe. Les tests backend existants n'ont pas été modifiés.

Architecture confirmée : monolithe modulaire FastAPI, worker séparé et file PostgreSQL sans Redis ; Docker Compose local, même domaine frontend/API en production ; base vide et données facultatives de démonstration. La source FFVB initiale est celle décrite ci-dessous. Les tests existants ont été conservés et les ajouts ont été autorisés par l'utilisateur. Aucune question de réalisation supplémentaire n'est nécessaire ; seuls les cadrages et actions hors du projet doivent être soumis à l'utilisateur.

La spécification se trouve dans [2026-10-09-lsoc-management-design.md](superpowers/specs/2026-10-09-lsoc-management-design.md). Elle rassemble les règles métier décidées avec l'utilisateur et distingue les propositions techniques encore à relire. Le choix de PostgreSQL a été confirmé après sa rédaction.

Dépôt cible : https://github.com/LittleEngineerTT/LSOC_Management_App.git

Stack demandée : backend Python FastAPI avec typage strict, frontend React TypeScript dans un dossier séparé, PostgreSQL et nvm pour Node. `backend/` et `frontend/` existent ; `.nvmrc` recommande Node 22. Le serveur local frontend se lance depuis `frontend/` par `npm run dev`, sur http://localhost:5173 avec proxy `/api` vers le backend Docker.

## Prochaine étape

1. Les 108 tests backend passent sur la base de test (11 octobre, migrations 0005 à 0013 comprises). `scripts/verify.py` reste la commande de référence ; elle exige le venv hôte `backend/.venv`.
2. `backend/openapi.json` a été régénéré le 10 octobre. Vérifier les sections contre le backend Docker avec des données temporaires. Sous Node 26, lancer Vitest avec `NODE_OPTIONS=--no-webstorage` (Node 22 recommandé).
3. Avant un déploiement, cadrer hébergement, HTTPS, SMTP réel et conservation des sauvegardes.

Source FFVB fournie : https://www.ffvbbeach.org/ffvbapp/resu/vbspo_calendrier.php?saison=2026/2027&codent=PTIDF92&poule=BRC

Le HTML de la page publique a été récupéré dans `backend/tests/fixtures/ffvb-original.html` et sert aux tests de synchronisation. Les scripts et publicités qu'il contient ne sont jamais exécutés par l'importeur.

## Transférer le commit de sauvegarde

Cette section décrit l'ancien transfert du cadrage, antérieur au développement du backend. Le bundle et l'archive ne contiennent pas le nouveau backend. Les fichiers de la livraison sont locaux et non commités : la branche `main` du dossier partagé ne possède encore aucun commit, et ses métadonnées Git sont protégées.

Le dossier Git de l'environnement d'origine est vide et en lecture seule ; l'accès réseau à GitHub échoue. Le commit de sauvegarde est créé dans un dépôt temporaire distinct, sans modifier les métadonnées Git protégées. Il contient tous les fichiers de travail, soit cette note et la spécification, dans une histoire indépendante du dépôt distant.

Le fichier lsoc-handoff.bundle accompagne cette note. Il contient la branche codex/project-handoff-2026-10-09. Sur la nouvelle machine, le récupérer, puis intégrer son commit dans une copie du vrai dépôt :

```sh
git clone https://github.com/LittleEngineerTT/LSOC_Management_App.git
cd LSOC_Management_App
git switch -c codex/project-handoff-2026-10-09
git fetch /chemin/vers/lsoc-handoff.bundle refs/heads/codex/project-handoff-2026-10-09
git cherry-pick FETCH_HEAD
git push -u origin codex/project-handoff-2026-10-09
```

Ces commandes préservent l'histoire du dépôt distant. Si le dépôt distant est entièrement vide, sans aucun commit, cloner directement le bundle puis rattacher le dépôt GitHub :

```sh
git clone -b codex/project-handoff-2026-10-09 /chemin/vers/lsoc-handoff.bundle LSOC_Management_App
cd LSOC_Management_App
git remote set-url origin https://github.com/LittleEngineerTT/LSOC_Management_App.git
git push -u origin codex/project-handoff-2026-10-09
```

Une archive lsoc-handoff.tar.gz fournit aussi les deux documents sans métadonnées Git. Le bundle et l'archive sont des artefacts de transfert, pas des fichiers à ajouter au dépôt.
