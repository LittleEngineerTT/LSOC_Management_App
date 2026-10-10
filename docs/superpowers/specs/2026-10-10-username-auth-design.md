# Authentification par identifiant et e-mail facultatif

Directives utilisateur du 10 octobre : supprimer la vérification d’adresse et toute authentification par e-mail. L’utilisateur choisit un identifiant unique à l’activation de l’invitation ; l’administrateur peut le modifier. L’administrateur génère un lien de réinitialisation et le transmet lui-même. Aucun e-mail d’authentification n’est envoyé.

L’identifiant est normalisé en minuscules, de 3 à 80 caractères ASCII (lettres, chiffres, point, tiret, underscore, plus). Directive complémentaire : l’identifiant peut aussi être une adresse e-mail (un seul `@`), sans que ce soit obligatoire ; la validation de l’adresse à la création du compte est désactivée, au moins temporairement. Une adresse utilisée comme identifiant ne sert pas aux notifications. La migration conserve l’ancienne adresse comme identifiant lorsqu’elle respecte ce format. Les invitations restent à usage unique, les sessions cookies/CSRF inchangées. Les changements d’identifiant révoquent les sessions du compte. Les liens de récupération expirent après une heure et remplacent les précédents ; le mot de passe n’est modifié qu’à leur consommation.

L’adresse, facultative, est configurée dans Mon profil avec les préférences de notification. Aucune vérification n’est nécessaire et plusieurs comptes peuvent partager une adresse de notification. L’activation n’affiche aucun champ d’adresse. Les anciennes routes de vérification, renvoi et récupération par e-mail sont retirées du contrat.

Migration : conserver mots de passe et adresses de notification, attribuer un identifiant unique aux comptes ayant déjà un mot de passe à partir de l’ancienne adresse, gérer les collisions de façon déterministe, activer les comptes qui attendaient la vérification. Les invitations non consommées restent valables. Invalider les anciens jetons de vérification/récupération et retirer leurs e-mails en file.

La modification des tests existants est limitée aux assertions et fixtures rendues obsolètes par ces nouvelles directives, conformément à l’exception utilisateur.

## Plan

- [x] Ajouter et observer les tests d’activation sans adresse, unicité, modification d’identifiant, récupération administrateur et préférences facultatives.
- [x] Implémenter schéma, migration, routes, commandes locales et adaptation des fixtures.
- [x] Adapter connexion, activation, récupération et administration ; ajouter les préférences du profil.
- [ ] Adapter uniquement les tests concernés par le changement de directive ; vérifier concurrence, migration, parcours réels et résolutions.
- [ ] Actualiser les contrats et documents de reprise.
