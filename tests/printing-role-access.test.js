const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');

jest.mock('../src/config', () => ({ jwt: { secret: 'printing-role-test' } }));
jest.mock('../src/lib/prisma', () => ({
  mcpToken: { findUnique: jest.fn(), update: jest.fn() },
  user: { findUnique: jest.fn(), update: jest.fn() },
  printer: { upsert: jest.fn(), findMany: jest.fn() },
  printerJob: { findMany: jest.fn(), groupBy: jest.fn() }
}));
jest.mock('../src/services/printerLogService', () => ({
  parsePrinterLog: jest.fn().mockResolvedValue({ printer: { name: 'C2', serial: '123' }, jobs: [] })
}));
const prisma = require('../src/lib/prisma');
const { requireAuth, optionalAuth } = require('../src/middleware/auth');
const { mcpAuth } = require('../src/middleware/mcpAuth');
const { DIRECT_MCP_CLIENT_ID, getUserMcpScopes } = require('../src/utils/mcpTokens');
const app = express();
app.use(express.json());
app.use('/mcp', mcpAuth, (_req, res) => res.json({ ok: true }));
app.use('/api/printer-logs', require('../src/routes/printerLogs'));
app.use('/api/users', require('../src/routes/users'));
app.get('/api/qrcode/resolve/test', optionalAuth, (req, res) => res.json({ staff: !!req.user }));
app.use(requireAuth, (req, res) => res.json({ role: req.user.role }));
app.use((err, _req, res, _next) => res.status(500).json({ error: err.message }));
const token = jwt.sign({ userId: 'manager' }, 'printing-role-test');
const authorization = `Bearer ${token}`;

test('aucune permission MCP ne peut être accordée à un gestionnaire des impressions', () => {
  expect(getUserMcpScopes({ role: 'PRINT_MANAGER' })).toEqual([]);
});

beforeEach(() => {
  jest.clearAllMocks();
  prisma.user.findUnique.mockResolvedValue({ id: 'manager', name: 'Manager', role: 'PRINT_MANAGER', isActive: true });
  prisma.printer.upsert.mockResolvedValue({ id: 'p1', name: 'C2', serial: '123' });
  prisma.printer.findMany.mockResolvedValue([]);
  prisma.printerJob.findMany.mockResolvedValue([]);
  prisma.printerJob.groupBy.mockResolvedValue([]);
});

test('le gestionnaire peut importer et consulter les impressions', async () => {
  const imported = await request(app).post('/api/printer-logs/import').set('Authorization', authorization).attach('file', Buffer.from('csv'), 'journal.csv');
  expect(imported.status).toBe(200);
  const summary = await request(app).get('/api/printer-logs/summary?groupBy=ownerName').set('Authorization', authorization);
  expect(summary.status).toBe(200);
});

test.each(['/api/dashboard', '/api/equipment', '/api/messages', '/api/users', '/api/auth/register', '/api/printer-logs-extra'])('bloque le gestionnaire hors impressions : %s', async path => {
  const response = await request(app).get(path).set('Authorization', authorization);
  expect(response.status).toBe(403);
});

test.each(['/api/auth/me', '/api/auth/logout', '/api/auth/change-password', '/api/auth/webauthn/register/begin', '/api/auth/passkeys/my-key'])('conserve la gestion du compte personnel : %s', async path => {
  const response = await request(app).get(path).set('Authorization', authorization);
  expect(response.status).toBe(200);
});

test('un compte impression ne reçoit pas les droits internes sur une route publique', async () => {
  const response = await request(app).get('/api/qrcode/resolve/test').set('Authorization', authorization);
  expect(response.body.staff).toBe(false);
});

test('un administrateur peut attribuer le nouveau rôle', async () => {
  prisma.user.findUnique.mockResolvedValue({ id: 'admin', role: 'ADMIN', isActive: true });
  prisma.user.update.mockResolvedValue({ id: 'manager', role: 'PRINT_MANAGER' });
  const response = await request(app).patch('/api/users/manager').set('Authorization', authorization).send({ role: 'PRINT_MANAGER' });
  expect(response.status).toBe(200);
  expect(prisma.user.update).toHaveBeenCalledWith(expect.objectContaining({ data: { role: 'PRINT_MANAGER' } }));
});

test('le technicien conserve la consultation mais ne peut pas importer', async () => {
  prisma.user.findUnique.mockResolvedValue({ id: 'tech', role: 'TECH', isActive: true });
  expect((await request(app).get('/api/printer-logs/summary').set('Authorization', authorization)).status).toBe(200);
  expect((await request(app).post('/api/printer-logs/import').set('Authorization', authorization)).status).toBe(403);
});

test.each(['native', 'client', 'direct', 'code'])('bloque aussi un ancien accès MCP après changement de rôle : %s', async mode => {
  prisma.mcpToken.findUnique.mockResolvedValue({ id: 'm1', scopes: '["equipment:read"]', createdBy: { isActive: true, role: 'PRINT_MANAGER' } });
  const payload = mode === 'client' ? { type: 'mcp_access', sub: 'm1' }
    : { type: 'mcp_user_access', sub: 'manager', clientId: mode === 'direct' ? DIRECT_MCP_CLIENT_ID : 'client', mcpTokenId: 'm1' };
  const credential = mode === 'native' ? 'mcp_test' : jwt.sign(payload, 'printing-role-test');
  const response = await request(app).post('/mcp').set('Authorization', `Bearer ${credential}`);
  expect(response.status).toBe(401);
  expect(prisma.mcpToken.update).not.toHaveBeenCalled();
});
