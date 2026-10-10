# Contrat API V1 pour le frontend

La source des schémas est [backend/openapi.json](../backend/openapi.json), également exposée par l’API à `/openapi.json`. Swagger se trouve à `/docs`. Les routes métier commencent par `/api/v1`. JSON, interface métier française, dates ISO 8601 avec fuseau, identifiants opaques sous forme de chaînes. Les dates sans fuseau sont rejetées. Les horaires doivent être affichés dans Europe/Paris.

## Connexion et erreurs

```ts
const loginResponse = await fetch("http://localhost:8000/api/v1/auth/login", {
  method: "POST",
  credentials: "include",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email, password }),
});
if (!loginResponse.ok) throw new Error("Connexion refusée");
const { user, csrf_token } = await loginResponse.json();

// Pour toutes les mutations authentifiées :
const response = await fetch("http://localhost:8000/api/v1/events/" + eventId, {
  method: "PATCH",
  credentials: "include",
  headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf_token },
  body: JSON.stringify({ base_version: event.version, changes: { title: "Séance déplacée" } }),
});
```

Le cookie `lsoc_session` est HttpOnly. Le jeton CSRF est aussi disponible dans le cookie `lsoc_csrf`, lisible après rechargement sur le même hôte. Connexion : `POST /auth/login`, état courant : `GET /auth/me`, déconnexion : `POST /auth/logout`. Une expiration renvoie 401 ; le frontend revient à la connexion. La protection CSRF renvoie 403 et ne doit pas être contournée. Le `POST /auth/logout` exige également le jeton CSRF.

| Statut | Signification |
| --- | --- |
| 200 / 201 / 202 | Lecture ou modification / création / activation ou récupération en attente |
| 204 | Suppression, retrait de suivi, déconnexion ; aucun corps JSON |
| 400 | Lien d’activation/vérification/récupération invalide ou expiré |
| 401 | Connexion nécessaire ou identifiants invalides |
| 403 | Permission ou jeton CSRF insuffisant |
| 404 | Ressource inexistante |
| 409 | Version obsolète, capacité dépassée, confirmation FFVB nécessaire, doublon ou ressource liée |
| 422 | Entrée invalide ; erreurs de validation dans `detail` |
| 429 | Limitation des tentatives d’authentification ; `Retry-After` |

Les erreurs métier utilisent `{"detail": "message"}` ou un objet dans `detail`. Pour la capacité : `detail.code="capacity_exceeded"` avec `segments`, ou `events` pour une série. Chaque segment contient dates, occupation, disponibilité et dépassement. Pour une version obsolète : `detail.code="stale_version"` et `current_version`. Recharger l’événement et demander à l’utilisateur de réexaminer sa modification. Un admin peut confirmer un dépassement avec `force=true` ; le forçage est historisé.

## Comptes et catalogue

| Routes | Usage |
| --- | --- |
| `GET/POST /users`, `GET/PUT/DELETE /users/{id}` | Administration des comptes ; aucun e-mail privé exposé par ces réponses |
| `POST/DELETE /users/{id}/invitation` | Régénérer un lien ou révoquer les liens d’un compte inactif |
| `POST /auth/activate` | `{token,email,password}` ; programme un e-mail de vérification |
| `POST /auth/verify-email` | `{token}` ; active le compte après vérification |
| `POST /auth/resend-verification` | `{email}` ; réponse identique pour adresse connue ou inconnue |
| `POST /auth/forgot-password` et `/auth/reset-password` | `{email}` puis `{token,password}` ; révoque les sessions |
| `GET /profiles/{id}` | Profil visible : identifiant, prénom, catégorie ; aucun rôle, droit privé ou e-mail |
| `GET/POST /users/{id}/assignments`, `DELETE /users/{id}/assignments/{assignment}` | Rattachements joueur/coach ; lecture pour le compte concerné ou l’admin |
| `PUT /preferences` | Préférences d’e-mail `followed_email`, `referent_email`, `admin_email` |
| `GET/POST /sections`, `PUT/DELETE /sections/{id}` | Groupes de pratique |
| `GET/POST /teams`, `PUT/DELETE /teams/{id}` | Équipes rattachées à une section et référent par défaut des matchs |
| `GET/POST /gymnasiums`, `PUT/DELETE /gymnasiums/{id}` | Gymnases et capacité entière positive |

Rôles cumulables : `member`, `coach`, `admin`. Catégories : `M18`, `M21`, `adult`, `M15`, `M13`, `M11`, `M9`. Un compte avec le rôle `member` doit être M18 ou plus ; un coach seul n’a pas cette restriction. Invitation : sept jours, usage unique. Vérification d’e-mail : 24 heures. Récupération : une heure. Mot de passe : 12 à 128 caractères. Le premier admin se crée avec la commande locale `lsoc create-admin`.

`POST /users` retourne `user`, `invitation_token`, `invitation_url` : le lien est copiable par l’admin. Une invitation n’accorde aucun accès au planning. Régénération et vérification concurrentes sont sérialisées ; un compte actif ne peut plus être réinvité.

Les suppressions de sections, équipes et gymnases encore utilisés sont refusées par 409. Les comptes sont supprimés avec purge des données privées, des rattachements, suivis et travaux d’e-mail. Les événements deviennent sans référent et sont signalés aux admins ; les actions historiques conservent seulement le prénom de leur auteur.

## Planning et validation

`GET /events` accepte `starts_at`, `ends_at`, `gymnasium_id`, `section_id`, `series_id`, `include_cancelled`, `limit` et `offset`. Les deux dates filtrent les événements chevauchant la période. Les listes paginées acceptent un maximum de 500 éléments et retournent un tableau. L’ordre du planning est chronologique.

Créer un événement, admin uniquement :

```json
{
  "title": "Entraînement loisir",
  "kind": "training",
  "section_ids": ["section-id"],
  "gymnasium_id": "gymnasium-id",
  "location": "",
  "starts_at": "2026-10-15T18:00:00+02:00",
  "ends_at": "2026-10-15T20:00:00+02:00",
  "courts": 2,
  "referent_id": "active-user-id",
  "direct_edit": false
}
```

Types : `training`, `match`, `other`. Un événement extérieur utilise `gymnasium_id=null`, un `location` textuel et `courts=0`. Un événement dans un gymnase local réserve au moins un terrain. Le droit `direct_edit` appartient à l’événement ; le changement de référent le remet à false sauf attribution explicite par un admin.

| Routes | Usage |
| --- | --- |
| `GET/POST /events`, `GET/PATCH /events/{id}` | Consulter, créer, modifier ; `PATCH` reçoit `base_version` et `changes` |
| `POST /events/{id}/change-requests` | Proposer des changements sans modifier le planning |
| `GET /change-requests` | Admin : toutes les demandes ; adhérent : ses propres demandes |
| `POST /change-requests/{id}/decision` | Admin : `{accept,reason,force,acknowledge_ffvb}` ; décision datée et attribuée |
| `GET /events/{id}/history` | Révisions, valeurs avant/après, origine, auteur, forçage et décisions |
| `POST /events/{id}/history/{revision}/restore` | Admin : `base_version` et liste explicite `fields` à restaurer |
| `POST /series` | `{event,until,force}` ; occurrences hebdomadaires matérialisées, deux ans maximum |
| `PATCH /series/{id}` | `from_event_id`, `base_version`, `changes`, `include_exceptions`, `force` |
| `GET/POST /availability-blocks`, `PUT/DELETE /availability-blocks/{id}` | Indisponibilités partielles ou totales ; admin pour les mutations |
| `GET /gymnasiums/{id}/availability?starts_at=…&ends_at=…` | Capacité et segments d’occupation de la période |

Le statut de coach ne suffit pas pour modifier une séance : il faut être son référent. Un référent sans `direct_edit` passe par une demande. Un admin accepte ou refuse ; une demande obsolète doit être réexaminée. Les champs d’administration restent réservés aux admins même pour un référent autorisé.

Annuler un événement avec `changes.cancelled=true` libère sa réservation et conserve son historique. Une modification individuelle d’une occurrence crée une exception. Une modification de série conserve par défaut les exceptions et vérifie les droits sur chaque occurrence. Les déplacements horaires appliquent le même décalage d’heure locale à toute la sélection. Les réservations sont vérifiées sur le résultat final de la série, puis appliquées atomiquement. Les heures inexistantes au passage à l’heure d’été sont refusées.

Un blocage comporte `gymnasium_id`, `title`, `starts_at`, `ends_at`, `courts`. Il peut créer un dépassement sur des événements existants ; les admins sont alors alertés. Une baisse de capacité d’un gymnase déclenche également ces alertes. Les disponibilités exposent toujours une valeur au moins nulle et une quantité excédentaire distincte.

## Suivis, questions et notifications

| Routes | Usage |
| --- | --- |
| `GET /follows` | Suivis du compte connecté |
| `POST/DELETE /events/{id}/follow` et `/series/{id}/follow` | Suivre une occurrence ou les occurrences présentes/futures d’une série |
| `POST /events/{id}/questions` | Créer/réutiliser son fil et envoyer `{body}` |
| `GET /questions`, `GET/POST /questions/{id}/messages` | Lire les fils autorisés et répondre |
| `POST /questions/{id}/read` | Marquer les messages reçus comme lus |
| `GET /notifications`, `POST /notifications/{id}/read` | Notifications privées du compte connecté |
| `GET /admin/email-jobs?status=pending|failed|sent` | État technique des envois ; admin uniquement, aucun corps de message ni jeton exposé |
| `POST /admin/email-jobs/{id}/retry` | Relancer un envoi non livré après correction de la configuration SMTP |

Les questions sont privées entre l’adhérent auteur et les admins. Être référent ne donne aucun accès aux conversations privées. Révoquer `messaging_allowed` empêche d’écrire et laisse lire les échanges existants. Les réponses apparaissent dans le fil sans nouvelle catégorie d’e-mail adhérent. Les admins reçoivent l’alerte d’une nouvelle question.

Un utilisateur ne reçoit pas d’e-mail pour sa propre modification d’événement. Le référent est informé des modifications externes, selon sa préférence. Un suivi de série retiré ne supprime pas les suivis individuels explicites. Une vérification FFVB sans changement réel ne crée aucune notification de modification.

## FFVB

Créer d’abord une équipe rattachée à une section avec un référent actif. Configurer une association de gymnase, puis une source :

```json
{
  "team_id": "team-id",
  "season": "2026/2027",
  "entity": "PTIDF92",
  "pool": "BRC",
  "team_number": "6",
  "team_name": "LSO COLOMBES",
  "club_code": "0926620",
  "enabled": true,
  "interval_minutes": 15
}
```

Association locale : `POST /ffvb/gym-mappings` avec `{"official_name":"GYMNASE AMBROISE PARE","gymnasium_id":"gymnasium-id"}`. Les autres sources restent configurables via l’API.

| Routes | Usage |
| --- | --- |
| `GET/POST /ffvb/sources`, `PUT /ffvb/sources/{id}` | Administration des sources et de leur fréquence |
| `POST /ffvb/sources/{id}/sync` | Vérification immédiate ; consulter `last_error` et `last_success_at` dans la réponse |
| `GET/POST /ffvb/gym-mappings`, `PUT/DELETE /ffvb/gym-mappings/{id}` | Correspondances des noms FFVB avec les gymnases locaux |
| `GET /ffvb/matches?event_id=…` | État officiel, dernière vérification, protections, suspension, désactivation et absence du match |
| `GET /ffvb/conflicts` | Conflits ouverts visibles aux admins |
| `POST /ffvb/conflicts/{id}/resolve` | `accept_ffvb`, `suspend_48h` ou `disable` |
| `POST /ffvb/matches/{id}/reactivate` | Réactiver la vérification de ce match |
| `GET/PUT /ffvb/defaults` | Marges et terrains des futurs matchs ; aucun effet rétroactif |

Un match est identifié par saison, entité et code. À domicile, trois terrains par défaut sont réservés de 75 minutes avant à 150 minutes après le coup d’envoi. `kickoff_at` représente l’horaire officiel ou sa valeur locale protégée. `starts_at` et `ends_at` représentent la réservation. `match_courts` conserve le réglage de terrains du match même si le lieu devient inconnu ; `courts` représente l’occupation effective du gymnase local. `occupancy_unknown=true` signale un match à domicile sans association locale. Les matchs extérieurs n’occupent aucun terrain du club.

Pour modifier date/heure/lieu d’un match importé : admin uniquement, `acknowledge_ffvb=true`, modification de `kickoff_at`, `gymnasium_id` ou `location`. Modifier les marges via `before_minutes`/`after_minutes` ; les horaires de réservation d’un match importé ne se modifient pas directement. Ces réglages sont conservés aux synchronisations suivantes.

Les champs officiels modifiés localement restent protégés. Une divergence ultérieure conserve les valeurs manuelles et ouvre un conflit ; son e-mail est envoyé uniquement à l’auteur de la modification. Une suspension dure 48 heures et conserve la protection. La vérification reprend automatiquement ; une divergence persistante rouvre le conflit. Les résolutions, suspensions, désactivations et réactivations sont historisées avec l’auteur et la date.

Une erreur réseau, une page invalide ou un match disparu conservent le planning et la dernière vérification réussie. Les matchs absents sont signalés, sans suppression automatique. Un changement officiel non protégé est appliqué même s’il provoque un dépassement de capacité, avec alerte admin. La fréquence dépend du worker actif ; la FFVB ne fournit pas ici de flux instantané.
