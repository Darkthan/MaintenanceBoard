# Réunions

La page **Réunions** du menu et du menu mobile permet de créer une réunion,
de retrouver l’historique paginé, de filtrer par état (planifiée, en cours,
terminée), puis de reprendre les notes après rechargement.

Le bouton **+**, fixé en bas à droite, s’adapte à la vue : dans la liste ou le
menu des réunions, il crée une réunion ; dans une réunion ouverte, il ajoute
un sujet et ouvre directement son champ de titre. Le bouton **← Réunions**
revient à la liste, avec confirmation si des modifications ne sont pas
enregistrées. Sur téléphone, le bouton flottant reste au-dessus de la navigation
et laisse les commandes de sauvegarde accessibles.

Les comptes ADMIN et TECH actifs partagent les réunions, comme les projets.
Les comptes dédiés aux impressions et les rôles inconnus sont refusés côté API.
Il n’y a pas de réunions privées ni de liste de participants dans cette version.

Chaque sujet a un titre, une case « traité », des notes et des liens. Les boutons
Monter/Descendre changent son ordre, y compris au clavier et sur téléphone.
Les sujets s’affichent par défaut sous forme de cartes compactes : titre, état,
présence de notes et nombre de liens. Cliquer sur une carte l’agrandit pour
modifier ses notes et ses liens. **Tout ouvrir** et **Tout replier** changent
la vue de l’ensemble des sujets, sans modifier leur contenu ni leur ordre.
Une barre d’avancement se met à jour quand on coche les sujets.
Sur téléphone, l’historique est replié pour laisser la place à la réunion. Pour
les réunions en cours ou terminées, les informations de préparation sont aussi
repliées ; elles restent accessibles via **Modifier le titre, la date ou l’état**.
On peut ajouter et retirer des sujets pendant la séance. Les modifications sont
**enregistrées automatiquement après une pause de saisie de 800 ms**. Le bouton
**Enregistrer** permet aussi de déclencher une sauvegarde immédiate. Les titres
de la réunion et des sujets doivent être remplis avant l’enregistrement.
Quitter ou changer de réunion demande confirmation si des modifications ne sont
pas encore enregistrées.

## Synchronisation en direct

Les autres écrans ouverts sur la même réunion reçoivent les versions enregistrées,
généralement dans la seconde suivant la sauvegarde. Les sujets ouverts, les notes
en cours de saisie et la position du curseur sont conservés. Les modifications
de champs différents sont fusionnées automatiquement (par exemple une case cochée
et les notes d’un autre sujet). Les ajouts simultanés de sujets et de liens sont
conservés. Si deux personnes modifient la même note, ou si un sujet modifié est
supprimé ailleurs, un bandeau demande de **garder mes modifications** ou
**utiliser la version distante**. Les changements sans conflit sont conservés
dans les deux cas. Aucun texte concurrent n’est écrasé silencieusement.

Une coupure interrompt la synchronisation et laisse les notes à l’écran ; les
tentatives de sauvegarde et de connexion reprennent automatiquement avec un délai
progressif. Une création rejouée après perte de réponse ne crée pas de doublon.
Il n’y a pas de stockage de brouillon local après fermeture : attendre le message
de sauvegarde avant de quitter. La liste des réunions s’actualise toutes les cinq
secondes lorsqu’elle est visible.

Le serveur attend les changements via `GET /api/meetings/:id/updates?version=N`,
pendant vingt secondes au maximum, avec vérification de la version en base chaque
seconde. Cela fonctionne entre plusieurs processus sans bus d’événements local.
Les droits du compte sont revérifiés avant chaque réponse et les aperçus sont
calculés pour ce lecteur. Une connexion quittée est interrompue sans laisser de
minuteur actif ; les requêtes de synchronisation ont des limites dédiées par
compte et par adresse IP. Aucune migration supplémentaire n’est nécessaire.

## Liens et confidentialité

Dans les notes d’un sujet ou le champ **Lien ou mention de page**, saisir `@`
pour choisir une page, ou directement `@commandes` pour afficher les commandes.
Ajouter un nom après la mention, par exemple `@commandes ordinateurs`, pour
filtrer les résultats. Les commandes peuvent aussi être retrouvées par fournisseur
ou référence du bon. Les pages suivantes sont disponibles : `@commandes`,
`@equipements` (ou `@équipements`), `@salles`, `@interventions` et `@projets`.

Choisir une fiche ajoute son lien avec aperçu au sujet et retire le texte de
recherche. Les notes autour de la mention sont conservées. Les résultats sont
paginés par dix ; les flèches du clavier permettent de les parcourir, Entrée de
sélectionner et Échap de fermer la liste. La sélection est aussi possible au
clic ou au toucher. Les liens sont enregistrés automatiquement avec les notes.
La recherche est effectuée côté serveur avec les droits du lecteur, et les droits
sont revérifiés à la sélection puis à chaque consultation de la réunion.

Coller une URL de fiche dans un sujet puis choisir **Ajouter le lien** :

- `/orders.html?id=<UUID>` (ou `focus`) : titre, total TTC, état et référence du bon ;
- `/equipment.html?focus=<UUID>` ;
- `/rooms.html?focus=<UUID>` ;
- `/interventions.html?focus=<UUID>` ;
- `/projects.html?id=<UUID>`.

Les URL absolues doivent correspondre à l’origine `APP_URL` configurée.
Les autres domaines, les routes non admises et les identifiants invalides sont
refusés. Aucun contenu distant n’est téléchargé. Les requêtes Prisma sélectionnent
uniquement les champs d’aperçu. Pour les commandes, le total reprend le calcul
TTC des lignes et les paramètres du bon (TVA, devise, préfixe) ; à défaut de prix
sur les lignes, il utilise `totalAmount`. La référence correspond au bon PDF.

Une référence stockée ne contient que le type et l’identifiant. Les aperçus sont
recalculés avec les droits du lecteur, notamment l’affectation des interventions
et l’accès partagé aux bilans CHECKUP. Les objets supprimés ou inaccessibles
affichent « Objet indisponible », sans titre ou montant sauvegardé antérieurement.
Les textes sont échappés, sans interprétation HTML des notes ou titres.
Les réponses portent `Cache-Control: no-store` et le service worker utilise le
réseau uniquement pour `/api/meetings`. Cette page ne conserve pas de brouillon
local après fermeture : enregistrer avant de quitter.

Limites : 100 sujets, 20 000 caractères de notes par sujet, 10 liens par sujet,
100 liens par réunion. Les détails des endpoints figurent dans `/api-docs`.

## Vérification et préparation au déploiement

Les deux schémas Prisma contiennent le modèle `Meeting`. Les migrations
`20261113_meetings` (migration standard, SQL compatible SQLite/PostgreSQL) et
`prisma/postgresql-migrations/20261113_meetings.sql` (procédure PostgreSQL manuelle)
créent la même table. Appliquer **une seule** de ces voies selon la procédure
habituelle de l’installation, après sauvegarde. Régénérer le client Prisma et
redémarrer l’application. Ne pas exécuter les deux scripts sur une même base.

Avant production, valider sur une base de préproduction PostgreSQL et vérifier
les droits ADMIN, TECH, PRINT_MANAGER, une intervention réaffectée, un objet
supprimé, deux modifications concurrentes et le rechargement après sauvegarde.

Tests automatisés :

```powershell
node node_modules/jest/bin/jest.js tests/meetings.test.js --runInBand
node tests/meetings-browser.cjs
```

Le premier utilise une base SQLite temporaire indépendante et applique la
migration incrémentale réelle. Le second ouvre Chrome en mode sans fenêtre et
teste les parcours sur ordinateur et téléphone avec une API simulée. Pour vérifier
le rendu avec les styles réels lorsque le CDN n’est pas accessible à Chrome,
enregistrer son runtime dans `tests/.tmp/meetings/tailwind.js` avant ce test.

### Résultats du 13 novembre 2026

- 24 tests dédiés aux réunions réussis, incluant la migration SQLite réelle,
  les sauvegardes concurrentes, les droits, les objets réaffectés/supprimés,
  la validation des liens et l’absence de cache hors ligne.
- 26 tests réussis en combinant réunions et documentation de l’API publique.
- Parcours Chrome réussis à 1280 px (ADMIN) et 390 px (TECH), avec contrôle
  visuel des captures et des styles réels : création, notes, cases, réorganisation,
  aperçu échappé, sauvegarde/rechargement, conflit et protection des notes locales.
- Schémas Prisma SQLite et PostgreSQL validés ; aucune base de production modifiée.
- Suite générale : 661 tests réussis sur 666 lors de l’exécution complète,
  avant ajout du dernier test d’exclusion du cache, ensuite validé séparément.
  Cinq échecs concernent des éléments extérieurs à cette fonctionnalité :
  `orders-signature-preview.test.js` (2 comparaisons de données PDF ; les quatre
  fonctions testées sont identiques à HEAD), `mcp-equipment-fields.test.js`
  (2 listes qui n’intègrent pas les champs `hostnameChange*` déjà présents dans
  le travail en cours) et `mobile-viewport-lock.test.js` (viewport de
  `pc-review.html`, page déjà présente avant cette tâche).

Les échecs généraux doivent être traités et la migration doit encore être
exécutée en préproduction PostgreSQL avant toute mise en production.

### Vérification du commit destiné à main

La fonctionnalité a été sélectionnée séparément des autres travaux locaux, puis
testée dans une copie indépendante avec son propre client Prisma : 611 tests
réussis sur 614 au premier passage. Les trois tests restants d’import des
impressions ont ensuite réussi en rétablissant dans la copie les fins de ligne LF
du fichier réellement enregistré dans Git (l’export Windows les avait converties
en CRLF). Les 614 tests de cette sélection ont ainsi été vérifiés avec succès.
Les cinq échecs du dossier de travail complet mentionnés plus haut ne sont pas
reproduits par la sélection publiée. La validation PostgreSQL en préproduction
reste à effectuer avant une mise en production.

### Mentions et vue compacte

Après ajout des mentions et modernisation de l’interface : 37 tests Réunions
réussis, 44 tests réussis en incluant la navigation mobile et la documentation API.
Les parcours Chrome à 1280 px et 390 px vérifient aussi le choix d’une page, la
recherche vide/en erreur et son réessai, les réponses de recherche périmées,
l’insertion au clavier et la revérification d’accès lors du choix d’une fiche.
La vue compacte par défaut, le dépliage individuel/global, la sauvegarde et les
conflits de notes sont vérifiés sur ces deux formats.

### Publication de l’ensemble des travaux

Le 13 novembre 2026, vérification complète après intégration des travaux locaux :
**80 suites et 680 tests réussis**. Les échecs antérieurs ont été corrigés :
les aperçus PDF reçoivent directement les octets du document pour respecter la
politique de sécurité du navigateur ; les champs de suivi des renommages sont
déclarés en lecture seule dans le contrat MCP ; la page PC à vérifier suit le
format mobile commun. Les tests d’import des impressions acceptent les fins de
ligne Windows. Les fichiers temporaires et profils de navigateur sont exclus
de Git et les copies de tests temporaires sont exclues de Jest.

Les parcours Chrome des réunions et de la revue des PC réussissent sur ordinateur
et téléphone. Les schémas SQLite et PostgreSQL sont valides. Ces contrôles ne
constituent pas une vérification de l’état de la production.

### Vérification de la synchronisation

Après ajout de la synchronisation et de l’enregistrement automatique : **81 suites
et 698 tests réussis**. Les tests couvrent la réception de nouvelles versions,
la révocation d’un compte pendant une attente, l’arrêt des requêtes abandonnées,
le délai maximal d’attente, les aperçus soumis aux droits, les créations rejouées
sans doublon et les fusions de notes/sujets/liens/ordres concurrents.
Les parcours Chrome à 1280 px et 390 px vérifient l’enregistrement automatique,
les modifications distantes, la conservation du curseur et de la saisie,
la résolution des conflits et la reprise de sauvegarde après une coupure simulée.
