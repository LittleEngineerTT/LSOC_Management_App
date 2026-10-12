# RGPD — registre et points d'exploitation

L'application couvre l'information des personnes, leurs droits en libre-service et les durées de conservation. Ce document sert de registre des traitements (article 30) et liste ce qui relève de l'hébergement et de l'organisation du club, hors du code.

## Registre des traitements

| Rubrique | Contenu |
| --- | --- |
| Responsable | Association LSO Colombes Volley ; contact : bureau du club ou messagerie de l'application. Pas de DPO (non obligatoire). |
| Finalités | Organisation de la vie du club (planning, inscriptions, licences, messagerie) ; sécurité de l'application ; notifications par e-mail. |
| Bases légales | Exécution de l'adhésion (6.1.b) ; intérêt légitime pour la sécurité (6.1.f) ; consentement pour les e-mails (6.1.a), retirable dans le profil. |
| Personnes | Adhérents (dont mineurs), coachs, administrateurs. Visiteurs en mode invité : aucune donnée personnelle. |
| Données | PDF de la licence de la saison (nom, date de naissance, photo selon la fédération) ; numéro de licence (identifiant), prénom, initiale du nom, catégorie, rôles, équipes, statut de licence, e-mail facultatif, préférences, inscriptions, suivis, messages privés, demandes, historique, notifications ; mot de passe haché ; empreinte d'IP pour la limitation des tentatives. Aucune donnée sensible. |
| Destinataires | Administrateurs du club ; coachs, en lecture seule, pour les équipes dont ils sont référents ou coachs : comptes des membres (identifiant, prénom, initiale, catégorie, rôles, rattachements) et licences (statut, numéro, PDF) ; prénom du référent visible des adhérents ; sous-traitants d'hébergement, de stockage S3 et d'envoi d'e-mails. |
| Transferts hors UE | À vérifier selon l'hébergeur et le prestataire SMTP retenus (voir ci-dessous). |
| Durées | Compte : 2 ans sans activité. Notifications lues : 6 mois, non lues : 2 ans. Messages, historique, demandes traitées, inscriptions : 2 ans. Sessions et jetons : jusqu'à expiration. File d'e-mails : 7 jours après envoi. Licences : statut remis à zéro et PDF supprimé chaque 1er août ; PDF supprimé avec le compte. |
| Sécurité | Mots de passe hachés, cookies `HttpOnly` / `SameSite=Lax` (et `Secure` en production), jeton CSRF, contenu des e-mails chiffré en base, contrôle d'accès par rôle, empreinte d'IP salée avec le secret. |

Les durées sont définies dans `backend/app/services/privacy.py` et affichées sur la page `/confidentialite` (`frontend/src/app/PrivacyPage.tsx`) : modifier l'une impose de modifier l'autre.

## Ce que fait l'application

- Page publique `/confidentialite`, liée depuis la connexion, le menu du profil et le mode invité.
- `GET /api/v1/me/export` : toutes les données du compte en JSON (bouton « Télécharger mes données »).
- `POST /api/v1/me/delete` : effacement immédiat après confirmation par mot de passe (bouton « Supprimer mon compte »). Le dernier administrateur actif ne peut pas s'effacer.
- Le worker applique les durées de conservation à chaque cycle et efface les comptes sans activité depuis 2 ans, sauf les administrateurs. L'activité est la connexion ou la prolongation de session (`users.last_seen_at`).
- Au 1er août (heure de Paris), le worker remet à zéro les statuts de licence joueur et coach et notifie les licenciés. Le numéro est conservé, l'accès aussi. La migration `0017_privacy` marque la saison en cours comme déjà traitée.
- Les PDF de licence sont déposés par les administrateurs dans un bucket S3 en lecture publique, sous `licences/` + 64 caractères aléatoires, et ouverts directement par le navigateur. Un remplacement, une suppression, l'effacement du compte ou la nouvelle saison suppriment l'objet.
- Aucun cookie non essentiel, aucune mesure d'audience ni ressource externe : pas de bandeau de consentement.

## À la charge du club et de l'hébergement

- **HTTPS** obligatoire en production, avec `LSOC_COOKIE_SECURE=true`.
- **Journaux d'accès** du serveur web et d'uvicorn : ils contiennent des adresses IP. Les limiter à 1 an au plus (6 mois recommandés) et en restreindre l'accès.
- **Sauvegardes** : une durée de rotation (par exemple 30 jours) pour qu'un compte effacé disparaisse aussi des sauvegardes.
- **Bucket S3 des licences** : lecture publique par objet uniquement, sans listage du bucket (ne pas accorder `s3:ListBucket` au public) ; région UE (`eu-west-3` par défaut) ; clé d'accès de l'API limitée à `s3:PutObject` et `s3:DeleteObject` sur `licences/*` ; pas de versionnage, sinon les PDF supprimés restent lisibles dans les versions. Le lien d'un PDF est un secret : qui l'obtient peut le lire tant que l'objet existe. Pour supprimer ce risque, passer à un bucket privé avec URL signées.
- **Sous-traitants** : contrat ou conditions conformes à l'article 28 avec l'hébergeur et le prestataire d'e-mails ; vérifier la localisation des données (UE de préférence).
- **Violation de données** : notifier la CNIL sous 72 heures si un risque existe pour les personnes, informer les personnes en cas de risque élevé, et tenir un registre des incidents.
- **Administrateurs** : comptes nominatifs, mots de passe robustes, retrait des droits au départ d'un membre du bureau.
- **Demandes d'opposition ou de limitation** : traitées par les administrateurs dans un délai d'un mois.
