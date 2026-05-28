const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const { z } = require('zod');

const { MCP_SCOPES, hasScope } = require('../utils/mcpTokens');
const reservations = require('./reservationsService');

const SERVER_INFO = { name: 'maintenanceboard-loans', version: '1.0.0' };

function jsonResult(payload) {
  return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] };
}

function errorResult(message) {
  return { content: [{ type: 'text', text: message }], isError: true };
}

// Enveloppe un handler d'outil : vérifie le scope, exécute, et formate erreurs métier.
function tool(ctx, requiredScope, fn) {
  return async (args) => {
    if (!hasScope(ctx.scopes, requiredScope)) {
      return errorResult(`Scope « ${requiredScope} » requis pour cet outil. Scopes du token : ${ctx.scopes.join(', ') || 'aucun'}.`);
    }
    try {
      const result = await fn(args);
      return jsonResult(result);
    } catch (err) {
      if (err.status && err.status < 500) {
        return errorResult(err.message);
      }
      throw err;
    }
  };
}

/**
 * Construit un serveur MCP lié au contexte d'un token (scopes + utilisateur créateur).
 * Les outils sont systématiquement protégés par scope.
 */
function buildMcpServer(ctx) {
  const server = new McpServer(SERVER_INFO);
  const userId = ctx.createdBy?.id || null;

  server.registerTool('list_resources', {
    description: 'Liste les ressources de matériel empruntables (actives) avec leur capacité (lots disponibles) et les appareils nominatifs associés.',
    inputSchema: {}
  }, tool(ctx, MCP_SCOPES.RESERVATIONS_READ, () => reservations.listResources()));

  server.registerTool('check_availability', {
    description: 'Vérifie si une ressource est disponible sur une période donnée pour un nombre d\'unités, et renvoie les lots restants.',
    inputSchema: {
      resourceId: z.string().describe('ID de la ressource de prêt'),
      startAt: z.string().describe('Date/heure de début au format ISO 8601'),
      endAt: z.string().describe('Date/heure de fin au format ISO 8601'),
      requestedUnits: z.number().int().min(1).max(500).optional().describe('Nombre d\'unités souhaitées (défaut 1)')
    }
  }, tool(ctx, MCP_SCOPES.RESERVATIONS_READ, (a) => reservations.checkAvailability(a)));

  server.registerTool('list_reservations', {
    description: 'Liste les réservations sur une fenêtre temporelle, avec filtres optionnels par statut et par ressource.',
    inputSchema: {
      start: z.string().optional().describe('Début de la fenêtre (ISO 8601, défaut : il y a 7 jours)'),
      end: z.string().optional().describe('Fin de la fenêtre (ISO 8601, défaut : dans 60 jours)'),
      status: z.enum(reservations.RESERVATION_STATUSES).optional().describe('Filtre par statut'),
      resourceId: z.string().optional().describe('Filtre par ressource')
    }
  }, tool(ctx, MCP_SCOPES.RESERVATIONS_READ, (a) => reservations.listReservations(a)));

  server.registerTool('create_reservation', {
    description: 'Crée une réservation de matériel après vérification de disponibilité. Statut PENDING par défaut (APPROVED possible). Échoue si la période est complète.',
    inputSchema: {
      resourceId: z.string().describe('ID de la ressource de prêt'),
      requesterName: z.string().min(2).max(200).describe('Nom du demandeur'),
      requesterEmail: z.string().email().describe('Email du demandeur'),
      requesterPhone: z.string().max(80).optional(),
      requesterOrganization: z.string().max(200).optional(),
      startAt: z.string().describe('Date/heure de début (ISO 8601)'),
      endAt: z.string().describe('Date/heure de fin (ISO 8601)'),
      requestedUnits: z.number().int().min(1).max(500).describe('Nombre d\'unités demandées'),
      notes: z.string().max(2000).optional().describe('Notes visibles par le demandeur'),
      internalNotes: z.string().max(2000).optional().describe('Notes internes (staff)'),
      selectedEquipmentIds: z.array(z.string()).max(500).optional().describe('IDs d\'appareils nominatifs (doivent appartenir à la ressource)'),
      status: z.enum(['PENDING', 'APPROVED']).optional().describe('Statut initial (défaut PENDING)')
    }
  }, tool(ctx, MCP_SCOPES.RESERVATIONS_WRITE, (a) => reservations.createReservation(a, { userId })));

  server.registerTool('update_reservation', {
    description: 'Modifie une réservation existante (dates, quantité, demandeur, statut, notes). Re-vérifie la disponibilité si la période/quantité change ou en cas d\'approbation. Refuse si une fiche signée existe.',
    inputSchema: {
      id: z.string().describe('ID de la réservation à modifier'),
      resourceId: z.string().optional(),
      requesterName: z.string().min(2).max(200).optional(),
      requesterEmail: z.string().email().optional(),
      requesterPhone: z.string().max(80).optional(),
      requesterOrganization: z.string().max(200).optional(),
      startAt: z.string().optional().describe('Nouvelle date de début (ISO 8601)'),
      endAt: z.string().optional().describe('Nouvelle date de fin (ISO 8601)'),
      requestedUnits: z.number().int().min(1).max(500).optional(),
      status: z.enum(reservations.RESERVATION_STATUSES).optional(),
      notes: z.string().max(2000).optional(),
      internalNotes: z.string().max(2000).optional()
    }
  }, tool(ctx, MCP_SCOPES.RESERVATIONS_WRITE, ({ id, ...rest }) => reservations.updateReservation(id, rest, { userId })));

  return server;
}

/**
 * Handler Express pour POST /mcp en mode stateless : un serveur + transport
 * éphémères par requête (sessionIdGenerator: undefined). req.mcpToken doit être
 * fourni en amont par le middleware mcpAuth.
 */
async function handleMcpRequest(req, res) {
  const ctx = req.mcpToken;
  if (!ctx) {
    return res.status(401).json({
      jsonrpc: '2.0',
      error: { code: -32001, message: 'Contexte d\'authentification MCP manquant' },
      id: null
    });
  }

  const server = buildMcpServer(ctx);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

  res.on('close', () => {
    transport.close().catch(() => {});
    server.close().catch(() => {});
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: '2.0',
        error: { code: -32603, message: 'Erreur interne du serveur MCP' },
        id: null
      });
    }
  }
}

// En mode stateless, les flux GET (SSE) et la terminaison DELETE de session ne s'appliquent pas.
function methodNotAllowed(_req, res) {
  res.status(405).json({
    jsonrpc: '2.0',
    error: { code: -32000, message: 'Méthode non supportée. Le serveur MCP est sans session (utilisez POST).' },
    id: null
  });
}

module.exports = { buildMcpServer, handleMcpRequest, methodNotAllowed };
