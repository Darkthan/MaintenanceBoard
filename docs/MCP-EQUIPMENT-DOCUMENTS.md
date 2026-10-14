# Associer les factures et bons de livraison aux équipements

Les fiches équipements disposent de `invoiceNumber` et `deliveryNoteNumber`, visibles et modifiables depuis la page Équipements. Seules ces références sont enregistrées : ce parcours ne transmet ni ne conserve la photo dans MaintenanceBoard.

1. Joindre la photo du BL ou de la facture dans la conversation avec l’assistant.
2. L’assistant relève les références lisibles et les numéros de série. Une référence absente reste omise ; un BL sans numéro de facture peut être associé seul puis complété plus tard.
3. `list_equipment` permet de lister les séries avec pagination (`nextCursor`) ou de filtrer par `serialNumbers` exacts.
4. `preview_equipment_documents` reçoit `serialNumbers`, `deliveryNoteNumber` et/ou `invoiceNumber`. Il retourne les équipements, les changements, les séries inconnues et les conflits, sans écriture.
5. `associate_equipment_documents` reçoit les mêmes paramètres et applique le lot dans une transaction. Une série inconnue ou un conflit bloque tout le lot. Le remplacement d’une référence existante exige `overwrite: true`, à utiliser seulement si l’utilisateur demande ce remplacement.

Les correspondances sont exactes après suppression des espaces en début et fin. Aucune correction automatique des caractères ambigus (0/O, 1/I) n’est faite. L’assistant demande de préciser les informations illisibles au lieu de deviner. Un même BL ou numéro de facture peut être partagé par plusieurs équipements. Répéter le même lot ne crée aucun doublon. Un champ omis conserve sa valeur actuelle.

Scopes nécessaires : `equipment:read` pour la recherche et l’aperçu, `equipment:write` pour l’association. `update_equipment` permet aussi de modifier les deux références d’une fiche ; `null` efface la référence.

Au déploiement, appliquer la migration `20261014_equipment_references`, régénérer le client Prisma avec le schéma adapté (SQLite ou PostgreSQL), puis redémarrer le serveur. Actualiser les outils de la connexion MCP pour faire apparaître les nouveaux outils et champs.
