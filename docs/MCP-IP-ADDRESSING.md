# Plan d’adressage IP via MCP

Les outils du MCP authentifié permettent de consulter et de modifier le plan présent dans Documentation. Ils modifient la base MaintenanceBoard uniquement, sans reconfigurer les équipements réseau.

| Outil | Scope | Usage |
| --- | --- | --- |
| `list_ip_networks` | `ip_addressing:read` | Réseaux, VLAN, CIDR, passerelles, compteurs ; recherche facultative |
| `get_ip_network` | `ip_addressing:read` | Détail, plages, adresses manuelles et remontées par agent, migrations planifiées |
| `list_ip_addresses` | `ip_addressing:read` | Adresses d’un réseau, recherche après fusion des données agent, tri numérique |
| `get_ip_address_history` | `ip_addressing:read` | Historique par `networkId` et `ip`, disponible après libération |
| `create_ip_network` | `ip_addressing:write` | Création : `name` et `cidr` requis |
| `update_ip_network` | `ip_addressing:write` | Modification par `networkId` |
| `create_ip_range` | `ip_addressing:write` | Ajout : `networkId`, `startHost`, `endHost`, `label` |
| `update_ip_range` | `ip_addressing:write` | Modification par `networkId` et `rangeId` |
| `delete_ip_range` | `ip_addressing:write` | Suppression par `networkId` et `rangeId` |
| `create_ip_address` | `ip_addressing:write` | Ajout : `networkId` et `ip` requis |
| `update_ip_address` | `ip_addressing:write` | Modification par `networkId` et `addressId` |
| `delete_ip_address` | `ip_addressing:write` | Suppression par `networkId` et `addressId` |

Utilisateur authentifié actif requis. Les écritures, y compris les outils existants `create_ip_migration` et `apply_ip_migration`, exigent le rôle ADMIN, comme l’interface web. Les scopes ne remplacent pas ce contrôle de rôle. Le MCP public destiné aux demandes ne publie pas ces outils.

Les scopes IP existent déjà dans les permissions MCP. Une connexion OAuth directe utilise les autorisations consenties ; si les scopes IP manquent, reconnecter l’intégration et les autoriser. Pour un jeton configuré manuellement, activer la lecture et/ou l’écriture du plan IP dans ses permissions.

Champs réseau : `name`, `cidr` IPv4, `vlan` (1–4094 ou null), `gateway`, `secondaryGateways` (tableau d’IPv4), `description`. Les passerelles doivent appartenir au réseau et être utilisables. Les passerelles secondaires sont dédupliquées.

Champs plage : `startHost` et `endHost` sont des offsets inclusifs depuis la base du réseau. Pour `10.0.0.0/24`, 10–20 désigne `10.0.0.10` à `10.0.0.20`. `rangeType` accepte STATIC, DHCP, RESERVED ou OTHER.

Une plage ajoutée ou modifiée ne peut partager aucune adresse avec une autre plage du même réseau. Pour déplacer une limite commune, raccourcir d'abord la plage qui cède les adresses.

Champs adresse : `ip`, `hostname`, `equipmentType`, `description`, `equipmentId`. L’IP doit appartenir au réseau ; un équipement lié doit exister. Les doublons réseau/IP sont refusés. Une entrée `autoDiscovered` issue d’un agent possède un identifiant virtuel : la créer explicitement dans le plan, puis utiliser son identifiant persistant pour la modifier. Les données agent peuvent continuer à enrichir son affichage.

Les modifications partielles conservent les champs omis ; null efface les champs facultatifs. Une modification vide est refusée. Un changement de CIDR excluant les plages ou adresses manuelles existantes est refusé.

Pour réserver une adresse, passer `reserve: true` à la création ou à la modification. L'attribution est enregistrée sans équipement lié, avec la description « Réservé » par défaut. Une description explicite telle que « GTB - Réservé » et un type d'équipement peuvent être fournis.

Une interface déjà liée doit être détachée avant de convertir l'attribution en réservation. Utiliser `manualOnly: true` avec `get_ip_network` ou `list_ip_addresses` pour vérifier les valeurs persistées sans enrichissement par les agents et retrouver les entrées historiques hors CIDR avant de les libérer.

La recherche d'adresses s'effectue dans le réseau sélectionné. Une IPv4 complète filtre par égalité. Les recherches textuelles acceptent les mots dans n'importe quel ordre, sans distinction de casse ou d'accent, dans les libellés IPAM et les noms remontés par les agents ou leurs fiches équipement.

Les écritures directes d’adresses/plages et les modifications de réseau sont réalisées dans une transaction Serializable avec un instantané préalable, attribué à l’utilisateur et consultable dans l’historique web. Une erreur annule aussi cet instantané. Une entrée d’un autre réseau est refusée. Les erreurs métier reviennent en résultat MCP `isError`.

Validation : `node node_modules/jest/bin/jest.js --runInBand tests/mcp-ip-addressing.test.js tests/mcp-ip-addressing.integration.test.js tests/ip-addressing.test.js tests/mcp-work-service.test.js tests/mcp-permissions.test.js`.
