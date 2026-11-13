# Réunions

La page **Réunions** du menu et du menu mobile permet de créer une réunion,
de retrouver l’historique paginé, de filtrer par état (planifiée, en cours,
terminée), puis de reprendre les notes après rechargement.

Les comptes ADMIN et TECH actifs partagent les réunions, comme les projets.
Les comptes dédiés aux impressions et les rôles inconnus sont refusés côté API.
Il n’y a pas de réunions privées ni de liste de participants dans cette version.

Chaque sujet a un titre, une case « traité », des notes et des liens. Les boutons
Monter/Descendre changent son ordre, y compris au clavier et sur téléphone.
On peut ajouter et retirer des sujets pendant la séance. **Enregistrer** sauvegarde
la réunion complète ; le message indique les modifications non enregistrées.
Quitter ou changer de réunion demande confirmation en présence de modifications.
Une version périmée est refusée (409) : les notes restent à l’écran. Les copier
avant de recharger pour fusionner manuellement les changements d’un collègue.

## Liens et confidentialité

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
