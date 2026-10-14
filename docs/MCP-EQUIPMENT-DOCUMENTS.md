# Associer les factures et bons de livraison aux équipements

Les fiches équipements disposent de `invoiceNumber` et `deliveryNoteNumber`, visibles et modifiables depuis la page Équipements. Seules ces références sont enregistrées : ce parcours ne transmet ni ne conserve la photo dans MaintenanceBoard.

1. Joindre la photo du BL ou de la facture dans la conversation avec l’assistant.
2. L’assistant relève les références lisibles et les numéros de série. Une référence absente reste omise ; un BL sans numéro de facture peut être associé seul puis complété plus tard.
3. `list_equipment` permet de lister les séries avec pagination (`nextCursor`) ou de filtrer par `serialNumbers` exacts.
4. `preview_equipment_documents` reçoit `serialNumbers`, `deliveryNoteNumber` et/ou `invoiceNumber`. Il retourne les équipements, les changements, les séries inconnues, les créations prévues et les conflits, sans écriture.
5. `associate_equipment_documents` reçoit les mêmes paramètres et applique le lot dans une transaction. Une série inconnue crée une fiche `INACTIVE` avec un nom et un type par défaut (`PC <série>`, `PC`). Les champs facultatifs `name`, `type`, `brand`, `model` permettent de nommer et décrire les nouvelles fiches. `supplierId`, `purchaseDate`, `warrantyEnd` et `purchasePrice` sont appliqués aux fiches nouvelles **et existantes**. Le prix est un prix unitaire en euros, jamais le total du lot. Le remplacement d’une référence ou d’une information d’achat existante exige `overwrite: true`, à utiliser seulement si l’utilisateur demande ce remplacement.

Les correspondances sont exactes après suppression des espaces en début et fin. Aucune correction automatique des caractères ambigus (0/O, 1/I) n’est faite. L’assistant demande de préciser les informations illisibles au lieu de deviner. Un même BL ou numéro de facture peut être partagé par plusieurs équipements. Répéter le même lot ne crée aucun doublon. Un champ omis conserve sa valeur actuelle.

Scopes nécessaires : `equipment:read` pour la recherche et l’aperçu, `equipment:write` pour l’association. `update_equipment` permet aussi de modifier les deux références, le fournisseur, les dates d’achat/garantie et le prix d’une fiche ; `null` efface la référence ou le champ correspondant.

Au déploiement, appliquer la migration `20261014_equipment_references`, régénérer le client Prisma avec le schéma adapté (SQLite ou PostgreSQL), puis redémarrer le serveur. Actualiser les outils de la connexion MCP pour faire apparaître les nouveaux outils et champs.

## Accès complet aux fiches équipements

Le serveur MCP authentifié `/mcp` (version `1.2.0`) publie :

- `list_equipment` : tous les champs métier, fournisseur, données agent et interfaces réseau ; recherche par nom, série, facture ou BL.
- `get_equipment` : lecture par `id` **ou** `serialNumber` exact.
- `create_equipment` : création d’une fiche (`name` et `type` requis), `INACTIVE` par défaut.
- `update_equipment` : modification par `id` **ou** `targetSerialNumber` exact. Le paramètre `serialNumber` sert à changer la série elle-même.
- `list_equipment_suppliers` : recherche paginée des fournisseurs et identifiants à utiliser pour `supplierId`.
- `get_equipment_fields` : catalogue des champs modifiables et des champs internes.

Champs modifiables de la fiche : `name`, `type`, `brand`, `model`, `serialNumber`, `status`, `description`, `roomId`, `invoiceNumber`, `deliveryNoteNumber`, `supplierId`, `purchaseDate`, `warrantyEnd`, `purchasePrice`, `discoverySource`, `discoveryStatus`, `suggestedRoomId`, `agentHostname`, `lastSeenAt`, `agentInfo`, `agentRevoked`, `enrollmentTokenId`. Les dates sont au format `YYYY-MM-DD` ou ISO 8601 avec fuseau horaire ; `agentInfo` accepte un objet JSON ou sa représentation textuelle. Les données agent peuvent être actualisées au prochain passage de l’agent.

`id`, `createdAt` et `updatedAt` sont visibles et gérés par le système. Les secrets `qrToken` et `agentToken`, ainsi que l’état interne `agentAlertState`, ne sont ni retournés ni modifiables. Les interfaces MAC et les liens IPAM utilisent `list_equipment_network_interfaces` et `update_equipment_network_interface` ; changer le lien IPAM requiert aussi `ip_addressing:write`.

Si l’assistant ne voit que les outils de réservation ou de commandes : vérifier que la version déployée publie ces outils via `tools/list`, que la connexion pointe vers `/mcp` (pas `/mcp-public`), puis actualiser son catalogue d’outils. Les autorisations `equipment:read` et `equipment:write` sont nécessaires aux appels de lecture et d’écriture ; elles ne sont pas remplacées par les autorisations des commandes ou du stock. Aucun changement de permissions existantes n’est effectué automatiquement.
