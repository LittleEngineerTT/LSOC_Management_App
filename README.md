# LSOC Management App

Backend V1 pour les plannings des sections de volley, l’occupation des gymnases et la synchronisation FFVB. API FastAPI sous `/api/v1`, PostgreSQL, worker Python séparé et file persistante en base. Le frontend React/TypeScript pourra utiliser le contrat [OpenAPI](backend/openapi.json).

## Démarrage local avec Docker Compose

Prérequis : Docker avec Compose. Depuis la racine :

```sh
cp .env.example .env
docker compose up --build -d
```

Les migrations s’exécutent avant le démarrage de l’API et du worker. La base commence vide. Créer le premier administrateur avec un mot de passe saisi de façon masquée :

```sh
docker compose exec api lsoc create-admin --email votre-adresse@example.org --first-name VotrePrénom
```

Pour ajouter les données facultatives destinées au développement du front :

```sh
docker compose exec api lsoc seed-demo --admin-email votre-adresse@example.org
```

Cette commande ajoute une section, un gymnase de trois terrains, une équipe, un entraînement et la configuration FFVB fournie. Les données portent le préfixe « Démonstration ». La source FFVB reste désactivée jusqu’à configuration explicite afin d’éviter un import automatique dans un gymnase fictif. La commande peut être relancée sans dupliquer ces données.

- API et Swagger : http://localhost:8000/docs
- Contrat : http://localhost:8000/openapi.json
- Santé PostgreSQL/API : http://localhost:8000/api/v1/health
- Boîte de réception des e-mails de développement : http://localhost:8025

Mailpit reçoit les e-mails du worker ; aucune adresse externe n’est contactée pour les envois de développement. Les ports sont exposés uniquement sur l’interface locale. Les données PostgreSQL sont persistées dans le volume Docker `postgres-data`.

PostgreSQL est accessible depuis l’hôte sur `127.0.0.1:5433`, afin de cohabiter avec une installation locale utilisant déjà `5432`. L’API et le worker utilisent le port interne `5432` du conteneur. Si `5433` est aussi occupé, choisir un autre port dans `LSOC_POSTGRES_PORT` du fichier `.env` et adapter `LSOC_DATABASE_URL` pour les commandes Python exécutées sur l’hôte. Après une modification, relancer `docker compose up -d`.

```sh
docker compose logs -f api worker
docker compose down
```

`down` conserve le volume et les données. Le fichier `.env` est ignoré par Git.

## Développement Python sans conteneur

Python 3.12 minimum ; les dépendances livrées sont verrouillées et vérifiées avec Python 3.13 sous Linux. PostgreSQL doit être démarré et accessible avec l’URL de `.env`.

```sh
python3.13 -m venv backend/.venv
backend/.venv/bin/pip install -r backend/requirements-dev.lock
backend/.venv/bin/pip install --no-deps -e backend
cd backend
.venv/bin/alembic upgrade head
.venv/bin/lsoc create-admin --email votre-adresse@example.org --first-name VotrePrénom
.venv/bin/uvicorn app.main:app --reload
```

Pour utiliser le `.env` de la racine lors d’un lancement depuis `backend/`, copier sa configuration dans `backend/.env`, ou exporter les variables `LSOC_*` nécessaires. La configuration utilise le `.env` du répertoire de lancement. Lancer le worker dans un autre terminal avec `.venv/bin/lsoc-worker` et la même configuration. L’API n’exécute aucune tâche périodique elle-même.

La V1 couvre comptes/invitations, rôles cumulables, rattachements joueur/coach, catalogue, événements, récurrences, capacité, blocages, demandes, historique, suivis, questions privées, notifications et FFVB. Les inscriptions aux séances sont prévues pour la V2.

## Contrat et intégration du frontend

Consulter [le guide API](docs/backend-api.md). La connexion retourne les données du compte et un jeton CSRF ; les cookies de session sont envoyés avec `credentials: "include"`. Le frontend de développement est autorisé à `http://localhost:5173`. En production, le même domaine servira le frontend à la racine et l’API sous `/api`.

Réexporter les types après une modification des routes :

```sh
backend/.venv/bin/lsoc export-openapi --output backend/openapi.json
```

Aucun frontend n’a encore été créé. `backend/openapi.json` permet de générer ses types et son client TypeScript.

## Vérifications

Utiliser exclusivement une base PostgreSQL dédiée : la vérification efface son schéma `public`, et les fixtures recréent les tables entre les tests. Les tests doivent s’exécuter séquentiellement.

Depuis la racine, avec un PostgreSQL local de test :

```sh
LSOC_TEST_DATABASE_URL='postgresql+psycopg://lsoc:lsoc@localhost:5432/lsoc_test' \
LSOC_TEST_DATABASE_CONFIRMED=yes \
backend/.venv/bin/python backend/scripts/verify.py
```

Le script vérifie les tests d’intégration PostgreSQL, les migrations aller-retour, le SMTP réel de test, Ruff, le typage strict, les données de démonstration et un serveur HTTP réel sur le port 18000. Le test SMTP utilise le port local 8026. La CI fournit une base PostgreSQL 16 dédiée. Dans l’environnement de réalisation, PostgreSQL 14 et Python 3.13 ont été utilisés, avec les données et journaux de test dans le dossier projet.

## Choix de fonctionnement

Les réservations utilisent des intervalles `[début, fin)` : deux séances adjacentes ne se chevauchent pas. Les écritures prennent des verrous transactionnels PostgreSQL ; la V1 sérialise les mutations du planning à l’échelle du club, puis verrouille les gymnases concernés dans un ordre stable. Les récurrences conservent l’heure locale Europe/Paris ; les lectures PostgreSQL utilisent UTC. Les demandes et les modifications directes utilisent un numéro de version pour éviter les écrasements silencieux.

Les mots de passe sont hachés avec Argon2id. Les jetons d’invitation, récupération et session sont stockés sous forme de condensats ; les liens présents dans les travaux d’e-mail sont chiffrés avec un secret commun à l’API et au worker. Les corps de travaux envoyés sont effacés. La suppression d’un compte purge ses données actives et ses liens historiques ; seul son prénom reste associé aux actions conservées.

Le worker réessaie les e-mails avec un délai croissant, jusqu’à huit échecs. L’API admin permet d’inspecter la file et de réactiver un envoi. Une panne FFVB ne bloque pas les e-mails ni les autres sources. Les jobs sont dédupliqués en base ; un crash après acceptation SMTP et avant validation PostgreSQL peut exceptionnellement renvoyer le même message, avec le même `Message-ID`.

Pour une installation de production, définir `LSOC_ENVIRONMENT=production`, un secret aléatoire `LSOC_SECRET_KEY` d’au moins 32 caractères, `LSOC_COOKIE_SECURE=true`, un `LSOC_FRONTEND_URL` HTTPS et les paramètres SMTP réels. L’API et le worker doivent partager le même secret. La terminaison HTTPS, les sauvegardes et leur durée de conservation relèvent du futur hébergement ; la composition fournie cible le développement local.

## État de livraison

Le backend a été vérifié sur PostgreSQL, y compris en HTTP et SMTP réels. La configuration Compose a été validée avec `docker compose config --quiet`. Les images Docker n’ont pas été construites ni les conteneurs lancés dans cette session ; ces opérations écrivent dans le stockage Docker hors du projet. Aucun déploiement, commit ou envoi GitHub n’a été effectué.
