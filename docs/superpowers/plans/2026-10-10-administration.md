# Administration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Livrer une administration utilisable pour toutes les opérations administrateur de l’API V1.

**Architecture:** Ajouter un module frontend d’administration avec client API authentifié, ressources réseau annulables et écrans séparés. Conserver les sessions, la coque et les composants existants ; toutes les mutations passent par les événements utilisateur.

**Tech Stack:** React 19, TypeScript strict, Vite, Vitest, Playwright ; aucune nouvelle dépendance.

**Spec:** `docs/superpowers/specs/2026-10-10-administration-design.md`

## Global Constraints

- Écritures limitées au dossier projet, sans changement des tests existants.
- Session cookies et CSRF, données privées et invitations jamais stockées dans localStorage/sessionStorage.
- Interface française utilisable de 320 à 2560 px ; dates en Europe/Paris.
- Autonomie demandée : réalisation dans le checkout courant sans commits ni demandes de validation de réalisation.

## Review Focus

- Session expirée au milieu d’une mutation : connexion et aucune confirmation erronée.
- Création réussie suivie d’un rechargement échoué : ne pas suggérer de recréer le compte.
- Révocation/régénération : ancien lien retiré et lien disponible seulement en mémoire.
- Catalogues vides, comptes inactifs et objets liés : formulaires utilisables ou indication précise.
- Conflit de version/capacité et changement d’heure : aucune mutation automatique ni conversion dans le fuseau navigateur.

### Task 1 : Ressources et utilisateurs

- [ ] Ajouter des tests de création avec invitation/CSRF, erreur, rattachements et session expirée ; observer leur échec.
- [ ] Créer `frontend/src/admin/api.ts`, `types.ts`, `data.tsx`, `ui.tsx`, `UsersPanel.tsx` et `AdminPage.tsx`. Exposer `useAdmin()` et `useResource<T>(path, paginated)` ; intégrer `/app/administration`, retirer Accueil du menu.
- [ ] Vérifier les nouveaux tests et les tests existants.

### Task 2 : Catalogue et indisponibilités

- [ ] Ajouter les tests de capacité, suppression liée et formulaires vides.
- [ ] Créer `CatalogPanels.tsx` et `BlocksPanel.tsx` avec formulaires typés et confirmation de suppression ; dates via `time.ts`.
- [ ] Vérifier les parcours catalogue et dates Europe/Paris.

### Task 3 : FFVB, validations et e-mails

- [ ] Ajouter les tests des erreurs de synchronisation, résolution explicite et reprise d’e-mail.
- [ ] Créer `FFVBPanel.tsx` et `OperationsPanels.tsx` en utilisant les routes documentées.
- [ ] Vérifier les charges utiles et les états de reprise.

### Task 4 : Cadrage du planning

- [x] Décision utilisateur : réserver événements, séries et historique à la future sous-application Planning. Retirer l’onglet Événements ; les validations restent administratives.

### Task 5 : Présentation et validation

- [ ] Ajouter `admin.css`, contrôles navigateur desktop/mobile et matrice de résolutions.
- [ ] Exécuter tests, lint, format et build ; vérifier les opérations réelles sur des données temporaires nettoyées.
- [ ] Faire relire le module, corriger les problèmes importants, mettre à jour README et REPRISE avec les preuves de validation.

## Journal

- Cadrage : réutilisation de l’architecture et du contrat existants ; pas de nouvelle décision architecturale. L’autonomie demandée remplace les validations de réalisation des skills.
- Checkout : le frontend est encore non suivi et contient le travail de la session précédente ; travailler ici conserve ces changements et la prévisualisation existante.
