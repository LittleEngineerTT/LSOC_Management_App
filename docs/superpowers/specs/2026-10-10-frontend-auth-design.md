# Authentification frontend

## Périmètre

Livrer les parcours d'authentification, en français, sur ordinateur et téléphone. Utiliser les choix déjà validés : dossier `frontend/`, React, TypeScript strict et Vite ; API FastAPI existante, sessions par cookies. La directive complémentaire de l'utilisateur ajoute la coque de l'application après connexion : accueil protégé, menu vertical à gauche avec icônes de sous-applications, accès profil/sections/mon planning en haut à droite. Le contenu central de toutes les sections reste vide ; aucun écran métier dans cette livraison.

## Parcours et contrat

- `/login` et `/` : connexion e-mail/mot de passe, erreur d'identifiants, restauration de session avec `GET /api/v1/auth/me`. Après connexion, rediriger vers `/app` (Accueil).
- `/app` et `/app/:section` : coque protégée, navigation active pour accueil/planning/gymnases/messagerie et administration pour les administrateurs, accès haut droit mon planning/mes sections/profil et déconnexion. Zone centrale vide avec nom accessible. Une session absente redirige vers la connexion ; un échec réseau propose une reprise sans traiter le compte comme déconnecté.
- `/forgot-password` : demande par e-mail et confirmation neutre, que le compte existe ou non.
- `/reset-password?token=…` : nouveau mot de passe et confirmation, minimum 12 et maximum 128 caractères, lien manquant ou expiré, retour à la connexion après succès.
- `/activate?token=…` : e-mail, mot de passe et confirmation pour accepter une invitation. Après succès, expliquer qu'une vérification par e-mail reste nécessaire.
- `/verify-email?token=…` : vérification déclenchée explicitement par un bouton, succès et lien invalide/expiré. Éviter une mutation au chargement ou un double appel React StrictMode.
- `/resend-verification` : nouvel e-mail de vérification et confirmation neutre.

Les routes et champs restent ceux du contrat backend. Tous les appels utilisent `credentials: include`. Aucun mot de passe ni jeton de session dans localStorage/sessionStorage. Déconnexion avec `X-CSRF-Token`, relu depuis le cookie `lsoc_csrf` après rechargement. Les liens porteurs de jetons utilisent `Referrer-Policy: no-referrer` ; les jetons ne sont pas copiés dans un stockage navigateur. Aucun identifiant prérempli dans le produit.

## Interface

Une coque commune : panneau club bleu nuit, illustration vectorielle de terrain/ballon, accent rouge, zone de formulaire claire. Navigation réelle par URL, liens de retour, champs étiquetés, affichage/masquage du mot de passe, validation française, chargement, erreurs lisibles et annonces accessibles. Focus sur le titre à chaque changement de page. Les confirmations remplacent le formulaire après une opération réussie ; les soumissions concurrentes sont empêchées. Requêtes annulées au départ d'une page, délai de réponse limité, erreurs réseau et 429 traitées.

## Exécution locale

Serveur Vite `localhost:5173`, proxy `/api` vers `127.0.0.1:8000`. Les liens des e-mails du backend pointent déjà sur `localhost:5173`. En production, les fichiers du build seront servis sur le même domaine que `/api` ; aucune modification de l'architecture n'est nécessaire.

## Vérification

Nouveaux tests frontend des parcours, cookies/CSRF, erreurs réseau/validation, liens invalides et session restaurée. Conserver tous les tests backend existants. Vérifier TypeScript, build, navigateur desktop/mobile et une connexion au backend Docker réel. Caches npm et navigateur dans le projet ; aucune installation système. Les métadonnées Git protégées restent intactes.
