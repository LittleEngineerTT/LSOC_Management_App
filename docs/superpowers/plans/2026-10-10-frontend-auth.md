# Plan frontend authentification

Spécification : `docs/superpowers/specs/2026-10-10-frontend-auth-design.md`. Réalisation autonome dans le projet, conformément aux instructions utilisateur ; React/TypeScript/Vite sont déjà validés. Exécution directe. Aucun test existant à modifier.

## Tâche 1 : socle et nouveaux tests

- Créer `frontend/package.json`, configs Vite/TypeScript/Vitest et point d'entrée HTML français.
- Ajouter des tests React Testing Library qui exercent les formulaires et les requêtes réellement déclenchées par leurs boutons. Vérifier connexion/session/déconnexion CSRF, récupération, réinitialisation et invitation avec confirmation, vérification explicite, renvoi de lien, erreurs 400/401/429 et réseau, et absence de jeton.
- Installer les dépendances avec cache local et observer l'échec lié au frontend manquant.

## Tâche 2 : intégration et écrans

- `src/api/auth.ts` : contrats limités à l'authentification, requêtes JSON avec cookies, timeout et annulation, erreurs françaises ; ne pas stocker de secrets.
- `src/auth/AuthApp.tsx` : pages routées, formulaires ; événements uniquement, aucune mutation automatique de lien.
- `src/auth/session.tsx` : session partagée restaurée, connexion et déconnexion CSRF, protection des routes `/app`.
- `src/app/AppShell.tsx` : accueil après connexion, menu vertical avec icônes, accès haut droit profil/sections/mon planning, contenu central vide. Nouvelle directive utilisateur : adapter les nouveaux tests de connexion à la redirection vers l'accueil et ajouter la protection de la coque.
- `src/auth/components.tsx`, `src/styles.css` : coque responsive, champs accessibles, boutons et confirmations cohérents.
- Relancer les nouveaux tests, corriger le produit jusqu'à réussite ; build TypeScript strict.

## Tâche 3 : navigateur et livraison

- Ajouter des tests navigateur ne modifiant pas la base réelle : routes API contrôlées pour invitation/récupération/vérification, navigation et mobile. Vérifier aussi la connexion/déconnexion avec le compte local créé précédemment sur le vrai backend, sans changer son mot de passe.
- Inspecter des captures desktop/mobile, vérifier clavier, erreurs et débordements.
- Faire relire le frontend, corriger les problèmes importants et relancer les vérifications appropriées.
- Documenter démarrage, scope et commandes dans README/reprise, ajouter contrôle CI frontend.

## Points de revue

Annulation de requêtes et anciennes réponses après navigation ; protection CSRF après restauration de session ; absence de double consommation d'un lien ; maintien de la confirmation neutre ; validation 12–128 caractères et correspondance des mots de passe ; absence de secrets dans le navigateur ou les artefacts livrés.

## Suivi

- Cadrage réalisé sur le périmètre demandé et les choix déjà validés.
- Node local 20.18 disponible ; Vite 6 compatible, sans modification de Node/nvm hors projet.
- Métadonnées Git protégées, travail dans le dossier projet existant ; pas de création de worktree ni de commit.

## Livraison et vérifications

- Tâche 1 : complète. Dépendances verrouillées et caches locaux ; nouveaux tests écrits avant le frontend. L'échec initial était l'absence du module AuthApp.
- Tâche 2 : complète. Authentification reliée à `/api`, session partagée et CSRF ; routes et pages séparées par responsabilité. Nouvelle directive : ajout de la coque protégée avec zone centrale vide et adaptation des nouveaux tests de connexion. Aucun test backend modifié.
- Tâche 3 : complète. 23 unitaires verts, lint/format/TypeScript/build verts ; 10 scénarios Chromium verts, 2 exclusions volontaires (menu mobile non applicable au desktop, matrice exécutée une fois). Six écrans et accueil contrôlés sur 14 résolutions 320–2560 px, captures inspectées dans le cache.
- Revue indépendante : annulation pendant lecture JSON et changement de jeton sur même route corrigés avec trois nouveaux tests observés rouges puis verts ; contrastes textes secondaires corrigés (4,67–5,19:1). Relecture favorable.
- Guide React suivi : valeurs dérivées au rendu, POST/navigation dans handlers, remise à zéro par key, effets pour serveur et DOM seulement. Jetons retirés de l'URL après succès ; confirmations sans secret dans le state de navigation.
- Navigateur/API/SMTP réels Docker : administrateur connecté/déconnecté avec restauration ; compte temporaire invité/activé par e-mail Mailpit, vérifié puis connecté ; récupération/reset par e-mail, anciennes sessions invalidées, nouvelle connexion validée. Compte temporaire supprimé, administrateur conservé inchangé.
- Aucun stockage de mots de passe dans le frontend, aucune installation système ou modification de Node/nvm hors du projet. La cible recommandée pour le frontend/CI est Node 22, minimum 22.13 ; les vérifications locales ont aussi fonctionné avec le Node 20.18 préinstallé (plus ancien que les engines déclarés de certains outils).
