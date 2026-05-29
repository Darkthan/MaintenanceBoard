const { randomUUID } = require('crypto');
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const { z } = require('zod');

const { MCP_SCOPES, hasScope } = require('../utils/mcpTokens');
const reservations = require('./reservationsService');
const work = require('./workService');

const SERVER_INFO = { name: 'maintenanceboard', version: '1.1.0' };

function jsonResult(payload) {
  return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] };
}

function errorResult(message) {
  return { content: [{ type: 'text', text: message }], isError: true };
}

// Enveloppe un handler d'outil : vérifie le scope, exécute, et formate erreurs métier.
function tool(ctx, requiredScope, fn) {
  return async (args) => {
    const requiredScopes = Array.isArray(requiredScope) ? requiredScope : [requiredScope];
    if (!requiredScopes.some(scope => hasScope(ctx.scopes, scope))) {
      return errorResult(`Scope requis : ${requiredScopes.join(' ou ')}. Scopes du token : ${ctx.scopes.join(', ') || 'aucun'}.`);
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
  const user = ctx.createdBy || null;
  const userId = ctx.createdBy?.id || null;
  const bookingsReadScopes = [MCP_SCOPES.EQUIPMENT_BOOKINGS_READ, MCP_SCOPES.RESERVATIONS_READ];
  const bookingsWriteScopes = [MCP_SCOPES.EQUIPMENT_BOOKINGS_WRITE, MCP_SCOPES.RESERVATIONS_WRITE];

  const bookingCreateSchema = {
    resourceId: z.string().describe('Identifiant de la ressource de matériel informatique scolaire'),
    requesterName: z.string().min(2).max(200).describe('Nom de la personne qui emprunte le matériel'),
    requesterEmail: z.string().email().optional().describe('Email de contact. Optionnel si un email par défaut est configuré dans MaintenanceBoard.'),
    startAt: z.string().describe('Date et heure de début au format ISO 8601'),
    endAt: z.string().describe('Date et heure de fin au format ISO 8601'),
    requestedUnits: z.number().int().min(1).max(500).describe('Nombre d’unités de matériel informatique scolaire'),
    notes: z.string().max(2000).optional().describe('Note courte liée à l’emprunt de matériel')
  };

  const tabletCaseSchema = {
    requesterName: z.string().min(2).max(200).describe('Nom de la personne qui emprunte le matériel'),
    requesterEmail: z.string().email().optional().describe('Email de contact. Optionnel si un email par défaut est configuré dans MaintenanceBoard.'),
    startAt: z.string().describe('Date et heure de début au format ISO 8601'),
    endAt: z.string().describe('Date et heure de fin au format ISO 8601'),
    requestedUnits: z.number().int().min(1).max(500).describe('Nombre de tablettes'),
    notes: z.string().max(2000).optional().describe('Note courte liée à l’emprunt de matériel')
  };

  server.registerTool('list_resources', {
    description: 'Liste le matériel informatique scolaire empruntable avec sa capacité.',
    inputSchema: {}
  }, tool(ctx, bookingsReadScopes, () => reservations.listResources()));

  server.registerTool('check_equipment_availability', {
    description: 'Indique la disponibilité d’un matériel informatique scolaire sur une période donnée.',
    inputSchema: {
      resourceId: z.string().describe('Identifiant de la ressource de matériel informatique scolaire'),
      startAt: z.string().describe('Date et heure de début au format ISO 8601'),
      endAt: z.string().describe('Date et heure de fin au format ISO 8601'),
      requestedUnits: z.number().int().min(1).max(500).optional().describe('Nombre d’unités de matériel informatique scolaire')
    }
  }, tool(ctx, bookingsReadScopes, (a) => reservations.checkAvailability(a)));

  server.registerTool('list_equipment_bookings', {
    description: 'Liste les emprunts de matériel informatique scolaire sur une fenêtre temporelle.',
    inputSchema: {
      start: z.string().optional().describe('Début de la fenêtre au format ISO 8601'),
      end: z.string().optional().describe('Fin de la fenêtre au format ISO 8601'),
      resourceId: z.string().optional().describe('Identifiant de la ressource de matériel informatique scolaire')
    }
  }, tool(ctx, bookingsReadScopes, (a) => reservations.listReservations(a)));

  server.registerTool('create_equipment_booking', {
    description: 'Ajoute un emprunt de matériel informatique scolaire dans MaintenanceBoard.',
    inputSchema: bookingCreateSchema
  }, tool(ctx, bookingsWriteScopes, (a) => reservations.createEquipmentBooking(a, { userId, user })));

  server.registerTool('book_tablet_case', {
    description: 'Ajoute un emprunt de tablettes depuis la ressource de matériel informatique scolaire “Tablettes Valise”.',
    inputSchema: tabletCaseSchema
  }, tool(ctx, bookingsWriteScopes, (a) => reservations.bookTabletCase(a, { userId, user })));

  server.registerTool('preview_equipment_booking', {
    description: 'Prépare un aperçu non destructif d’un emprunt de matériel informatique scolaire, sans écrire en base.',
    inputSchema: bookingCreateSchema
  }, tool(ctx, bookingsReadScopes, (a) => reservations.previewEquipmentBooking(a, { user })));

  server.registerTool('update_equipment_booking', {
    description: 'Met à jour les informations simples d’un emprunt de matériel informatique scolaire.',
    inputSchema: {
      id: z.string().describe('Identifiant de l’emprunt de matériel'),
      resourceId: z.string().optional(),
      requesterName: z.string().min(2).max(200).optional(),
      requesterEmail: z.string().email().optional(),
      startAt: z.string().optional().describe('Date et heure de début au format ISO 8601'),
      endAt: z.string().optional().describe('Date et heure de fin au format ISO 8601'),
      requestedUnits: z.number().int().min(1).max(500).optional(),
      notes: z.string().max(2000).optional()
    }
  }, tool(ctx, bookingsWriteScopes, ({ id, ...rest }) => reservations.updateReservation(id, rest, { userId })));

  server.registerTool('list_interventions', {
    description: 'Liste les interventions de maintenance avec filtres par statut, priorité, salle, équipement, technicien ou recherche texte.',
    inputSchema: {
      status: z.enum(work.INTERVENTION_STATUSES).optional(),
      priority: z.enum(work.INTERVENTION_PRIORITIES).optional(),
      search: z.string().max(200).optional(),
      roomId: z.string().optional(),
      equipmentId: z.string().optional(),
      techId: z.string().optional(),
      archived: z.boolean().optional(),
      limit: z.number().int().min(1).max(100).optional()
    }
  }, tool(ctx, MCP_SCOPES.INTERVENTIONS_READ, (a) => work.listInterventions(a, { user })));

  server.registerTool('get_intervention', {
    description: 'Récupère le détail compact d\'une intervention par ID.',
    inputSchema: {
      id: z.string().describe('ID de l\'intervention')
    }
  }, tool(ctx, MCP_SCOPES.INTERVENTIONS_READ, (a) => work.getIntervention(a, { user })));

  server.registerTool('create_intervention', {
    description: 'Crée une intervention standard de maintenance. Pour les interventions ouvertes liées à un équipement actif, l\'équipement passe en réparation.',
    inputSchema: {
      title: z.string().min(3).max(300),
      description: z.string().max(2000).optional(),
      notes: z.string().max(5000).optional(),
      status: z.enum(work.INTERVENTION_STATUSES).optional(),
      priority: z.enum(work.INTERVENTION_PRIORITIES).optional(),
      roomId: z.string().optional(),
      equipmentId: z.string().optional(),
      techId: z.string().optional(),
      suggestedRoom: z.string().max(200).optional(),
      suggestedEquipment: z.string().max(200).optional(),
      scheduledStartAt: z.string().optional(),
      scheduledEndAt: z.string().optional(),
      dueAt: z.string().optional()
    }
  }, tool(ctx, MCP_SCOPES.INTERVENTIONS_WRITE, (a) => work.createIntervention(a, { userId, user })));

  server.registerTool('update_intervention', {
    description: 'Modifie une intervention existante : titre, statut, priorité, planning, salle, équipement, notes ou résolution.',
    inputSchema: {
      id: z.string(),
      title: z.string().min(3).max(300).optional(),
      description: z.string().max(2000).optional(),
      notes: z.string().max(5000).optional(),
      status: z.enum(work.INTERVENTION_STATUSES).optional(),
      priority: z.enum(work.INTERVENTION_PRIORITIES).optional(),
      resolution: z.string().max(5000).optional(),
      roomId: z.string().optional(),
      equipmentId: z.string().optional(),
      scheduledStartAt: z.string().optional(),
      scheduledEndAt: z.string().optional(),
      dueAt: z.string().optional()
    }
  }, tool(ctx, MCP_SCOPES.INTERVENTIONS_WRITE, (a) => work.updateIntervention(a, { user })));

  server.registerTool('list_orders', {
    description: 'Liste les commandes avec filtres par statut, intervention, archive ou recherche texte.',
    inputSchema: {
      status: z.enum(work.ORDER_STATUSES).optional(),
      search: z.string().max(200).optional(),
      interventionId: z.string().optional(),
      archived: z.boolean().optional(),
      limit: z.number().int().min(1).max(100).optional()
    }
  }, tool(ctx, MCP_SCOPES.ORDERS_READ, (a) => work.listOrders(a, { user })));

  server.registerTool('get_order', {
    description: 'Récupère le détail d\'une commande avec ses lignes et son intervention liée.',
    inputSchema: {
      id: z.string().describe('ID de la commande')
    }
  }, tool(ctx, MCP_SCOPES.ORDERS_READ, (a) => work.getOrder(a, { user })));

  server.registerTool('create_order', {
    description: 'Crée une commande avec une ou plusieurs lignes, éventuellement liée à une intervention.',
    inputSchema: {
      title: z.string().min(3).max(300),
      description: z.string().max(2000).optional(),
      status: z.enum(work.ORDER_STATUSES).optional(),
      supplier: z.string().max(200).optional(),
      supplierId: z.string().optional(),
      totalAmount: z.number().min(0).optional(),
      deploymentTags: z.array(z.string().max(100)).max(50).optional(),
      interventionId: z.string().optional(),
      orderedAt: z.string().optional(),
      expectedDeliveryAt: z.string().optional(),
      receivedAt: z.string().optional(),
      trackingNotes: z.string().max(2000).optional(),
      items: z.array(z.object({
        name: z.string().min(1).max(300),
        quantity: z.number().int().min(1),
        unitPrice: z.number().min(0).optional(),
        priceType: z.enum(work.ORDER_PRICE_TYPES).optional(),
        reference: z.string().max(200).optional(),
        productUrl: z.string().max(1000).optional(),
        notes: z.string().max(1000).optional()
      })).min(1).max(100)
    }
  }, tool(ctx, MCP_SCOPES.ORDERS_WRITE, (a) => work.createOrder(a, { userId, user })));

  server.registerTool('update_order', {
    description: 'Modifie une commande : statut, infos de suivi, intervention liée, archivage ou remplacement des lignes.',
    inputSchema: {
      id: z.string(),
      title: z.string().min(3).max(300).optional(),
      description: z.string().max(2000).optional(),
      status: z.enum(work.ORDER_STATUSES).optional(),
      supplier: z.string().max(200).optional(),
      supplierId: z.string().optional(),
      totalAmount: z.number().min(0).optional(),
      deploymentTags: z.array(z.string().max(100)).max(50).optional(),
      interventionId: z.string().optional(),
      orderedAt: z.string().optional(),
      expectedDeliveryAt: z.string().optional(),
      receivedAt: z.string().optional(),
      trackingNotes: z.string().max(2000).optional(),
      archived: z.boolean().optional(),
      items: z.array(z.object({
        name: z.string().min(1).max(300),
        quantity: z.number().int().min(1),
        unitPrice: z.number().min(0).optional(),
        priceType: z.enum(work.ORDER_PRICE_TYPES).optional(),
        reference: z.string().max(200).optional(),
        productUrl: z.string().max(1000).optional(),
        notes: z.string().max(1000).optional()
      })).min(1).max(100).optional()
    }
  }, tool(ctx, MCP_SCOPES.ORDERS_WRITE, (a) => work.updateOrder(a, { user })));

  server.registerTool('list_stock_items', {
    description: 'Liste les articles de stock avec filtres recherche, catégorie et stock faible.',
    inputSchema: {
      q: z.string().max(200).optional(),
      category: z.string().max(100).optional(),
      lowStock: z.boolean().optional(),
      limit: z.number().int().min(1).max(200).optional()
    }
  }, tool(ctx, MCP_SCOPES.STOCK_READ, (a) => work.listStockItems(a)));

  server.registerTool('get_stock_item', {
    description: 'Récupère le détail d\'un article de stock avec les derniers mouvements.',
    inputSchema: {
      id: z.string().describe('ID de l\'article de stock')
    }
  }, tool(ctx, MCP_SCOPES.STOCK_READ, (a) => work.getStockItem(a)));

  server.registerTool('list_stock_movements', {
    description: 'Liste les mouvements de stock, filtrables par article ou intervention.',
    inputSchema: {
      stockItemId: z.string().optional(),
      interventionId: z.string().optional(),
      limit: z.number().int().min(1).max(100).optional()
    }
  }, tool(ctx, MCP_SCOPES.STOCK_READ, (a) => work.listStockMovements(a)));

  server.registerTool('create_stock_item', {
    description: 'Crée un article de stock.',
    inputSchema: {
      name: z.string().min(1).max(300),
      reference: z.string().max(200).optional(),
      barcode: z.string().max(100).optional(),
      category: z.string().max(100).optional(),
      description: z.string().max(1000).optional(),
      quantity: z.number().int().min(0).optional(),
      minQuantity: z.number().int().min(0).optional(),
      unitCost: z.number().min(0).optional(),
      location: z.string().max(200).optional(),
      supplierId: z.string().optional()
    }
  }, tool(ctx, MCP_SCOPES.STOCK_WRITE, (a) => work.createStockItem(a)));

  server.registerTool('update_stock_item', {
    description: 'Modifie un article de stock.',
    inputSchema: {
      id: z.string(),
      name: z.string().min(1).max(300).optional(),
      reference: z.string().max(200).optional(),
      barcode: z.string().max(100).optional(),
      category: z.string().max(100).optional(),
      description: z.string().max(1000).optional(),
      quantity: z.number().int().min(0).optional(),
      minQuantity: z.number().int().min(0).optional(),
      unitCost: z.number().min(0).optional(),
      location: z.string().max(200).optional(),
      supplierId: z.string().optional()
    }
  }, tool(ctx, MCP_SCOPES.STOCK_WRITE, (a) => work.updateStockItem(a)));

  server.registerTool('create_stock_movement', {
    description: 'Crée un mouvement de stock IN, OUT ou ADJUSTMENT et met à jour la quantité de l\'article.',
    inputSchema: {
      stockItemId: z.string(),
      type: z.enum(work.STOCK_MOVEMENT_TYPES),
      quantity: z.number().int().min(1),
      reason: z.string().max(500).optional(),
      interventionId: z.string().optional()
    }
  }, tool(ctx, MCP_SCOPES.STOCK_WRITE, (a) => work.createStockMovement(a, { userId })));

  server.registerTool('list_todos', {
    description: 'Liste les tâches, éventuellement filtrées par état, retard ou intervention.',
    inputSchema: {
      done: z.boolean().optional(),
      overdue: z.boolean().optional(),
      interventionId: z.string().optional(),
      limit: z.number().int().min(1).max(200).optional()
    }
  }, tool(ctx, MCP_SCOPES.TODOS_READ, (a) => work.listTodos(a)));

  server.registerTool('create_todo', {
    description: 'Crée une tâche standalone ou liée à une intervention.',
    inputSchema: {
      title: z.string().min(1).max(500),
      description: z.string().max(2000).optional(),
      dueAt: z.string().optional(),
      interventionId: z.string().optional()
    }
  }, tool(ctx, MCP_SCOPES.TODOS_WRITE, (a) => work.createTodo(a)));

  server.registerTool('update_todo', {
    description: 'Modifie une tâche : titre, description, échéance, lien intervention ou état terminé.',
    inputSchema: {
      id: z.string(),
      title: z.string().min(1).max(500).optional(),
      description: z.string().max(2000).optional(),
      dueAt: z.string().optional(),
      interventionId: z.string().optional(),
      done: z.boolean().optional()
    }
  }, tool(ctx, MCP_SCOPES.TODOS_WRITE, (a) => work.updateTodo(a)));

  server.registerTool('list_projects', {
    description: 'Liste les projets Kanban avec leur créateur et le nombre de colonnes.',
    inputSchema: {
      limit: z.number().int().min(1).max(100).optional()
    }
  }, tool(ctx, MCP_SCOPES.PROJECTS_READ, (a) => work.listProjects(a)));

  server.registerTool('get_project', {
    description: 'Récupère un projet Kanban avec ses colonnes et cartes ordonnées.',
    inputSchema: {
      id: z.string()
    }
  }, tool(ctx, MCP_SCOPES.PROJECTS_READ, (a) => work.getProject(a)));

  server.registerTool('create_project', {
    description: 'Crée un projet Kanban.',
    inputSchema: {
      title: z.string().min(1).max(200),
      description: z.string().max(1000).optional(),
      color: z.string().max(40).optional()
    }
  }, tool(ctx, MCP_SCOPES.PROJECTS_WRITE, (a) => work.createProject(a, { userId })));

  server.registerTool('update_project', {
    description: 'Modifie le titre, la description ou la couleur d\'un projet.',
    inputSchema: {
      id: z.string(),
      title: z.string().min(1).max(200).optional(),
      description: z.string().max(1000).optional(),
      color: z.string().max(40).optional()
    }
  }, tool(ctx, MCP_SCOPES.PROJECTS_WRITE, (a) => work.updateProject(a)));

  server.registerTool('create_project_column', {
    description: 'Ajoute une colonne à la fin d\'un projet Kanban.',
    inputSchema: {
      projectId: z.string(),
      title: z.string().min(1).max(100),
      color: z.string().max(40).optional()
    }
  }, tool(ctx, MCP_SCOPES.PROJECTS_WRITE, (a) => work.createProjectColumn(a)));

  server.registerTool('update_project_column', {
    description: 'Modifie le titre ou la couleur d\'une colonne de projet Kanban.',
    inputSchema: {
      projectId: z.string(),
      columnId: z.string(),
      title: z.string().min(1).max(100).optional(),
      color: z.string().max(40).optional()
    }
  }, tool(ctx, MCP_SCOPES.PROJECTS_WRITE, (a) => work.updateProjectColumn(a)));

  server.registerTool('create_project_card', {
    description: 'Crée une carte dans une colonne de projet Kanban.',
    inputSchema: {
      projectId: z.string(),
      columnId: z.string(),
      title: z.string().min(1).max(300),
      description: z.string().max(2000).optional(),
      priority: z.enum(work.CARD_PRIORITIES).optional(),
      dueDate: z.string().optional(),
      assigneeId: z.string().optional()
    }
  }, tool(ctx, MCP_SCOPES.PROJECTS_WRITE, (a) => work.createProjectCard(a)));

  server.registerTool('update_project_card', {
    description: 'Modifie une carte Kanban, y compris son déplacement vers une autre colonne du même projet.',
    inputSchema: {
      projectId: z.string(),
      cardId: z.string(),
      title: z.string().min(1).max(300).optional(),
      description: z.string().max(2000).optional(),
      priority: z.enum(work.CARD_PRIORITIES).optional(),
      dueDate: z.string().optional(),
      assigneeId: z.string().optional(),
      columnId: z.string().optional(),
      note: z.string().optional()
    }
  }, tool(ctx, MCP_SCOPES.PROJECTS_WRITE, (a) => work.updateProjectCard(a)));

  return server;
}

// Sessions MCP actives : sessionId → { transport, server, ctxId, expiresAt }
const mcpSessions = new Map();
const SESSION_TTL = 4 * 60 * 60 * 1000; // 4 heures d'inactivité

setInterval(() => {
  const now = Date.now();
  for (const [id, s] of mcpSessions) {
    if (s.expiresAt < now) {
      s.transport.close().catch(() => {});
      s.server.close().catch(() => {});
      mcpSessions.delete(id);
    }
  }
}, 30 * 60 * 1000).unref();

/**
 * Crée un transport + serveur éphémères, traite la requête, puis les détruit.
 * Utilisé pour les requêtes sans Mcp-Session-Id (mode stateless).
 * Le SDK n'exige pas de séquence initialize → tools/call en mode stateless.
 */
async function handleStateless(req, res, ctx) {
  const server = buildMcpServer(ctx);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on('close', () => { transport.close().catch(() => {}); server.close().catch(() => {}); });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    if (!res.headersSent) {
      res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Erreur interne MCP' }, id: null });
    }
  }
}

/**
 * Handler Express pour GET/POST/DELETE /mcp.
 *
 * Mode dual :
 * - POST sans Mcp-Session-Id → stateless (chaque requête indépendante, aucune
 *   séquence impose — tools/call fonctionne directement sans initialize préalable)
 * - POST avec Mcp-Session-Id → session stateful existante (créée via initialize)
 * - GET avec Mcp-Session-Id → canal SSE pour les notifications serveur → client
 * - DELETE avec Mcp-Session-Id → fermeture de session
 *
 * Ce mode dual assure la compatibilité avec ChatGPT (qui peut envoyer des
 * tools/call sans session si le Mcp-Session-Id n'a pas été retenu) tout en
 * supportant les sessions persistantes pour les clients qui les gèrent.
 */
async function handleMcpRequest(req, res) {
  // Le SDK StreamableHTTP (via @hono/node-server) exige Accept contenant à la fois
  // application/json ET text/event-stream sur tous les POST.
  // ChatGPT envoie seulement Accept: application/json → 406 systématique.
  // @hono/node-server lit req.rawHeaders (et non req.headers), les deux doivent être patchés.
  if (req.method !== 'GET') {
    const raw = req.rawHeaders;
    let acceptRawIdx = -1;
    for (let i = 0; i < raw.length; i += 2) {
      if (raw[i].toLowerCase() === 'accept') { acceptRawIdx = i + 1; break; }
    }
    const current = acceptRawIdx >= 0 ? raw[acceptRawIdx] : '';
    if (!current.includes('application/json') || !current.includes('text/event-stream')) {
      const normalized = 'application/json, text/event-stream';
      if (acceptRawIdx === -1) { raw.push('accept', normalized); }
      else { raw[acceptRawIdx] = normalized; }
      req.headers['accept'] = normalized;
    }
  }

  const ctx = req.mcpToken;
  if (!ctx) {
    return res.status(401).json({
      jsonrpc: '2.0',
      error: { code: -32001, message: 'Contexte d\'authentification MCP manquant' },
      id: null
    });
  }

  const sessionId = req.headers['mcp-session-id'];

  // ── GET : canal SSE pour les notifications serveur → client ─────────────
  if (req.method === 'GET') {
    const s = sessionId ? mcpSessions.get(sessionId) : null;
    if (!s) return res.status(404).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Session MCP inconnue ou expirée' }, id: null });
    if (s.ctxId !== ctx.id) return res.status(403).json({ jsonrpc: '2.0', error: { code: -32001, message: 'Token non autorisé pour cette session' }, id: null });
    s.expiresAt = Date.now() + SESSION_TTL;
    return s.transport.handleRequest(req, res);
  }

  // ── DELETE : fermeture explicite d'une session ───────────────────────────
  if (req.method === 'DELETE') {
    const s = sessionId ? mcpSessions.get(sessionId) : null;
    if (!s) return res.status(404).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Session MCP inconnue' }, id: null });
    if (s.ctxId !== ctx.id) return res.status(403).json({ jsonrpc: '2.0', error: { code: -32001, message: 'Token non autorisé' }, id: null });
    await s.transport.handleRequest(req, res);
    s.transport.close().catch(() => {});
    s.server.close().catch(() => {});
    mcpSessions.delete(sessionId);
    return;
  }

  // ── POST : requête JSON-RPC ──────────────────────────────────────────────

  // Requête dans une session stateful existante
  if (sessionId) {
    const s = mcpSessions.get(sessionId);
    // Session inconnue → répondre proprement pour que le client refasse initialize
    if (!s) {
      return res.status(404).json({
        jsonrpc: '2.0',
        error: { code: -32001, message: 'Session MCP expirée, reconnectez le serveur MCP.' },
        id: req.body?.id ?? null
      });
    }
    if (s.ctxId !== ctx.id) return res.status(403).json({ jsonrpc: '2.0', error: { code: -32001, message: 'Token non autorisé' }, id: null });
    s.expiresAt = Date.now() + SESSION_TTL;
    return s.transport.handleRequest(req, res, req.body);
  }

  // Pas de Mcp-Session-Id : traiter en stateless (tools/call direct sans initialize)
  // Si c'est une requête initialize, créer aussi une session stateful en parallèle
  // pour les clients qui savent gérer les sessions.
  if (req.body?.method === 'initialize') {
    const server = buildMcpServer(ctx);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (sid) => {
        mcpSessions.set(sid, { transport, server, ctxId: ctx.id, expiresAt: Date.now() + SESSION_TTL });
      },
      onsessionclosed: (sid) => {
        mcpSessions.delete(sid);
        server.close().catch(() => {});
      }
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      if (!res.headersSent) {
        res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Erreur interne MCP' }, id: null });
      }
      if (transport.sessionId) mcpSessions.delete(transport.sessionId);
      transport.close().catch(() => {});
      server.close().catch(() => {});
    }
    return;
  }

  // tools/list, tools/call, etc. sans session → mode stateless
  return handleStateless(req, res, ctx);
}

module.exports = { buildMcpServer, handleMcpRequest };
