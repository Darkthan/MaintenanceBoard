# Gestion des salles par MCP

Les outils utilisent l’utilisateur authentifié et les droits du jeton :

| Outil | Scope | Rôle |
| --- | --- | --- |
| `list_rooms` | `rooms:read` | ADMIN ou TECH |
| `get_room` | `rooms:read` | ADMIN ou TECH |
| `create_room` | `rooms:write` | ADMIN |
| `update_room` | `rooms:write` | ADMIN |

`list_rooms` accepte `search`, `building`, `limit` (1 à 100, 50 par défaut) et
`cursor`. La réponse contient `data` et `nextCursor` (null en fin de liste).
`get_room` accepte `id` et inclut les équipements et compteurs associés.
Les réponses MCP excluent le token QR interne.

La création exige `name` (1 à 200 caractères après suppression des espaces
périphériques). Les champs facultatifs sont `building` (100 caractères),
`floor` (entier signé 32 bits), `number` (50 caractères) et `description`.
La modification exige `id` et au moins un champ modifiable. Les champs omis
sont conservés ; null efface les champs facultatifs. Les chaînes facultatives
vides sont enregistrées comme null. Les champs inconnus sont refusés par le service.

Les routes HTTP POST/PATCH réutilisent le même service et les mêmes contraintes.
Elles continuent à accepter les étages numériques transmis sous forme de texte.

Un doublon correspond au même nom, bâtiment, étage et numéro (comparaison exacte,
après normalisation des espaces périphériques et des valeurs vides).
Le contrôle et l’écriture utilisent une transaction Serializable pour éviter
les créations concurrentes identiques via ce service. L’import historique
n’utilise pas ce service : il n’existe pas de nouvelle contrainte unique en base.

Les erreurs métier deviennent des résultats MCP `isError` : scope manquant,
utilisateur non autorisé, entrée invalide, salle absente, doublon ou conflit
concurrent (à réessayer). Les routes HTTP renvoient respectivement 400, 401,
403, 404 ou 409. Les erreurs internes inattendues restent traitées par le serveur.

Tests : `tests/mcp-rooms.test.js`, `tests/rooms-write.test.js` et
`tests/mcp-rooms.integration.test.js` (vrai client MCP et base SQLite temporaire),
ainsi que les tests existants des bâtiments, de l’authentification et du MCP.
