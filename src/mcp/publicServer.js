const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const { z } = require('zod');
const prisma = require('../lib/prisma');
const { ensureLoanAvailability } = require('../utils/loans');
const { normalizeToUTC } = require('./tzUtils');

function response(value) { return { content: [{ type: 'text', text: JSON.stringify(value) }] }; }
function failure(error) { return { content: [{ type: 'text', text: error.message }], isError: true }; }
function guarded(fn) { return async args => { try { return response(await fn(args)); } catch (error) { if (error.status && error.status < 500) return failure(error); throw error; } }; }

function buildPublicMcpServer(identity) {
  const server = new McpServer({ name: 'maintenanceboard-public', version: '1.0.0' });
  const read = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
  const write = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
  server.registerTool('list_tablet_resources', {
    description: 'Liste les ressources de tablettes proposées aux demandes de réservation.', inputSchema: {}, annotations: read
  }, guarded(async () => (await prisma.loanResource.findMany({ where: { isActive: true }, select: { id: true, name: true, totalUnits: true, bundleSize: true, location: true } })).filter(resource => resource.name.toLowerCase().includes('tablette'))));
  server.registerTool('request_tablet_booking', {
    description: 'Crée une demande de réservation de tablettes en attente de validation.',
    inputSchema: {
      resourceId: z.string(), requesterName: z.string().min(2).max(200),
      startAt: z.string(), endAt: z.string(), requestedUnits: z.number().int().min(1).max(500),
      notes: z.string().max(2000).optional()
    }, annotations: write
  }, guarded(async input => {
    const resource = await prisma.loanResource.findUnique({ where: { id: input.resourceId } });
    if (!resource?.isActive || !resource.name.toLowerCase().includes('tablette')) throw Object.assign(new Error('Ressource de tablettes indisponible'), { status: 404 });
    let start;
    let end;
    try { start = normalizeToUTC(input.startAt); end = normalizeToUTC(input.endAt); }
    catch { throw Object.assign(new Error('Période invalide'), { status: 400 }); }
    if (!start || !end || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start >= end) throw Object.assign(new Error('Période invalide'), { status: 400 });
    const availability = await ensureLoanAvailability(prisma, { resourceId: input.resourceId, startAt: start, endAt: end, requestedUnits: input.requestedUnits });
    const link = await prisma.loanMagicLink.findFirst({ where: { title: 'Lien général de demande', isActive: true, resourceId: null, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }, orderBy: { createdAt: 'desc' } });
    if (!link) throw Object.assign(new Error('Les demandes publiques ne sont pas activées'), { status: 503 });
    const reservation = await prisma.loanReservation.create({ data: {
      resourceId: resource.id, requestLinkId: link.id, requesterName: input.requesterName.trim(), requesterEmail: identity.email,
      startAt: start, endAt: end, requestedUnits: availability.requestedUnits, reservedSlots: availability.reservedSlots,
      notes: input.notes?.trim() || null
    } });
    return { id: reservation.id, status: reservation.status, requesterEmail: identity.email };
  }));
  server.registerTool('request_intervention', {
    description: 'Crée une demande publique d’intervention en attente de traitement.',
    inputSchema: { title: z.string().min(3).max(200), description: z.string().max(2000).optional(), reporterName: z.string().min(2).max(200), suggestedRoom: z.string().max(200).optional() }, annotations: write
  }, guarded(async input => {
    const { randomUUID } = require('crypto');
    const recent = await prisma.intervention.findFirst({ where: { reporterEmail: identity.email, source: 'PUBLIC', createdAt: { gte: new Date(Date.now() - 10 * 60 * 1000) } }, select: { id: true } });
    if (recent) throw Object.assign(new Error('Veuillez patienter avant de soumettre une nouvelle intervention.'), { status: 429 });
    const reporterToken = randomUUID();
    const intervention = await prisma.intervention.create({ data: {
      title: input.title.trim(), description: input.description?.trim() || null,
      status: 'OPEN', priority: 'NORMAL', source: 'PUBLIC',
      reporterName: input.reporterName.trim(), reporterEmail: identity.email,
      suggestedRoom: input.suggestedRoom?.trim() || null, reporterToken,
      reporters: { create: { name: input.reporterName.trim(), email: identity.email, token: reporterToken, isPrimary: true, notifyByEmail: true } }
    } });
    return { id: intervention.id, status: intervention.status, reporterEmail: identity.email };
  }));
  return server;
}

async function handlePublicMcp(req, res) {
  const server = buildPublicMcpServer(req.publicMcpIdentity);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on('close', () => { transport.close().catch(() => {}); server.close().catch(() => {}); });
  if (req.method === 'POST') {
    req.headers.accept = 'application/json, text/event-stream';
    const index = req.rawHeaders.findIndex((value, i) => i % 2 === 0 && value.toLowerCase() === 'accept');
    if (index < 0) req.rawHeaders.push('accept', req.headers.accept);
    else req.rawHeaders[index + 1] = req.headers.accept;
  }
  try { await server.connect(transport); await transport.handleRequest(req, res, req.body); }
  catch (error) { if (!res.headersSent) res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Erreur interne MCP' }, id: null }); }
}

module.exports = { buildPublicMcpServer, handlePublicMcp };
