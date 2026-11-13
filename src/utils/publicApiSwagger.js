// Extend the existing /api-docs document without confusing session JWTs with
// the MCP API keys / OAuth access tokens accepted by the integration API.
module.exports = function documentPublicApi(document) {
  const ref = name => ({ $ref: `#/components/schemas/${name}` });
  const string = { type: 'string' };
  const nullableString = { type: 'string', nullable: true };
  const date = { type: 'string', format: 'date-time', nullable: true };
  const status = { type: 'string', enum: ['ACTIVE', 'INACTIVE', 'REPAIR', 'DECOMMISSIONED', 'DEEE'] };
  const json = (description, schema, example) => ({
    description,
    content: { 'application/json': { schema, ...(example ? { example } : {}) } }
  });
  const query = (name, description, schema = string) => ({ name, in: 'query', description, schema });
  const pagination = [
    query('limit', 'Taille de page : 50 par défaut, bornée entre 1 et 100. Utiliser un entier.', {
      type: 'integer', minimum: 1, maximum: 100, default: 50
    }),
    query('cursor', 'Identifiant nextCursor de la page précédente. Conserver les mêmes filtres. Omettre pour la première page.')
  ];
  const page = name => ({
    type: 'object', required: ['data', 'nextCursor'],
    properties: {
      data: { type: 'array', items: ref(name) },
      nextCursor: { ...nullableString, description: 'Curseur suivant ; null à la dernière page.' }
    }
  });

  document.components.securitySchemes.integrationBearer = {
    type: 'http', scheme: 'bearer',
    description: 'Clé API MCP mcp_… ou access_token OAuth2 obtenu via /oauth/token (client_credentials ou authorization_code avec PKCE). Dans Authorize, saisir uniquement le secret ou le jeton, sans le préfixe Bearer. Un JWT de connexion à l’interface web ne convient pas. Les droits equipment:read et rooms:read doivent être accordés au jeton.'
  };
  Object.assign(document.components.schemas, {
    IntegrationAuthError: {
      type: 'object', required: ['jsonrpc', 'error', 'id'],
      properties: {
        jsonrpc: { type: 'string', enum: ['2.0'] },
        error: { type: 'object', properties: { code: { type: 'integer' }, message: string } },
        id: { type: 'string', nullable: true }
      },
      description: 'L’authentification et le limiteur MCP utilisent une enveloppe JSON-RPC, y compris sur cette API REST.'
    },
    IntegrationRoomEquipment: {
      type: 'object', properties: {
        id: string, name: string, type: string, brand: nullableString,
        model: nullableString, status, serialNumber: nullableString
      }
    },
    IntegrationRoom: {
      type: 'object', description: 'Salle sans qrToken. Le détail inclut les équipements ; la liste ne les inclut pas.',
      properties: {
        id: string, name: string, building: nullableString, floor: { type: 'integer', nullable: true },
        number: nullableString, description: nullableString, createdAt: date, updatedAt: date,
        _count: { type: 'object', properties: { equipment: { type: 'integer' }, interventions: { type: 'integer' } } },
        equipment: { type: 'array', items: ref('IntegrationRoomEquipment'), description: 'Uniquement pour GET /rooms/{id}, tri par nom.' }
      }
    },
    IntegrationNetwork: {
      type: 'object', properties: { id: string, name: string, vlan: { type: 'integer', nullable: true }, cidr: string }
    },
    IntegrationIpAddress: {
      type: 'object', properties: {
        id: string, networkId: string, ip: string, hostname: nullableString,
        equipmentType: nullableString, description: nullableString, equipmentId: nullableString,
        createdAt: date, updatedAt: date, network: ref('IntegrationNetwork')
      }
    },
    IntegrationNetworkInterface: {
      type: 'object', properties: {
        id: string, equipmentId: string, name: string, macAddress: nullableString,
        ipAddressId: nullableString, createdAt: date, updatedAt: date,
        ipAddress: { type: 'object', nullable: true, allOf: [ref('IntegrationIpAddress')], description: 'Adresse IPAM liée, ou null.' }
      }
    },
    IntegrationEquipment: {
      type: 'object',
      description: 'Fiche équipement, relations salle/fournisseur et réseau. agentToken, qrToken et agentAlertState sont exclus. Les autres champs de la fiche peuvent être présents.',
      properties: {
        id: string, name: string, type: string, brand: nullableString, model: nullableString,
        serialNumber: nullableString, invoiceNumber: nullableString, deliveryNoteNumber: nullableString,
        status, description: nullableString, roomId: nullableString, supplierId: nullableString,
        purchaseDate: date, warrantyEnd: date, purchasePrice: { type: 'number', nullable: true },
        createdAt: date, updatedAt: date, lastSeenAt: date, agentHostname: nullableString,
        agentInfo: { ...nullableString, description: 'Informations agent sous forme de chaîne JSON sérialisée.' },
        discoverySource: string, discoveryStatus: string, suggestedRoomId: nullableString,
        agentRevoked: { type: 'boolean' }, enrollmentTokenId: nullableString,
        room: { type: 'object', nullable: true, properties: { id: string, name: string, number: nullableString, building: nullableString } },
        supplierRef: { type: 'object', nullable: true, properties: { id: string, name: string } },
        ipAddresses: { type: 'array', items: ref('IntegrationIpAddress') },
        networkInterfaces: { type: 'array', items: ref('IntegrationNetworkInterface') }
      }
    }
  });

  document.tags.push({
    name: 'API publique v1',
    description: 'API d’intégration authentifiée, en lecture seule. Base /api/v1. Les clés API sont celles de la gestion des jetons MCP. Chaque opération indique son scope requis. Pagination par curseur, tri croissant sur id. Limites par IP : 240 requêtes/15 min partagées avec les appels MCP limités, et 500 requêtes/15 min partagées avec /api/. Aucun secret agent ou QR n’est renvoyé.'
  });
  const errors = {
    401: {
      ...json('Jeton absent, invalide, expiré, révoqué ou compte désactivé.', ref('IntegrationAuthError'), {
        jsonrpc: '2.0', error: { code: -32001, message: 'Authentification MCP requise' }, id: null
      }),
      headers: { 'WWW-Authenticate': { schema: string, description: 'Challenge Bearer ou erreur invalid_token.' } }
    },
    403: json('Scope de lecture requis absent.', ref('Error')),
    429: {
      ...json('Quota par IP atteint. Réessayer après Retry-After.', {
        oneOf: [ref('Error'), ref('IntegrationAuthError')]
      }),
      headers: { 'Retry-After': { schema: { type: 'integer' }, description: 'Délai en secondes avant une nouvelle tentative.' } }
    },
    500: json('Erreur serveur.', ref('Error'))
  };
  const operation = (operationId, summary, scope, parameters, schema, detail = false) => ({
    operationId, tags: ['API publique v1'], summary,
    description: `Scope requis : ${scope}. Authentification par clé API MCP ou access_token OAuth2.`,
    security: [{ integrationBearer: [] }], parameters,
    responses: {
      200: json('Lecture réussie.', schema),
      ...errors,
      ...(detail ? { 404: json('Ressource introuvable.', ref('Error')) } : {})
    }
  });
  const id = [{ name: 'id', in: 'path', required: true, description: 'Identifiant de la ressource.', schema: string }];
  Object.assign(document.paths, {
    '/v1/equipment': { get: operation('listIntegrationEquipment', 'Lister les équipements', 'equipment:read', [
      query('search', 'Recherche dans nom, série, marque, modèle, hostname agent, numéro de facture ou de BL.'),
      query('type', 'Filtre partiel sur le type.'), query('roomId', 'Identifiant exact de la salle.'),
      query('status', 'Statut exact.', status), query('ip', 'Filtre partiel sur les adresses IPAM liées.'),
      query('mac', 'Filtre partiel sur les adresses MAC des interfaces, dans leur format stocké.'), ...pagination
    ], page('IntegrationEquipment')) },
    '/v1/equipment/{id}': { get: operation('getIntegrationEquipment', 'Consulter un équipement', 'equipment:read', id, ref('IntegrationEquipment'), true) },
    '/v1/rooms': { get: operation('listIntegrationRooms', 'Lister les salles', 'rooms:read', [
      query('search', 'Recherche dans nom, numéro ou description.'), query('building', 'Filtre partiel sur le bâtiment.'), ...pagination
    ], page('IntegrationRoom')) },
    '/v1/rooms/{id}': { get: operation('getIntegrationRoom', 'Consulter une salle et ses équipements', 'rooms:read', id, ref('IntegrationRoom'), true) }
  });
  document.paths['/v1/equipment'].get.responses[400] = json('Statut invalide.', ref('Error'), { error: 'Statut invalide' });
};
