const swaggerUi = require('swagger-ui-express');

const swaggerDocument = {
  openapi: '3.0.0',
  info: {
    title: 'MaintenanceBoard API',
    version: '1.0.0',
    description: 'API de gestion du parc informatique scolaire',
    contact: {
      name: 'Support',
      email: 'admin@maintenance.local'
    }
  },
  servers: [
    { url: '/api', description: 'API principale' }
  ],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT'
      }
    },
    schemas: {
      Error: {
        type: 'object',
        properties: {
          error: { type: 'string' }
        }
      },
      User: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          email: { type: 'string', format: 'email' },
          name: { type: 'string' },
          role: { type: 'string', enum: ['ADMIN', 'TECH'] },
          isActive: { type: 'boolean' },
          createdAt: { type: 'string', format: 'date-time' }
        }
      },
      Room: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          name: { type: 'string' },
          building: { type: 'string' },
          floor: { type: 'integer' },
          number: { type: 'string' },
          description: { type: 'string' },
          qrToken: { type: 'string' },
          createdAt: { type: 'string', format: 'date-time' }
        }
      },
      Equipment: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          name: { type: 'string' },
          type: { type: 'string' },
          brand: { type: 'string' },
          model: { type: 'string' },
          serialNumber: { type: 'string' },
          status: { type: 'string', enum: ['ACTIVE', 'INACTIVE', 'REPAIR', 'DECOMMISSIONED'] },
          roomId: { type: 'string' },
          qrToken: { type: 'string' }
        }
      },
      Intervention: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          title: { type: 'string' },
          description: { type: 'string' },
          status: { type: 'string', enum: ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'] },
          priority: { type: 'string' },
          roomId: { type: 'string' },
          equipmentId: { type: 'string' },
          techId: { type: 'string' },
          photos: { type: 'array', items: { type: 'string' } },
          createdAt: { type: 'string', format: 'date-time' }
        }
      },
      Order: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          title: { type: 'string' },
          status: { type: 'string', enum: ['PENDING', 'ORDERED', 'PARTIAL', 'RECEIVED', 'CANCELLED'] },
          supplier: { type: 'string' },
          totalAmount: { type: 'number' },
          items: { type: 'array', items: { $ref: '#/components/schemas/OrderItem' } }
        }
      },
      OrderItem: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          quantity: { type: 'integer' },
          unitPrice: { type: 'number' },
          reference: { type: 'string' },
          received: { type: 'integer' }
        }
      }
    }
  },
  security: [{ bearerAuth: [] }],
  tags: [
    { name: 'Auth', description: 'Authentification (password + WebAuthn)' },
    { name: 'Rooms', description: 'Gestion des salles' },
    { name: 'Equipment', description: 'Gestion des équipements' },
    { name: 'Interventions', description: 'Gestion des interventions' },
    { name: 'Orders', description: 'Gestion des commandes' },
    { name: 'QRCode', description: 'QR codes et résolution de tokens' }
  ],
  paths: {
    '/auth/login': {
      post: {
        tags: ['Auth'],
        summary: 'Connexion par mot de passe',
        security: [],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['email', 'password'],
                properties: {
                  email: { type: 'string', format: 'email' },
                  password: { type: 'string' }
                }
              }
            }
          }
        },
        responses: {
          200: { description: 'Connexion réussie' },
          401: { description: 'Identifiants invalides' }
        }
      }
    },
    '/auth/me': {
      get: {
        tags: ['Auth'],
        summary: 'Profil de l\'utilisateur courant',
        responses: {
          200: { description: 'Profil utilisateur' },
          401: { description: 'Non authentifié' }
        }
      }
    },
    '/rooms': {
      get: {
        tags: ['Rooms'],
        summary: 'Liste des salles',
        parameters: [
          { name: 'search', in: 'query', schema: { type: 'string' } },
          { name: 'building', in: 'query', schema: { type: 'string' } },
          { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } }
        ],
        responses: { 200: { description: 'Liste des salles' } }
      },
      post: {
        tags: ['Rooms'],
        summary: 'Créer une salle',
        responses: { 201: { description: 'Salle créée' } }
      }
    },
    '/rooms/import': {
      post: {
        tags: ['Rooms'],
        summary: 'Import CSV/Excel de salles en masse',
        requestBody: {
          content: {
            'multipart/form-data': {
              schema: {
                type: 'object',
                properties: {
                  file: { type: 'string', format: 'binary' },
                  skipErrors: { type: 'boolean', default: false }
                }
              }
            }
          }
        },
        responses: { 200: { description: 'Import effectué' } }
      }
    },
    '/equipment': {
      get: {
        tags: ['Equipment'],
        summary: 'Liste des équipements',
        parameters: [
          { name: 'search', in: 'query', schema: { type: 'string' } },
          { name: 'status', in: 'query', schema: { type: 'string' } },
          { name: 'type', in: 'query', schema: { type: 'string' } },
          { name: 'roomId', in: 'query', schema: { type: 'string' } }
        ],
        responses: { 200: { description: 'Liste des équipements' } }
      }
    },
    '/interventions': {
      get: {
        tags: ['Interventions'],
        summary: 'Liste des interventions',
        responses: { 200: { description: 'Liste des interventions' } }
      },
      post: {
        tags: ['Interventions'],
        summary: 'Créer une intervention',
        responses: { 201: { description: 'Intervention créée' } }
      }
    },
    '/orders': {
      get: {
        tags: ['Orders'],
        summary: 'Liste des commandes',
        responses: { 200: { description: 'Liste des commandes' } }
      }
    },
    '/qrcode/resolve/{token}': {
      get: {
        tags: ['QRCode'],
        summary: 'Résoudre un token QR',
        security: [],
        parameters: [
          { name: 'token', in: 'path', required: true, schema: { type: 'string' } }
        ],
        responses: {
          200: { description: 'Données de la ressource identifiée' },
          404: { description: 'Token inconnu' }
        }
      }
    }
  }
};

module.exports = { swaggerUi, swaggerDocument };
