const express = require('express');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const prisma = require('../lib/prisma');
const config = require('../config');
const { readSettings, writeSettings } = require('../utils/settings');
const { createSmtpTransporter } = require('../utils/mail');
const { normalizeEmail, isAllowed, tokenIsCurrent, markVerified } = require('../utils/publicMcp');
const { generateCode, storeCode, consumeCode } = require('../lib/oauthCodes');

const router = express.Router();
const scopes = 'public_requests:write offline_access';
const pending = new Map();
const base = () => config.appUrl.replace(/\/$/, '');
const html = value => String(value || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const error = (res, message) => res.status(400).type('html').send(`<h1>Connexion impossible</h1><p>${html(message)}</p>`);
const limiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false });

function clients() { return readSettings().publicMcpClients || {}; }
function validRedirect(uri) {
  try { const url = new URL(uri); return url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)); }
  catch { return false; }
}
function clientFor(id, redirect) { const client = clients()[id]; return client && client.redirectUris.includes(redirect) ? client : null; }
function sha256(value) { return crypto.createHash('sha256').update(value).digest('base64url'); }
function tokens(email, clientId) {
  const issuedAt = Date.now();
  return {
    access_token: jwt.sign({ type: 'public_mcp_access', email, clientId, issuedAt }, config.jwt.secret, { expiresIn: '1h' }),
    refresh_token: jwt.sign({ type: 'public_mcp_refresh', email, clientId, issuedAt }, config.jwt.secret, { expiresIn: '30d' }),
    token_type: 'Bearer', expires_in: 3600, scope: scopes
  };
}

router.post('/register', limiter, (req, res) => {
  const uris = Array.isArray(req.body.redirect_uris) ? [...new Set(req.body.redirect_uris.map(String))] : [];
  if (!uris.length || uris.length > 10 || !uris.every(validRedirect)) return res.status(400).json({ error: 'invalid_redirect_uri' });
  const client = { id: `mcp_public_${crypto.randomBytes(16).toString('base64url')}`, redirectUris: uris, name: String(req.body.client_name || 'Assistant IA').slice(0, 100) };
  writeSettings({ publicMcpClients: { ...clients(), [client.id]: client } });
  res.status(201).json({ client_id: client.id, client_name: client.name, redirect_uris: uris, grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none' });
});

router.get('/authorize', (req, res) => {
  const { client_id, redirect_uri, response_type, code_challenge, code_challenge_method, state } = req.query;
  if (!clientFor(client_id, redirect_uri)) return error(res, 'Client ou adresse de retour invalide.');
  if (response_type !== 'code' || code_challenge_method !== 'S256' || !/^[A-Za-z0-9_-]{43,128}$/.test(String(code_challenge || ''))) return error(res, 'PKCE S256 est requis.');
  const flow = crypto.randomBytes(24).toString('base64url');
  pending.set(flow, { clientId: client_id, redirectUri: redirect_uri, challenge: code_challenge, state: String(state || ''), expiresAt: Date.now() + 15 * 60 * 1000 });
  res.type('html').send(`<!doctype html><html lang="fr"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Connexion MCP publique</title><body style="font:16px system-ui;max-width:480px;margin:10vh auto;padding:20px"><h1>Connexion à MaintenanceBoard</h1><p>Pour autoriser une demande de tablettes ou d’intervention depuis votre assistant IA, recevez un magic link par email. L’administrateur doit avoir autorisé cette adresse.</p><form method="post" action="/oauth-public/request-link"><input type="hidden" name="flow" value="${flow}"><label>Adresse email <input type="email" name="email" required autocomplete="email" style="display:block;width:100%;padding:10px;margin:8px 0 18px"></label><button style="padding:10px 18px">Envoyer le lien</button></form></body></html>`);
});

router.post('/request-link', limiter, async (req, res, next) => {
  try {
    const flow = pending.get(String(req.body.flow || ''));
    if (!flow || flow.expiresAt < Date.now()) return error(res, 'Connexion expirée. Recommencez depuis votre assistant IA.');
    const email = normalizeEmail(req.body.email);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return error(res, 'Adresse email invalide.');
    const { transporter, from } = createSmtpTransporter();
    if (!transporter) return res.status(503).send('Configuration email indisponible.');
    // Réponse identique pour ne pas révéler la liste blanche.
    if (isAllowed(email)) {
      const proof = jwt.sign({ type: 'public_mcp_magic', flow: req.body.flow, email, nonce: crypto.randomBytes(12).toString('hex') }, config.jwt.secret, { expiresIn: '15m' });
      const url = `${base()}/oauth-public/verify?proof=${encodeURIComponent(proof)}`;
      await transporter.sendMail({ from, to: email, subject: 'Connexion de votre assistant IA à MaintenanceBoard', text: `Ouvrez ce lien pour confirmer votre adresse email et connecter votre assistant :\n\n${url}\n\nCe lien expire dans 15 minutes.`, html: `<p>Confirmez votre adresse email pour connecter votre assistant à MaintenanceBoard :</p><p><a href="${html(url)}">Autoriser la connexion</a></p><p>Ce lien expire dans 15 minutes.</p>` });
    }
    res.type('html').send('<h1>Vérifiez votre boîte mail</h1><p>Si cette adresse est autorisée, un lien de connexion vous a été envoyé.</p>');
  } catch (err) { next(err); }
});

router.get('/verify', (req, res) => {
  let proof;
  try { proof = jwt.verify(String(req.query.proof || ''), config.jwt.secret); }
  catch { return error(res, 'Lien de connexion invalide ou expiré.'); }
  if (proof.type !== 'public_mcp_magic') return error(res, 'Lien de connexion invalide.');
  const flow = pending.get(proof.flow);
  if (!flow || flow.expiresAt < Date.now() || !isAllowed(proof.email)) return error(res, 'Connexion expirée ou non autorisée.');
  markVerified(proof.email);
  pending.delete(proof.flow);
  const code = generateCode();
  storeCode(code, { publicMcp: true, email: proof.email, clientId: flow.clientId, redirectUri: flow.redirectUri, codeChallenge: flow.challenge });
  const redirect = new URL(flow.redirectUri);
  redirect.searchParams.set('code', code);
  if (flow.state) redirect.searchParams.set('state', flow.state);
  res.redirect(redirect.toString());
});

router.post('/token', limiter, (req, res) => {
  const grant = req.body.grant_type;
  if (grant === 'authorization_code') {
    const data = consumeCode(String(req.body.code || ''));
    if (!data?.publicMcp || data.clientId !== req.body.client_id || data.redirectUri !== req.body.redirect_uri || sha256(String(req.body.code_verifier || '')) !== data.codeChallenge || !isAllowed(data.email)) return res.status(400).json({ error: 'invalid_grant' });
    return res.json(tokens(data.email, data.clientId));
  }
  if (grant === 'refresh_token') {
    try {
      const data = jwt.verify(String(req.body.refresh_token || ''), config.jwt.secret);
      if (data.type !== 'public_mcp_refresh' || data.clientId !== req.body.client_id || !clients()[data.clientId] || !tokenIsCurrent(data.email, data.issuedAt)) throw new Error();
      return res.json(tokens(data.email, data.clientId));
    } catch { return res.status(400).json({ error: 'invalid_grant' }); }
  }
  res.status(400).json({ error: 'unsupported_grant_type' });
});

module.exports = router;
