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
docker compose exec api lsoc create-admin --username votre-identifiant --first-name VotrePrénom
```

Pour ajouter les données facultatives destinées au développement du front :

```sh
docker compose exec api lsoc seed-demo --admin-username votre-identifiant
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
.venv/bin/lsoc create-admin --username votre-identifiant --first-name VotrePrénom
.venv/bin/uvicorn app.main:app --reload
```

Pour utiliser le `.env` de la racine lors d’un lancement depuis `backend/`, copier sa configuration dans `backend/.env`, ou exporter les variables `LSOC_*` nécessaires. La configuration utilise le `.env` du répertoire de lancement. Lancer le worker dans un autre terminal avec `.venv/bin/lsoc-worker` et la même configuration. L’API n’exécute aucune tâche périodique elle-même.

La V1 couvre comptes/invitations, rôles cumulables, rattachements joueur/coach, catalogue, événements, récurrences, capacité, blocages, demandes, historique, suivis, questions privées, notifications et FFVB. Les séances peuvent être ouvertes à certaines sections : leurs adhérents s’y inscrivent jusqu’à la limite fixée par un administrateur.

## Contrat et intégration du frontend

Consulter [le guide API](docs/backend-api.md). La connexion retourne les données du compte et un jeton CSRF ; les cookies de session sont envoyés avec `credentials: "include"`. Le frontend de développement est autorisé à `http://localhost:5173`. En production, le même domaine servira le frontend à la racine et l’API sous `/api`.

Réexporter les types après une modification des routes :

```sh
backend/.venv/bin/lsoc export-openapi --output backend/openapi.json
```

Le frontend React/TypeScript dans `frontend/` couvre maintenant les parcours d’authentification et la coque de l’application. `backend/openapi.json` reste le contrat du backend.

## Frontend : authentification et accueil

Avec le backend Compose démarré, lancer le frontend depuis un autre terminal :

```sh
cd frontend
nvm install
nvm use
npm ci
npm run dev
```

Si Node est déjà installé, utiliser une version compatible avec `.nvmrc` (Node 22, au moins 22.13). Aucune installation de nvm n’est effectuée par le projet. Ouvrir http://localhost:5173. Le serveur Vite transmet `/api` au backend local sur le port 8000 ; les cookies restent sur le même hôte, sans configuration supplémentaire. Pour tester sur un téléphone du même réseau local, utiliser `npm run dev -- --host 0.0.0.0` et l’adresse IP de la machine sur le port 5173. Les liens envoyés par e-mail utilisent `LSOC_FRONTEND_URL`.

Parcours livrés : connexion par identifiant (qui peut être une adresse e-mail, sans vérification), activation par invitation avec choix de l’identifiant, réinitialisation par un lien généré par l’administrateur et transmis par lui. Aucun e-mail d’authentification n’est envoyé ; l’adresse de notification, facultative, se règle dans Mon profil. Les e-mails de notification de développement sont consultables dans Mailpit : http://localhost:8025. Les mots de passe et jetons ne sont pas conservés dans localStorage/sessionStorage ; la session utilise les cookies du backend, et la déconnexion transmet le jeton CSRF.

Après connexion, l’utilisateur arrive sur `/app`, section Accueil : prochains rendez-vous et notifications. Le menu vertical propose Planning (semaine du club, détail, suivi, questions, modifications et demandes, création d’événements et de séries par les administrateurs), Gymnases (occupation et disponibilités), Messagerie (questions privées) et Administration pour les administrateurs. En haut à droite : Mon planning, Mes sections et options du profil avec déconnexion. Détail dans la [spécification des sections](docs/superpowers/specs/2026-10-10-club-sections-design.md). Sur téléphone, le menu vertical s’ouvre par le bouton en haut à gauche ; les accès du haut gardent leurs noms accessibles quand seuls leurs pictogrammes sont visibles.

Les formulaires, confirmations et menus sont conçus pour 320 px et plus. Les mutations sont dans les handlers ; les effets servent à synchroniser avec le serveur ou le navigateur, selon le [guide React fourni](https://react.dev/learn/you-might-not-need-an-effect). Les formulaires et menus sont réinitialisés par clés React quand on change de parcours/section.

Vérifications du frontend depuis `frontend/` :

```sh
npm run lint
npm run format:check
npm test
npm run build
mkdir -p .cache/tmp
PLAYWRIGHT_BROWSERS_PATH=.cache/ms-playwright npm exec -- playwright install chromium --only-shell
npm run test:e2e
```

Les tests navigateur utilisent des réponses API contrôlées et ne modifient pas la base du club. Ils couvrent ordinateur/téléphone et 14 résolutions de 320 à 2560 px ; les traces d’échec sont dans `frontend/test-results/`. Le build est généré dans `frontend/dist/`. Le futur serveur de production devra servir `index.html` pour les routes du frontend (`/app`, `/reset-password`, etc.) et transmettre `/api` à FastAPI. `npm run preview` sert seulement les fichiers construits ; il ne remplace pas ce serveur de production et son proxy API.

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

Le backend a été vérifié sur PostgreSQL, y compris en HTTP et SMTP réels. Les conteneurs démarrés par l’utilisateur ont ensuite servi à vérifier les parcours réels du frontend avec l’API, le worker et Mailpit. Le frontend dispose de 23 tests unitaires, de 10 scénarios Chromium et d’une matrice de 14 résolutions ; lint, formatage, TypeScript strict et build sont vérifiés. Aucun déploiement, commit ou envoi GitHub n’a été effectué.
