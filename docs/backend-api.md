# Contrat API V1 pour le frontend

La source des schémas est [backend/openapi.json](../backend/openapi.json), également exposée par l’API à `/openapi.json`. Swagger se trouve à `/docs`. Les routes métier commencent par `/api/v1`. JSON, interface métier française, dates ISO 8601 avec fuseau, identifiants opaques sous forme de chaînes. Les dates sans fuseau sont rejetées. Les horaires doivent être affichés dans Europe/Paris.

## Connexion et erreurs

```ts
const loginResponse = await fetch("http://localhost:8000/api/v1/auth/login", {
  method: "POST",
  credentials: "include",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ username, password }),
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

Le cookie `lsoc_session` est HttpOnly. Le jeton CSRF est aussi disponible dans le cookie `lsoc_csrf`, lisible après rechargement sur le même hôte. Connexion : `POST /auth/login`, état courant : `GET /auth/me`, déconnexion : `POST /auth/logout`. La session expire après `LSOC_SESSION_IDLE_DAYS` jours sans activité (7 par défaut) : chaque requête authentifiée repousse l’échéance, au plus une fois par heure, et renouvelle alors les deux cookies. `GET /unread`, interrogé automatiquement, ne compte pas comme une activité. Une expiration renvoie 401 ; le frontend revient à la connexion. La protection CSRF renvoie 403 et ne doit pas être contournée. Le `POST /auth/logout` exige également le jeton CSRF.

| Statut | Signification |
| --- | --- |
| 200 / 201 / 202 | Lecture ou modification / création / activation ou récupération en attente |
| 204 | Suppression, retrait de suivi, déconnexion ; aucun corps JSON |
| 400 | Lien d’activation/récupération invalide ou expiré |
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
| `POST /auth/activate` | `{token,username,password}` ; active immédiatement le compte |
| `PUT /users/{id}/username` | Admin : changer un identifiant et révoquer les sessions |
| `POST /users/{id}/password-reset` | Admin : générer un lien de récupération à transmettre à l’utilisateur |
| `POST /auth/reset-password` | `{token,password}` ; révoque les sessions |
| `GET /profiles/{id}` | Profil visible : identifiant, prénom, catégorie ; aucun rôle, droit privé ou e-mail |
| `GET/POST /users/{id}/assignments`, `DELETE /users/{id}/assignments/{assignment}` | Rattachements joueur/coach ; lecture pour le compte concerné ou l’admin |
| `PUT /preferences` | Adresse `email` facultative et préférences `followed_email`, `referent_email`, `admin_email` |
| `GET/POST /sections`, `PUT/DELETE /sections/{id}` | Groupes de pratique |
| `GET/POST /teams`, `PUT/DELETE /teams/{id}` | Équipes rattachées à une section et référent par défaut des matchs |
| `GET/POST /gymnasiums`, `PUT/DELETE /gymnasiums/{id}` | Gymnases et capacité entière positive |

Rôles cumulables : `member`, `coach`, `admin`. Catégories : `M18`, `M21`, `adult`, `M15`, `M13`, `M11`, `M9`. Un compte avec le rôle `member` doit être M18 ou plus ; un coach seul n’a pas cette restriction. Invitation : sept jours, usage unique. Récupération : une heure. Mot de passe : 12 à 128 caractères. Le premier admin se crée avec la commande locale `lsoc create-admin`.

`POST /users` retourne `user`, `invitation_token`, `invitation_url` : le lien est copiable par l’admin. Une invitation n’accorde aucun accès au planning. Régénération et activation concurrentes sont sérialisées ; un compte actif ne peut plus être réinvité.

Les suppressions de sections, équipes et gymnases encore utilisés sont refusées par 409. Les comptes sont supprimés avec purge des données privées, des rattachements, suivis et travaux d’e-mail. Les événements deviennent sans référent et sont signalés aux admins ; les actions historiques conservent seulement le prénom de leur auteur.

Changer le référent d’une équipe (`PUT /teams/{id}`) le reporte sur ses événements, passés compris. Sont concernés ses matchs FFVB et les événements nés de ses demandes, lorsqu’ils avaient l’ancien référent ou aucun ; un référent choisi explicitement pour un événement est conservé. Chaque report est historisé et notifié. La migration 0009 rattrape les matchs FFVB restés sur un ancien référent.

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
| `POST /series` | `{event,until,weekdays?,force}` ; occurrences hebdomadaires matérialisées aux jours `weekdays` (0 = lundi … 6 = dimanche, par défaut le jour du premier événement), heure locale de Paris conservée, deux ans maximum |
| `DELETE /events/{id}?scope=event|following` | Admin : supprime l’événement, ou celui-ci et les suivants de sa série ; une série vidée disparaît. Historique, demandes, questions, suivis et inscriptions sont effacés ; les personnes qui suivent l’événement ou y sont inscrites et le référent sont notifiés. Un match FFVB renvoie 409 : il s’annule, ou disparaît avec sa source |
| `PATCH /series/{id}` | `from_event_id`, `base_version`, `changes`, `include_exceptions`, `force` |
| `GET/POST /availability-blocks`, `PUT/DELETE /availability-blocks/{id}` | Indisponibilités partielles ou totales ; admin pour les mutations |
| `GET /gymnasiums/{id}/availability?starts_at=…&ends_at=…` | Capacité et segments d’occupation de la période |

Le statut de coach ne suffit pas pour modifier une séance : il faut être son référent. Un référent sans `direct_edit` passe par une demande. Un admin accepte ou refuse ; une demande obsolète doit être réexaminée. Les champs d’administration restent réservés aux admins même pour un référent autorisé.

Annuler un événement avec `changes.cancelled=true` libère sa réservation et conserve son historique. Une modification individuelle d’une occurrence crée une exception. Une modification de série conserve par défaut les exceptions et vérifie les droits sur chaque occurrence. Les déplacements horaires appliquent le même décalage d’heure locale à toute la sélection. Les réservations sont vérifiées sur le résultat final de la série, puis appliquées atomiquement. Les heures inexistantes au passage à l’heure d’été sont refusées.

Un blocage comporte `gymnasium_id`, `title`, `starts_at`, `ends_at`, `courts`. Il peut créer un dépassement sur des événements existants ; les admins sont alors alertés. Une baisse de capacité d’un gymnase déclenche également ces alertes. Les disponibilités exposent toujours une valeur au moins nulle et une quantité excédentaire distincte.

## Demandes de création des coachs

Un compte actif peut proposer un événement pour une équipe dont il est référent, ou, avec le rôle coach, à laquelle il est rattaché comme coach (`kind="coach"`). Le serveur déduit la section et le référent ; la demande ne crée aucun événement ni réservation avant validation.

| Routes | Usage |
| --- | --- |
| `POST /event-requests` | `team_id`, `title`, `description`, `kind`, `starts_at`, `ends_at`, `gymnasium_id`, `location`, `courts`, `registration_section_ids`, `registration_team_ids`, `registration_limit`, `note` |
| `GET /event-requests?status=pending` | Ses demandes ; toutes pour un admin. `status=` retourne tous les états, pagination `limit`/`offset` |
| `GET /event-requests/{id}` | Auteur ou admin uniquement |
| `POST /event-requests/{id}/decision` | Admin : `{accept,reason,force,acknowledge_ffvb:false}` |

Un événement porte une `description` libre (2000 caractères, vide par défaut), modifiable comme le titre et reprise de la proposition à l’acceptation ; `note` reste un message aux admins, non publié. Les vues contiennent `proposal`, l’auteur, l’équipe, la note, l’état, le motif et la date de décision et `event_id` après acceptation. Une acceptation vérifie à nouveau le rôle, le rattachement, les références et la capacité. Elle crée exactement un événement, même en cas de décisions concurrentes ; une demande traitée renvoie 409. Seul un admin peut forcer un dépassement, avec historique. Le refus reste possible si le coach a perdu ses droits. L’ouverture à une équipe n’ouvre pas les autres équipes de sa section ; les équipes et sections choisies se cumulent, avec une limite globale d’inscrits.

## Licences

| Routes | Usage |
| --- | --- |
| `GET /licenses/me` | Statut de sa licence (`none`, `in_progress`, `payment_pending`, `active`), sans numéro |
| `GET /licenses?section_id=&team_id=&missing=true` | Admin : comptes actifs avec numéro, statut, équipes et `missing` |
| `PUT /licenses/{user_id}` | Admin : `{number, status}` |

Une licence ne devient `active` qu’après `payment_pending` et avec un numéro. Les retours en arrière restent possibles pour corriger. Le numéro est unique (409). Un filtre de section ou d’équipe limite la liste aux comptes rattachés à ce périmètre. `missing` signale un joueur rattaché à une équipe du périmètre dont la licence n’est pas active ; coachs et comptes sans équipe n’en ont pas. L’adhérent reçoit une notification, sans e-mail, à chaque changement de statut. La suppression d’un compte efface sa licence (migration 0011).

## Séances ouvertes et inscriptions

Un événement porte `registration_section_ids` (sections ouvertes), `registration_team_ids` (équipes ouvertes), `registration_limit` (obligatoire dès qu’une section ou équipe est ouverte, de 1 à 1000) et `registration_count` (lecture seule). Seul un admin modifie ces champs, qui suivent les règles habituelles de création, de série, d’historique et de restauration. La limite ne peut pas descendre sous le nombre d’inscrits ; fermer une séance conserve les inscriptions existantes.

| Routes | Usage |
| --- | --- |
| `GET /events/{id}/registrations` | `{open, limit, count, registered, eligible, participants}` ; `participants` (prénoms) seulement pour un admin ou le référent, sinon `null` |
| `POST /events/{id}/registration` | S’inscrire ; idempotent |
| `DELETE /events/{id}/registration` | Se désinscrire avant le début |
| `DELETE /events/{id}/registrations/{user_id}` | Admin : retirer une inscription ; l’adhérent est notifié |
| `GET /registrations` | Inscriptions du compte connecté |

L’inscription exige le rôle `member`, un rattachement (joueur ou coach) à une équipe explicitement ouverte ou appartenant à une section ouverte, une séance ni annulée ni commencée, et une place libre. Erreurs : `403` hors équipe/section ouverte, `409 {code: "registration_closed"}` (fermée, annulée ou commencée) et `409 {code: "registration_full"}` (limite atteinte). Les inscriptions sont sérialisées par le verrou du planning, si bien que des demandes simultanées ne dépassent jamais la limite. Un inscrit reçoit les notifications de modification de la séance comme s’il la suivait. La suppression d’un compte efface ses inscriptions.

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

`GET /unread` renvoie `{messages, notifications, threads, thread_counts}` pour les pastilles du menu et de la messagerie (`thread_counts` : non-lus par fil). La lecture est explicite : `POST /questions/{id}/read` marque un fil, `POST /questions/read` tous les fils accessibles, et répondre dans un fil le marque comme lu ; ouvrir un fil ne suffit pas. `messages` compte les questions non lues des adhérents pour un admin, et les réponses reçues sur ses propres fils pour un adhérent ; `threads` liste les fils concernés. La boîte des admins est partagée : un fil ouvert par un admin est lu pour tous. Marquer un fil comme lu marque aussi comme lues ses alertes « nouvelle question », même si un autre admin avait déjà lu les messages. Un admin ne marque jamais comme lue, pour l’adhérent, la réponse d’un autre admin.

Les questions sont privées entre l’adhérent auteur et les admins. Être référent ne donne aucun accès aux conversations privées. Révoquer `messaging_allowed` empêche d’écrire et laisse lire les échanges existants. Les réponses apparaissent dans le fil sans nouvelle catégorie d’e-mail adhérent. Les admins reçoivent l’alerte d’une nouvelle question.

Un utilisateur ne reçoit pas d’e-mail pour sa propre modification d’événement. Le référent est informé des modifications externes, selon sa préférence. Un suivi de série retiré ne supprime pas les suivis individuels explicites. Une vérification FFVB sans changement réel ne crée aucune notification de modification.

## FFVB

Configurer une fois le code du club avec `PUT /ffvb/club` (`{ "club_code": "0926620" }`), puis créer une équipe rattachée à une section avec un référent actif. Configurer une association de gymnase, puis une source :

```json
{
  "team_id": "team-id",
  "season": "2026/2027",
  "entity": "PTIDF92",
  "pool": "BRC",
  "team_number": "6",
  "team_name": "LSO COLOMBES",
  "enabled": true,
  "interval_days": 1
}
```

Gymnase local d’un match FFVB à domicile : l’association `/ffvb/gym-mappings` du nom officiel, sinon le gymnase local de même nom si l’équipe qui reçoit commence par `LSOC_FFVB_HOME_PREFIX` (« LSO COLOMBES » par défaut). Une telle rencontre compte comme jouée à domicile même si l’équipe suivie est l’équipe visiteuse. Les noms sont comparés sans accents, sans casse et à espaces près, et deux associations ne peuvent pas avoir la même clé (409). Créer, modifier ou supprimer une association, créer un gymnase ou en renommer un réapplique aussitôt ces règles aux matchs importés, sauf aux valeurs protégées par une modification locale, qui ouvrent un conflit.

`DELETE /ffvb/sources/{id}` (admin) supprime une source, ses états de match et ses conflits. Ses matchs restent des événements ordinaires, avec historique, suivis et inscriptions, mais ne sont plus synchronisés (action d’historique `ffvb_source_deleted`). Avec `?cancel_upcoming=true`, les matchs à venir sont annulés, ce qui libère leurs terrains et prévient les personnes qui les suivent.

Chaque source peut porter ses propres `courts` (terrains réservés), `before_minutes` et `after_minutes` (marges autour du coup d’envoi). `null` suit la configuration par défaut (`GET/PUT /ffvb/defaults`), qui ne vaut que pour les imports suivants. Modifier les réglages d’une source les reporte aussitôt sur ses matchs à venir (action d’historique `source_settings`) ; une valeur modifiée à la main sur un match est conservée.

`POST /ffvb/sources/preview` accepte l’URL d’une poule ou d’une équipe, par exemple `…/vbspo_calendrier.php?saison=2026%2F2027&codent=LIIDF&poule=2MC&calend=COMPLET&equipe=9&x=6&y=9`. Avec `equipe`, seule cette équipe est proposée ; les autres paramètres sont ignorés. Les codes de match peuvent comporter une phase en lettres (`2MCA001`). Pour un match déjà joué, la FFVB affiche le score à la place du lieu : un match connu garde son lieu, un match joué jamais importé n’est pas créé.

Association locale : `POST /ffvb/gym-mappings` avec `{"official_name":"GYMNASE AMBROISE PARE","gymnasium_id":"gymnasium-id"}`. Les autres sources restent configurables via l’API.

| Routes | Usage |
| --- | --- |
| `GET/PUT /ffvb/club` | Code du club global ; modification refusée une fois configuré |
| `POST /ffvb/sources/preview` | Extraire saison, entité, poule et équipes à partir d’une URL ; formulaire manuel si données manquantes |
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
