jest.mock('../src/utils/settings', () => {
  let current = {};
  return {
    readSettings: () => current,
    writeSettings: patch => { current = { ...current, ...patch }; return current; },
    reset: () => { current = {}; }
  };
});
jest.mock('../src/lib/prisma', () => ({}));
const mockSendMail = jest.fn().mockResolvedValue(true);
jest.mock('../src/utils/mail', () => ({ createSmtpTransporter: () => ({ transporter: { sendMail: mockSendMail }, from: 'test@example.org' }) }));

const express = require('express');
const request = require('supertest');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const settings = require('../src/utils/settings');
const publicMcp = require('../src/utils/publicMcp');
const config = require('../src/config');
const router = require('../src/routes/publicMcp');
const prisma = require('../src/lib/prisma');
const { buildPublicMcpServer } = require('../src/mcp/publicServer');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/oauth-public', router);

describe('MCP public OAuth', () => {
  beforeEach(() => { settings.reset(); mockSendMail.mockClear(); });

  it('ne confond pas une adresse connue avec une adresse autorisée', () => {
    publicMcp.markVerified('Personne@Exemple.fr');
    expect(publicMcp.verifiedEmails()).toEqual(['personne@exemple.fr']);
    expect(publicMcp.isAllowed('personne@exemple.fr')).toBe(false);
    publicMcp.setAllowed('personne@exemple.fr', true);
    expect(publicMcp.isAllowed('PERSONNE@EXEMPLE.FR')).toBe(true);
  });

  it('révoque les jetons précédents même après réautorisation', async () => {
    publicMcp.setAllowed('personne@exemple.fr', true);
    const issuedAt = Date.now() - 1000;
    publicMcp.setAllowed('personne@exemple.fr', false);
    publicMcp.setAllowed('personne@exemple.fr', true);
    expect(publicMcp.tokenIsCurrent('personne@exemple.fr', issuedAt)).toBe(false);
  });

  it('exige PKCE et un client enregistré avant d’envoyer un magic link', async () => {
    const redirect = 'https://assistant.example/callback';
    const registration = await request(app).post('/oauth-public/register').send({ redirect_uris: [redirect], client_name: 'Assistant' });
    expect(registration.status).toBe(201);
    const verifier = crypto.randomBytes(32).toString('base64url');
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    const response = await request(app).get('/oauth-public/authorize').query({ response_type: 'code', client_id: registration.body.client_id, redirect_uri: redirect, code_challenge: challenge, code_challenge_method: 'S256' });
    expect(response.status).toBe(200);
    expect(response.text).toContain('magic link');
    const invalid = await request(app).get('/oauth-public/authorize').query({ response_type: 'code', client_id: registration.body.client_id, redirect_uri: 'https://evil.example/callback', code_challenge: challenge, code_challenge_method: 'S256' });
    expect(invalid.status).toBe(400);
  });

  it('refuse de renouveler un accès après révocation', async () => {
    publicMcp.setAllowed('personne@exemple.fr', true);
    const clientId = 'mcp_public_test';
    settings.writeSettings({ publicMcpClients: { [clientId]: { id: clientId, redirectUris: ['https://assistant.example/callback'] } } });
    const refresh = jwt.sign({ type: 'public_mcp_refresh', email: 'personne@exemple.fr', clientId, issuedAt: Date.now() }, config.jwt.secret, { expiresIn: '1h' });
    publicMcp.setAllowed('personne@exemple.fr', false);
    const result = await request(app).post('/oauth-public/token').send({ grant_type: 'refresh_token', refresh_token: refresh, client_id: clientId });
    expect(result.status).toBe(400);
    expect(result.body.error).toBe('invalid_grant');
  });

  it('échange un magic link vérifié contre un accès OAuth lié à PKCE', async () => {
    publicMcp.setAllowed('personne@exemple.fr', true);
    const redirectUri = 'https://assistant.example/callback';
    const registration = await request(app).post('/oauth-public/register').send({ redirect_uris: [redirectUri] });
    const clientId = registration.body.client_id;
    const verifier = crypto.randomBytes(32).toString('base64url');
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    const authorize = await request(app).get('/oauth-public/authorize').query({ response_type: 'code', client_id: clientId, redirect_uri: redirectUri, code_challenge: challenge, code_challenge_method: 'S256', state: 'test-state' });
    const flow = authorize.text.match(/name="flow" value="([^"]+)"/)[1];
    const email = await request(app).post('/oauth-public/request-link').type('form').send({ flow, email: 'Personne@Exemple.fr' });
    expect(email.status).toBe(200);
    expect(mockSendMail).toHaveBeenCalledTimes(1);
    const proofUrl = mockSendMail.mock.calls[0][0].text.match(/https?:\/\/\S+\/oauth-public\/verify\?proof=\S+/)[0];
    const verified = await request(app).get(new URL(proofUrl).pathname + new URL(proofUrl).search);
    expect(verified.status).toBe(302);
    const callback = new URL(verified.headers.location);
    expect(callback.searchParams.get('state')).toBe('test-state');
    const code = callback.searchParams.get('code');
    const exchanged = await request(app).post('/oauth-public/token').send({ grant_type: 'authorization_code', code, client_id: clientId, redirect_uri: redirectUri, code_verifier: verifier });
    expect(exchanged.status).toBe(200);
    expect(jwt.verify(exchanged.body.access_token, config.jwt.secret).email).toBe('personne@exemple.fr');
    expect(publicMcp.verifiedEmails()).toContain('personne@exemple.fr');
    const repeated = await request(app).get(new URL(proofUrl).pathname + new URL(proofUrl).search);
    expect(repeated.status).toBe(400);
  });

  it('expose seulement les demandes publiques et impose l’email du magic link', async () => {
    prisma.intervention = { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn(async ({ data }) => ({ id: 'intervention-1', status: data.status })) };
    const server = buildPublicMcpServer({ email: 'personne@exemple.fr' });
    expect(Object.keys(server._registeredTools).sort()).toEqual(['list_tablet_resources', 'request_intervention', 'request_tablet_booking']);
    const result = await server._registeredTools.request_intervention.handler({ title: 'Écran cassé', reporterName: 'Personne', description: 'Écran noir' });
    expect(result.isError).not.toBe(true);
    expect(prisma.intervention.create.mock.calls[0][0].data.reporterEmail).toBe('personne@exemple.fr');
    await server.close();
  });
});
