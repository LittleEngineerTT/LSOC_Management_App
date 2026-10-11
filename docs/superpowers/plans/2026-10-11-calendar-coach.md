# Calendrier et demandes des coachs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Calendrier réactif, dates françaises avec heures sélectionnables, demandes coach validées par admin et inscriptions ouvertes à des équipes ou sections.

**Architecture:** Réutiliser les composants, sessions et API du projet. Calendrier purement frontend ; demandes de création dans un module backend dédié ; ajout d’une ouverture par équipe au modèle d’événement existant.

**Tech Stack:** React 19/TypeScript/Vite, FastAPI/SQLAlchemy/PostgreSQL/Alembic, Vitest/Playwright/Pytest.

**Spec:** `docs/superpowers/specs/2026-10-11-calendar-coach-design.md`

## Global Constraints

Écritures dans le projet ; tests existants figés sauf nouvelles directives ; aucune nouvelle dépendance ; cookies/CSRF ; France/Europe/Paris. Plan repris et commité par Claude le 11 octobre à la demande de l’utilisateur. Un seul processus backend de tests à la fois.

## Review Focus

- Aucun événement créé avant approbation, ni double événement lors de décisions concurrentes.
- Rôle ou rattachement retiré après dépôt : acceptation impossible, refus toujours possible.
- Ouverture par équipe n’ouvre pas toute sa section ; union avec les sections explicitement ouvertes.
- Multi-jours, fin exclusive à minuit, DST et collisions visuelles dans le calendrier.
- Champs français, date réelle, heures/minutes et API inchangée des indisponibilités.

### Task 1 : Backend demandes et ouverture par équipes

**Files:** créer `backend/app/api/event_requests.py`, migration `0007_coach_event_requests.py`, nouveaux tests `backend/tests/test_coach_event_requests.py`; modifier models, schemas, main, accounts purge, registrations et services/events.

**Interfaces:** `POST /event-requests` body `{team_id, title, kind, starts_at, ends_at, gymnasium_id, location, courts, registration_section_ids, registration_team_ids, registration_limit, note}`. Listes/GET réservés auteur ou admin. `GET /event-requests?status=pending` (status vide = tous), pagination limit/offset habituelle. `POST /event-requests/{id}/decision` body DecisionInput `{accept, reason, force, acknowledge_ffvb}` (dernier champ inutilisé). Vue `{id, team_id, actor_id, actor_name, proposal, note, status, decision, decider_name, decided_at, created_at, event_id}`. Ajouter `registration_team_ids` défaut [] à EventInput/Patch/View et ORM.

- [x] Écrire/observer tests droits coach/rattachement, demande sans création, acceptation unique, refus, révocation, capacité/forçage admin, éligibilité équipe et section, confidentialité/purge.
- [x] Implémenter transaction sous verrou planning, réutiliser create_event et notifications. Le body dérive section/referent/direct_edit côté serveur, aucun forçage coach. Revalider les objets lors de la décision.
- [x] Vérifier nouveaux tests ciblés puis Ruff/mypy ; exporter le contrat uniquement après intégration (root).

### Task 2 : Dates et heures françaises

**Files:** créer `frontend/src/admin/FrenchDateTimeField.tsx`, tests déjà créés `FrenchDateTimeField.test.tsx`; modifier ui.tsx, BlocksPanel.tsx et admin.css. Aucun autre fichier.

**Interface:** composant `{id, label, value, onChange, required?, disabled?, describedBy?}` : value ISO `YYYY-MM-DDTHH:mm`, affichage date français + sélection heure/minute. Type de champ ajouté `datetime-fr` aux FormField et rendu. Conserver le nom/label des champs Du/Au/Début/Fin et body API actuel. Les tests existants saisissent parfois ISO complet par `.type` ou `.fill` : accepter aussi cette saisie et l’afficher jj/mm/aaaa une fois complète.

- [x] Lire le test déjà RED (module absent), compléter de nouveaux tests avant implémentation si nécessaire.
- [x] Implémenter date française, sélecteur calendrier natif pour date, heures 00–23/minutes 00–59, sans effets de synchronisation. Pas de dépendances ; pas de changement des autres `datetime-local`.
- [x] Vérifier nouveaux tests, tests existants d’administration, typecheck et CSS mobile. Rapporter tout écart ; ne pas modifier les tests existants.

### Task 3 : Calendrier et intégration frontend

**Files:** calendarLayout.ts, CalendarNavigation.tsx, CalendarView.tsx, calendar.css, PlanningPage/MyPlanningPage/events/EventDetail, nouveaux tests de calendrier et navigateur. Frontend demandes : nouveau CoachEventRequests.tsx, EventProposalForm.tsx, admin EventRequestsPanel.tsx ; EventEditor/types pour ouverture équipe.

- [x] Écrire/observer tests calendrier RED.
- [x] Calendrier semaine/mois, origine FFVB/locale, filtres, fiches et planning personnel.
- [x] Formulaire coach réservé aux équipes rattachées ; ouverture équipes/sections avec limite et suivi des décisions ; admin validations inclut demandes de création.
- [x] Vérifications frontend/backend intégrées, revue indépendante, documents et OpenAPI. Aucun commit ni données métier ajoutées.

### Task 4 : Fermeture au clic extérieur

- [x] Ajouter de nouveaux tests RED pour les confirmations et le menu mobile.
- [x] Partager la détection du fond natif entre confirmations et détail d’événement ; fermer profil et menu mobile au clic extérieur.
- [x] Vérifier clic contenu, clic fond, glissement intérieur/extérieur, URL du détail et absence de suppression lors d’une fermeture.

### Task 5 : Disponibilités des gymnases en calendrier

**Files:** GymnasiumsPage.tsx ; nouveaux GymAvailabilityCalendar.tsx/gymCalendar.css, helpers purs et tests unitaires/navigateur.

- [x] Tests nouveaux RED pour semaine/mois, sélection, capacité et répartition à minuit.
- [x] Calendrier semaine/mois avec terrains libres/complets/excédentaires, événements FFVB/locaux et indisponibilités. Choix gymnase conserve la période/vue.
- [x] Vérifier dates Paris, bornes exclusives, liens détail, responsive et revue indépendante.

## Reprise du 11 octobre

À la demande de l’utilisateur, le travail a été repris par une autre session, qui l’a vérifié et complété :
- 82 tests backend sur PostgreSQL 14, dont les migrations aller-retour et `alembic check` ;
- 96 tests unitaires et les scénarios Chromium ;
- TypeScript, ESLint, Prettier, Ruff, mypy et build.

Ajouts faits pendant la reprise :
- `description` des événements (migration 0008), saisie dans la demande du coach et reprise à l’acceptation, distincte de la note adressée aux admins ;
- pastilles de non-lus dans le menu ;
- session glissante de 7 jours.
