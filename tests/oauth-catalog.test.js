jest.mock('../src/lib/prisma', () => ({ user: { findUnique: jest.fn() } }));
jest.mock('../src/utils/settings', () => ({ readSettings: () => ({}), writeSettings: jest.fn() }));
jest.mock('bcrypt', () => ({ compare: jest.fn() }));
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const express = require('express');
const request = require('supertest');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const prisma = require('../src/lib/prisma');
const { router } = require('../src/routes/oauth');
const wellKnown = require('../src/routes/wellKnown');
const { consumeCode } = require('../src/lib/oauthCodes');
const { ALL_MCP_SCOPES, MCP_SCOPE_ALIASES, getUserMcpScopes } = require('../src/utils/mcpTokens');
const app = express();
app.use(express.urlencoded({ extended: true }));
app.use('/oauth', router);
app.use('/.well-known', wellKnown);
const consent = {
  client_id: 'maintenanceboard-direct-mcp', redirect_uri: 'https://example.com/callback',
  code_challenge: crypto.createHash('sha256').update('test-verifier').digest('base64url'),
  code_challenge_method: 'S256', action: 'approve', response_mode: 'json',
  email: 'admin@example.com', password: 'test-password', scope: 'equipment:read equipment:write'
};

describe('OAuth et droits du catalogue MCP', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    prisma.user.findUnique.mockResolvedValue({ id: 'u1', role: 'ADMIN', isActive: true, passwordHash: 'stored-hash' });
    bcrypt.compare.mockResolvedValue(true);
  });

  it('autorise la connexion avec passwordHash et conserve les droits équipements demandés', async () => {
    const result = await request(app).post('/oauth/authorize').type('form').send(consent);
    expect(result.status).toBe(200);
    const redirect = new URL(result.body.redirect);
    expect(redirect.searchParams.has('error')).toBe(false);
    expect(bcrypt.compare).toHaveBeenCalledWith('test-password', 'stored-hash');
    const granted = consumeCode(redirect.searchParams.get('code'));
    expect(granted.scopes).toEqual(['equipment:read', 'equipment:write']);
  });

  it('refuse un mot de passe incorrect et un compte sans mot de passe', async () => {
    bcrypt.compare.mockResolvedValue(false);
    let result = await request(app).post('/oauth/authorize').type('form').send(consent);
    expect(new URL(result.body.redirect).searchParams.get('error')).toBe('access_denied');
    prisma.user.findUnique.mockResolvedValue({ id: 'u1', role: 'ADMIN', isActive: true, passwordHash: null });
    bcrypt.compare.mockClear();
    result = await request(app).post('/oauth/authorize').type('form').send(consent);
    expect(new URL(result.body.redirect).searchParams.get('error')).toBe('access_denied');
    expect(bcrypt.compare).not.toHaveBeenCalled();
  });

  it('annonce tous les droits du catalogue dans les métadonnées OAuth', async () => {
    const auth = await request(app).get('/.well-known/oauth-authorization-server');
    const resource = await request(app).get('/.well-known/oauth-protected-resource');
    expect(auth.body.scopes_supported.sort()).toEqual([...ALL_MCP_SCOPES, 'offline_access'].sort());
    expect(resource.body.scopes_supported.sort()).toEqual([...ALL_MCP_SCOPES].sort());
    for (const role of ['ADMIN', 'TECH']) {
      expect(getUserMcpScopes({ role })).toEqual(expect.arrayContaining(['equipment:read', 'equipment:write']));
    }
  });

  it('propose tous les droits dans les paramètres et explique tous les droits du consentement', () => {
    const consentHtml = fs.readFileSync(path.join(__dirname, '../public/oauth-authorize.html'), 'utf8');
    const permissions = require('../public/js/mcp-permissions');
    const settingsHtml = fs.readFileSync(path.join(__dirname, '../public/settings.html'), 'utf8');
    const options = new Set(permissions.categories.flatMap(category => [category.id + ':read', category.id + ':write']));
    for (const scope of ALL_MCP_SCOPES) {
      expect(permissions.groups([scope])[0]?.label).toBeTruthy();
      expect(options.has(scope) || options.has(MCP_SCOPE_ALIASES[scope])).toBe(true);
    }
    for (const html of [consentHtml, settingsHtml]) {
      expect(html).toContain('src="/js/mcp-permissions.js"');
      expect(html).toContain('McpPermissions.mount(');
      expect(html).toContain('McpPermissions.selected(');
      for (const script of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)) {
        new vm.Script(script[1]);
      }
    }
  });

  it('accorde uniquement la lecture quand la catégorie équipements est limitée à la lecture', async () => {
    const result = await request(app).post('/oauth/authorize').type('form').send({ ...consent, granted_scopes: ['equipment:read'] });
    const granted = consumeCode(new URL(result.body.redirect).searchParams.get('code'));
    expect(granted.scopes).toEqual(['equipment:read']);
  });

  it('ne peut pas accorder un droit hors de la demande OAuth', async () => {
    const result = await request(app).post('/oauth/authorize').type('form').send({
      ...consent, scope: 'equipment:read', granted_scopes: ['equipment:read', 'equipment:write']
    });
    const granted = consumeCode(new URL(result.body.redirect).searchParams.get('code'));
    expect(granted.scopes).toEqual(['equipment:read']);
  });
});
