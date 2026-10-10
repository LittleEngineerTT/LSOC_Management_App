# Reprise du projet LSOC Management App

## État du projet

Le backend V1 est maintenant implémenté dans `backend/` : FastAPI, PostgreSQL, migrations Alembic, sessions/CSRF, invitations et comptes, catalogue, planning/récurrences/capacités, validations et historique, suivis, messagerie privée, notifications, worker SMTP et synchronisation FFVB. Le frontend n'est pas encore créé.

Entrées de reprise : [README](../README.md), [guide API frontend](backend-api.md), [contrat OpenAPI](../backend/openapi.json), [plan d'implémentation](superpowers/plans/2026-10-09-backend-v1.md). La configuration de développement est dans `compose.yaml` et `.env.example` ; `lsoc create-admin` crée le premier administrateur sans identifiants prédéfinis. `lsoc seed-demo` ajoute facultativement les données de démonstration.

Dernière vérification : 37 tests passent sur PostgreSQL 14 / Python 3.13, migrations aller-retour et comparaison du schéma, concurrence, HTML FFVB réellement récupéré, SMTP réel de test, Ruff, mypy strict et parcours HTTP réel. La configuration Compose est validée ; les images Docker n'ont pas été construites et aucun conteneur n'a été lancé. Un avertissement de dépréciation tiers Starlette/httpx subsiste dans les tests. La commande reproductible est `backend/.venv/bin/python backend/scripts/verify.py`, avec une base dédiée uniquement : le script efface son schéma.

Architecture confirmée : monolithe modulaire FastAPI, worker séparé et file PostgreSQL sans Redis ; Docker Compose local, même domaine frontend/API en production ; base vide et données facultatives de démonstration. La source FFVB initiale est celle décrite ci-dessous. Les tests existants ont été conservés et les ajouts ont été autorisés par l'utilisateur. Aucune question de réalisation supplémentaire n'est nécessaire ; seuls les cadrages et actions hors du projet doivent être soumis à l'utilisateur.

La spécification se trouve dans [2026-10-09-lsoc-management-design.md](superpowers/specs/2026-10-09-lsoc-management-design.md). Elle rassemble les règles métier décidées avec l'utilisateur et distingue les propositions techniques encore à relire. Le choix de PostgreSQL a été confirmé après sa rédaction.

Dépôt cible : https://github.com/LittleEngineerTT/LSOC_Management_App.git

Stack demandée : backend Python FastAPI avec typage strict, frontend React TypeScript dans un dossier séparé, PostgreSQL et nvm pour Node. `backend/` est créé ; `frontend/` reste à construire.

## Prochaine étape

1. Démarrer la composition locale et créer le premier administrateur selon le README.
2. Construire le frontend à partir de `backend/openapi.json` et du guide API.
3. Avant un déploiement, cadrer hébergement, HTTPS, SMTP réel et conservation des sauvegardes. Les inscriptions aux séances ouvertes restent prévues pour la V2.

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
