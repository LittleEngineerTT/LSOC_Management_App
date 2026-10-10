# Sections de l’espace club

Directive utilisateur du 10 octobre : implémenter tous les menus de l’application. Les sections utilisent le contrat API V1 existant, sans changement backend ni nouvelle dépendance. Le code est dans `frontend/src/club/` ; il réutilise le client, les formulaires, confirmations et styles de l’administration. Dates et semaines sont calculées en Europe/Paris, indépendamment du fuseau du navigateur ; les intervalles restent de type [début, fin).

- **Accueil** (`/app`) : prochains rendez-vous du compte, notifications avec marquage comme lues et, pour un administrateur, demandes à valider et conflits FFVB ouverts.
- **Planning** : semaine navigable dans l’URL (`semaine`), filtres section, gymnase et annulations. Les administrateurs créent un événement ou une série hebdomadaire ; c’est la sous-application Planning réservée par le cadrage de l’administration.
- **Détail d’un événement** (paramètre `event`, partagé par toutes les sections) : horaires de réservation et coup d’envoi, lieu, terrains, sections, référent, état FFVB, suivi de l’événement ou de la série, question privée aux administrateurs, historique et restauration (admin).
- **Modification** : l’administrateur modifie tout, y compris une série à partir d’une occurrence ; le référent avec droit direct modifie les champs autorisés ; sinon il envoie une demande de validation. Seuls les champs changés sont transmis avec `base_version`. Un dépassement de capacité affiche les créneaux ; seul un administrateur peut cocher le forçage. Les dates et lieux FFVB exigent une confirmation explicite.
- **Gymnases** : occupation par créneau, terrains libres ou en excès, indisponibilités et événements de la semaine.
- **Messagerie** : fils de questions privés ; l’adhérent voit les siens, les administrateurs tous. Lecture marquée à l’ouverture ; un droit d’écrire retiré laisse lire les échanges.
- **Mon planning** : huit semaines d’événements suivis, dont le compte est référent ou concernant ses sections, avec ses demandes de modification.
- **Mes sections** : équipes du compte, rôle joueur ou coach, référent d’équipe et prochains événements de chaque section.

Les permissions restent vérifiées par le backend ; l’interface n’affiche que les actions correspondant aux droits effectifs. Les prénoms des autres comptes viennent de `/profiles/{id}`.

## Vérification

- [x] Tests unitaires : semaine, détail, suivi, question, demande d’un référent limitée aux champs modifiés, série créée avec forçage explicite, messagerie, gymnases et mes sections.
- [x] Scénarios Chromium desktop et mobile, matrice de 320 à 2560 px sans débordement horizontal, captures dans `frontend/.cache/previews/club-*.png`.
- [x] TypeScript strict, ESLint, Prettier et build.
- [ ] Parcours réel contre le backend Docker avec des données temporaires.
