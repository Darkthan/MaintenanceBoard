# Projets : ordre des colonnes et activité

La poignée ⠿ de chaque colonne permet de la glisser avant ou après une autre
colonne. L'ordre est partagé par les utilisateurs et conservé en base dans
`kanban_columns.position`. Le tableau recharge l'ordre enregistré après la
sauvegarde. En cas d'échec d'enregistrement, l'ordre affiché reste inchangé et
un message d'erreur apparaît. Une seule sauvegarde d'ordre est lancée à la fois
par page. Le déplacement des cartes reste indépendant.

Alternatives : flèches gauche/droite lorsque la poignée a le focus, ou actions
« Déplacer à gauche/droite » dans le menu de la colonne. Ces actions permettent
aussi de réordonner sur les appareils où le drag & drop HTML natif n'est pas
disponible, notamment certains écrans tactiles.

Le champ « Statut » dans la fenêtre de création/modification du projet propose
Actif et Inactif. Le badge est affiché sur le projet courant et sur chaque
projet dans le sélecteur. Le statut est purement informatif : les projets
inactifs restent visibles, modifiables et accessibles, avec leurs colonnes et
leurs cartes. Il n'y a ni archivage ni filtre automatique.

## Données et installation

`Project.isActive` est un booléen non nullable avec une valeur par défaut `true`.
La migration additive conserve tous les projets existants actifs. Les clients
qui omettent le champ à la création obtiennent un projet actif ; l'omettre lors
d'une modification conserve le statut courant. Les valeurs autres que les
booléens JSON `true` et `false` sont refusées (400).

Avant de redémarrer avec ce code, sauvegarder la base et appliquer la migration
selon la procédure de l'installation :

- SQLite : `npm run prisma:migrate`, puis `npx prisma generate`.
- PostgreSQL : appliquer une seule fois
  `prisma/postgresql-migrations/20261119_project_activity.sql` dans la procédure
  SQL PostgreSQL existante, puis exécuter
  `npx prisma generate --schema prisma/schema.postgresql.prisma`.

Ne pas utiliser les migrations SQLite pour une base PostgreSQL. Aucune base de
l'application n'est modifiée par les tests ; ils créent une base SQLite isolée.
Le réordonnancement utilise le champ de position existant et n'a pas besoin
d'une migration supplémentaire.

Cette migration incrémentale suppose que la table `projects` existe déjà.
L'historique de migrations du dépôt ne crée pas les tables Kanban : il ne
constitue donc pas à lui seul une installation complète sur une base vide.
Le démarrage Docker PostgreSQL actuel synchronise le schéma avec `db push` ;
si cette synchronisation a déjà ajouté le champ, le script SQL PostgreSQL
fourni peut être exécuté sans ajouter une seconde fois la colonne.

## API et permissions

- `POST /api/projects` et `PATCH /api/projects/:id` acceptent `isActive`.
- `POST /api/projects/:id/columns/reorder` reçoit `{ columnIds: [...] }`, avec
  exactement toutes les colonnes du projet, une seule fois chacune. Les
  identifiants inconnus, étrangers, dupliqués ou manquants sont refusés (400),
  sans changement partiel. Un projet inexistant renvoie 404. Toutes les mises
  à jour de position s'effectuent dans une transaction.
- Les permissions existantes sont conservées : comptes authentifiés actifs
  autorisés sur les projets (ADMIN et TECH dans le modèle de rôles actuel).
  Les comptes désactivés et les visiteurs sont refusés (401), les comptes
  PRINT_MANAGER sont refusés (403). La suppression d'un projet reste réservée
  à ADMIN. Il n'y a pas de restriction par propriétaire de projet.

## Vérification et limites

`node node_modules/jest/bin/jest.js tests/projects.test.js --runInBand --forceExit`
vérifie la migration sur un projet préexistant, les statuts, la validation,
les permissions, la persistance, l'intégrité des colonnes et les cartes.

`node tests/projects-browser.cjs [chemin-vers-chrome]` exerce la page réelle dans
Chrome headless à 1280 et 390 pixels : événements de drag & drop, clavier et
focus, déplacement par menu, erreur d'enregistrement, cartes, statuts et badges.
Ce test utilise une API isolée en mémoire et une mise en page locale minimale,
sans le CDN Tailwind ; il ne valide pas le rendu graphique complet ni un geste
tactile natif. Les tests API utilisent une vraie base SQLite.

PostgreSQL doit être vérifié sur l'installation cible : le schéma est validé,
mais aucun serveur PostgreSQL n'est démarré par ces tests. Des utilisateurs
réordonnant simultanément peuvent remplacer un ordre récemment enregistré :
il n'y a pas de contrôle de version ni de synchronisation en temps réel.
