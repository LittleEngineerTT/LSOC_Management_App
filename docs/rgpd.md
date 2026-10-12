# RGPD — registre et points d'exploitation

L'application couvre l'information des personnes, leurs droits en libre-service et les durées de conservation. Ce document sert de registre des traitements (article 30) et liste ce qui relève de l'hébergement et de l'organisation du club, hors du code.

## Registre des traitements

| Rubrique | Contenu |
| --- | --- |
| Responsable | Association LSO Colombes Volley ; contact : bureau du club ou messagerie de l'application. Pas de DPO (non obligatoire). |
| Finalités | Organisation de la vie du club (planning, inscriptions, licences, messagerie) ; sécurité de l'application ; notifications par e-mail. |
| Bases légales | Exécution de l'adhésion (6.1.b) ; intérêt légitime pour la sécurité (6.1.f) ; consentement pour les e-mails (6.1.a), retirable dans le profil. |
| Personnes | Adhérents (dont mineurs), coachs, administrateurs. Visiteurs en mode invité : aucune donnée personnelle. |
| Données | Numéro de licence (identifiant), prénom, initiale du nom, catégorie, rôles, équipes, statut de licence, e-mail facultatif, préférences, inscriptions, suivis, messages privés, demandes, historique, notifications ; mot de passe haché ; empreinte d'IP pour la limitation des tentatives. Aucune donnée sensible. |
| Destinataires | Administrateurs du club ; prénom du référent visible des adhérents ; sous-traitants d'hébergement et d'envoi d'e-mails. |
| Transferts hors UE | À vérifier selon l'hébergeur et le prestataire SMTP retenus (voir ci-dessous). |
| Durées | Compte : 2 ans sans activité. Notifications lues : 6 mois, non lues : 2 ans. Messages, historique, demandes traitées, inscriptions : 2 ans. Sessions et jetons : jusqu'à expiration. File d'e-mails : 7 jours après envoi. Licences : statut remis à zéro chaque 1er août. |
| Sécurité | Mots de passe hachés, cookies `HttpOnly` / `SameSite=Lax` (et `Secure` en production), jeton CSRF, contenu des e-mails chiffré en base, contrôle d'accès par rôle, empreinte d'IP salée avec le secret. |

Les durées sont définies dans `backend/app/services/privacy.py` et affichées sur la page `/confidentialite` (`frontend/src/app/PrivacyPage.tsx`) : modifier l'une impose de modifier l'autre.

## Ce que fait l'application

- Page publique `/confidentialite`, liée depuis la connexion, le menu du profil et le mode invité.
- `GET /api/v1/me/export` : toutes les données du compte en JSON (bouton « Télécharger mes données »).
- `POST /api/v1/me/delete` : effacement immédiat après confirmation par mot de passe (bouton « Supprimer mon compte »). Le dernier administrateur actif ne peut pas s'effacer.
- Le worker applique les durées de conservation à chaque cycle et efface les comptes sans activité depuis 2 ans, sauf les administrateurs. L'activité est la connexion ou la prolongation de session (`users.last_seen_at`).
- Au 1er août (heure de Paris), le worker remet à zéro les statuts de licence joueur et coach et notifie les licenciés. Le numéro est conservé, l'accès aussi. La migration `0017_privacy` marque la saison en cours comme déjà traitée.
- Aucun cookie non essentiel, aucune mesure d'audience ni ressource externe : pas de bandeau de consentement.

## À la charge du club et de l'hébergement

- **HTTPS** obligatoire en production, avec `LSOC_COOKIE_SECURE=true`.
- **Journaux d'accès** du serveur web et d'uvicorn : ils contiennent des adresses IP. Les limiter à 1 an au plus (6 mois recommandés) et en restreindre l'accès.
- **Sauvegardes** : une durée de rotation (par exemple 30 jours) pour qu'un compte effacé disparaisse aussi des sauvegardes.
- **Sous-traitants** : contrat ou conditions conformes à l'article 28 avec l'hébergeur et le prestataire d'e-mails ; vérifier la localisation des données (UE de préférence).
- **Violation de données** : notifier la CNIL sous 72 heures si un risque existe pour les personnes, informer les personnes en cas de risque élevé, et tenir un registre des incidents.
- **Administrateurs** : comptes nominatifs, mots de passe robustes, retrait des droits au départ d'un membre du bureau.
- **Demandes d'opposition ou de limitation** : traitées par les administrateurs dans un délai d'un mois.
