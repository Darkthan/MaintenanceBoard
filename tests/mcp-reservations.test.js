jest.mock('../src/lib/prisma', () => ({
  mcpToken: { findUnique: jest.fn(), update: jest.fn() },
  user: { findUnique: jest.fn() },
  loanResource: { findUnique: jest.fn(), findMany: jest.fn() },
  loanReservation: { findUnique: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn() },
  signatureRequest: { findUnique: jest.fn() }
}));

const crypto = require('crypto');
const express = require('express');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const request = require('supertest');
const config = require('../src/config');
const prisma = require('../src/lib/prisma');
const {
  generateMcpToken,
  hashMcpToken,
  parseScopes,
  serializeScopes,
  isMcpTokenUsable,
  hasMcpTokenExpired
} = require('../src/utils/mcpTokens');
const { mcpAuth } = require('../src/middleware/mcpAuth');
const { generateCode, storeCode } = require('../src/lib/oauthCodes');
const service = require('../src/mcp/reservationsService');

function oauthTestApp() {
  const app = express();
  app.use(express.urlencoded({ extended: true }));
  app.use(express.json());
  app.use(cookieParser());
  app.use('/oauth', require('../src/routes/oauth').router);
  return app;
}

function pkceChallenge(verifier) {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

function mockRes() {
  return {
    statusCode: null,
    headers: {},
    body: null,
    set(k, v) { this.headers[k] = v; return this; },
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; }
  };
}

describe('mcpTokens util', () => {
  it('génère un secret préfixé mcp_ et un hash stable', () => {
    const { token, tokenHash, tokenPrefix } = generateMcpToken();
    expect(token.startsWith('mcp_')).toBe(true);
    expect(tokenPrefix.startsWith('mcp_')).toBe(true);
    expect(tokenHash).toBe(hashMcpToken(token));
    expect(tokenHash).toHaveLength(64); // sha256 hex
  });

  it('ne conserve que les scopes valides', () => {
    expect(parseScopes(serializeScopes(['reservations:read', 'bogus', 'reservations:write']))).toEqual(
      ['reservations:read', 'reservations:write']
    );
  });

  it('détecte l\'expiration et l\'inactivité', () => {
    const past = new Date(Date.now() - 1000);
    const future = new Date(Date.now() + 100000);
    expect(hasMcpTokenExpired({ expiresAt: past })).toBe(true);
    expect(hasMcpTokenExpired({ expiresAt: future })).toBe(false);
    expect(hasMcpTokenExpired({ expiresAt: null })).toBe(false);
    expect(isMcpTokenUsable({ isActive: true, expiresAt: future })).toBe(true);
    expect(isMcpTokenUsable({ isActive: false, expiresAt: future })).toBe(false);
    expect(isMcpTokenUsable({ isActive: true, expiresAt: past })).toBe(false);
  });
});

describe('mcpAuth middleware', () => {
  beforeEach(() => jest.clearAllMocks());

  it('refuse l\'absence de Bearer avec WWW-Authenticate', async () => {
    const req = { headers: {} };
    const res = mockRes();
    const next = jest.fn();
    await mcpAuth(req, res, next);
    expect(res.statusCode).toBe(401);
    expect(res.headers['WWW-Authenticate']).toMatch(/Bearer/);
    expect(next).not.toHaveBeenCalled();
  });

  it('refuse un token inconnu', async () => {
    prisma.mcpToken.findUnique.mockResolvedValue(null);
    const req = { headers: { authorization: 'Bearer mcp_inconnu' } };
    const res = mockRes();
    await mcpAuth(req, res, jest.fn());
    expect(res.statusCode).toBe(401);
  });

  it('refuse un token révoqué', async () => {
    prisma.mcpToken.findUnique.mockResolvedValue({
      id: 't1', isActive: false, expiresAt: null, scopes: '[]',
      createdBy: { id: 'u1', isActive: true, role: 'ADMIN' }
    });
    const req = { headers: { authorization: 'Bearer mcp_x' } };
    const res = mockRes();
    await mcpAuth(req, res, jest.fn());
    expect(res.statusCode).toBe(401);
  });

  it('refuse si le compte propriétaire est désactivé', async () => {
    prisma.mcpToken.findUnique.mockResolvedValue({
      id: 't1', isActive: true, expiresAt: null, scopes: serializeScopes(['reservations:read']),
      createdBy: { id: 'u1', isActive: false, role: 'ADMIN' }
    });
    const req = { headers: { authorization: 'Bearer mcp_x' } };
    const res = mockRes();
    await mcpAuth(req, res, jest.fn());
    expect(res.statusCode).toBe(401);
  });

  it('accepte un token valide et attache req.mcpToken', async () => {
    prisma.mcpToken.findUnique.mockResolvedValue({
      id: 't1', label: 'CI', isActive: true, expiresAt: null,
      scopes: serializeScopes(['reservations:read', 'reservations:write']),
      createdBy: { id: 'u1', isActive: true, role: 'ADMIN', name: 'Admin', email: 'a@b.co' }
    });
    prisma.mcpToken.update.mockResolvedValue({});
    const req = { headers: { authorization: 'Bearer mcp_valide' } };
    const res = mockRes();
    const next = jest.fn();
    await mcpAuth(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(req.mcpToken.scopes).toEqual(['reservations:read', 'reservations:write']);
    expect(req.mcpToken.createdBy.id).toBe('u1');
  });
});

describe('OAuth MCP refresh tokens', () => {
  beforeEach(() => jest.clearAllMocks());

  it('émet puis renouvelle un access token MCP avec offline_access', async () => {
    const verifier = 'test-verifier-1234567890';
    const code = generateCode();
    storeCode(code, {
      userId: 'u1',
      mcpTokenId: 't1',
      scopes: ['reservations:read'],
      redirectUri: 'https://chatgpt.com/connector_platform_oauth_redirect',
      codeChallenge: pkceChallenge(verifier),
      codeChallengeMethod: 'S256',
      issueRefreshToken: true
    });

    prisma.mcpToken.findUnique.mockResolvedValue({
      id: 't1',
      isActive: true,
      expiresAt: null,
      scopes: serializeScopes(['reservations:read', 'reservations:write'])
    });
    prisma.user.findUnique.mockResolvedValue({ id: 'u1', isActive: true });
    prisma.mcpToken.update.mockResolvedValue({});

    const app = oauthTestApp();
    const tokenRes = await request(app)
      .post('/oauth/token')
      .type('form')
      .send({
        grant_type: 'authorization_code',
        code,
        redirect_uri: 'https://chatgpt.com/connector_platform_oauth_redirect',
        code_verifier: verifier
      });

    expect(tokenRes.status).toBe(200);
    expect(tokenRes.body.access_token).toBeTruthy();
    expect(tokenRes.body.refresh_token).toBeTruthy();
    expect(tokenRes.body.scope).toBe('reservations:read');

    const refreshRes = await request(app)
      .post('/oauth/token')
      .type('form')
      .send({
        grant_type: 'refresh_token',
        refresh_token: tokenRes.body.refresh_token
      });

    expect(refreshRes.status).toBe(200);
    expect(refreshRes.body.access_token).toBeTruthy();
    expect(refreshRes.body.refresh_token).toBeTruthy();
    expect(refreshRes.body.scope).toBe('reservations:read');
  });

  it('autorise le mode session avec un Origin opaque si le CSRF OAuth est valide', async () => {
    prisma.mcpToken.findUnique
      .mockResolvedValueOnce({
        id: 't1',
        label: 'ChatGPT',
        isActive: true,
        expiresAt: null,
        scopes: serializeScopes(['reservations:read']),
        redirectUris: JSON.stringify(['https://chatgpt.com/connector_platform_oauth_redirect'])
      })
      .mockResolvedValueOnce({
        id: 't1',
        isActive: true,
        expiresAt: null,
        scopes: serializeScopes(['reservations:read']),
        redirectUris: JSON.stringify(['https://chatgpt.com/connector_platform_oauth_redirect'])
      });
    prisma.user.findUnique.mockResolvedValue({ id: 'u1', isActive: true });

    const app = oauthTestApp();
    const authorizeQuery = {
      response_type: 'code',
      client_id: 't1',
      redirect_uri: 'https://chatgpt.com/connector_platform_oauth_redirect',
      scope: 'reservations:read offline_access',
      state: 'state-1',
      code_challenge: 'challenge-1',
      code_challenge_method: 'S256'
    };

    const getRes = await request(app)
      .get('/oauth/authorize')
      .query(authorizeQuery);
    expect(getRes.status).toBe(200);

    const csrfCookie = getRes.headers['set-cookie'].find(c => c.startsWith('oauthCsrf='));
    const csrf = decodeURIComponent(csrfCookie.split(';')[0].slice('oauthCsrf='.length));
    const accessToken = jwt.sign({ userId: 'u1' }, config.jwt.secret, { expiresIn: '15m' });

    const postRes = await request(app)
      .post('/oauth/authorize')
      .set('Origin', 'null')
      .set('Cookie', [`oauthCsrf=${encodeURIComponent(csrf)}`, `accessToken=${accessToken}`])
      .type('form')
      .send({
        ...authorizeQuery,
        action: 'approve',
        use_session: 'true',
        oauth_csrf: csrf
      });

    expect(postRes.status).toBe(302);
    expect(postRes.headers.location).toMatch(/^https:\/\/chatgpt\.com\/connector_platform_oauth_redirect\?code=/);
    expect(postRes.headers.location).toContain('state=state-1');
  });
});

describe('reservationsService', () => {
  beforeEach(() => jest.clearAllMocks());

  it('crée une réservation après vérification de disponibilité', async () => {
    prisma.loanResource.findUnique.mockResolvedValue({
      id: 'res-1', name: 'Valise iPad', isActive: true, totalUnits: 10, bundleSize: 10, usesBundles: true, equipments: []
    });
    prisma.loanReservation.findMany.mockResolvedValue([]);
    prisma.loanReservation.create.mockImplementation(async ({ data }) => ({
      id: 'r-1', ...data, resource: { id: 'res-1', name: 'Valise iPad' }, selectedEquipments: []
    }));

    const out = await service.createReservation({
      resourceId: 'res-1',
      requesterName: 'Jean Dupont',
      requesterEmail: 'JEAN@example.com',
      startAt: '2030-03-25T08:00:00.000Z',
      endAt: '2030-03-25T12:00:00.000Z',
      requestedUnits: 3
    }, { userId: 'u1' });

    expect(prisma.loanReservation.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        resourceId: 'res-1',
        requesterEmail: 'jean@example.com',
        requestedUnits: 3,
        reservedSlots: 1,
        status: 'PENDING',
        createdById: 'u1'
      })
    }));
    expect(out.status).toBe('PENDING');
  });

  it('refuse une création quand la période est complète', async () => {
    prisma.loanResource.findUnique.mockResolvedValue({
      id: 'res-1', name: 'Valise iPad', isActive: true, totalUnits: 10, bundleSize: 10, usesBundles: true, equipments: []
    });
    prisma.loanReservation.findMany.mockResolvedValue([
      { id: 'existing', reservedSlots: 1, status: 'APPROVED', startAt: new Date('2030-03-25T08:00:00Z'), endAt: new Date('2030-03-25T12:00:00Z') }
    ]);

    await expect(service.createReservation({
      resourceId: 'res-1', requesterName: 'Marie', requesterEmail: 'm@e.co',
      startAt: '2030-03-25T09:00:00Z', endAt: '2030-03-25T11:00:00Z', requestedUnits: 1
    }, { userId: 'u1' })).rejects.toMatchObject({ status: 409 });

    expect(prisma.loanReservation.create).not.toHaveBeenCalled();
  });

  it('rejette des dates invalides', async () => {
    await expect(service.createReservation({
      resourceId: 'res-1', requesterName: 'X', requesterEmail: 'x@e.co',
      startAt: '2030-03-25T12:00:00Z', endAt: '2030-03-25T08:00:00Z', requestedUnits: 1
    }, {})).rejects.toMatchObject({ status: 400 });
  });

  it('refuse la modification si une fiche de prêt est signée', async () => {
    prisma.loanReservation.findUnique.mockResolvedValue({
      id: 'r-2', resourceId: 'res-1', contractSignatureRequestId: 'sig-1',
      startAt: new Date('2030-03-25T08:00:00Z'), endAt: new Date('2030-03-25T12:00:00Z'),
      requestedUnits: 1, status: 'APPROVED', selectedEquipments: []
    });
    prisma.signatureRequest.findUnique.mockResolvedValue({ status: 'SIGNED' });

    await expect(service.updateReservation('r-2', { internalNotes: 'maj' }, { userId: 'u1' }))
      .rejects.toMatchObject({ status: 409 });
    expect(prisma.loanReservation.update).not.toHaveBeenCalled();
  });

  it('re-vérifie la disponibilité quand la période change', async () => {
    prisma.loanReservation.findUnique.mockResolvedValue({
      id: 'r-3', resourceId: 'res-1', contractSignatureRequestId: null,
      startAt: new Date('2030-04-01T08:00:00Z'), endAt: new Date('2030-04-01T10:00:00Z'),
      requestedUnits: 1, reservedSlots: 1, status: 'PENDING', approvedById: null, selectedEquipments: []
    });
    prisma.loanResource.findUnique.mockResolvedValue({
      id: 'res-1', name: 'Valise', isActive: true, totalUnits: 10, bundleSize: 5, usesBundles: true, equipments: []
    });
    prisma.loanReservation.findMany.mockResolvedValue([]);
    prisma.loanReservation.update.mockImplementation(async ({ data }) => ({
      id: 'r-3', resourceId: 'res-1', ...data, resource: { id: 'res-1', name: 'Valise' }, selectedEquipments: []
    }));

    await service.updateReservation('r-3', { startAt: '2030-04-02T09:00:00Z', endAt: '2030-04-02T11:00:00Z', requestedUnits: 6 }, { userId: 'u1' });

    expect(prisma.loanReservation.findMany).toHaveBeenCalled(); // preuve du recheck de dispo
    expect(prisma.loanReservation.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'r-3' },
      data: expect.objectContaining({ requestedUnits: 6, reservedSlots: 2 })
    }));
  });
});
