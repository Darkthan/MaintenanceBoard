const express = require('express');
const { body, validationResult } = require('express-validator');
const prisma = require('../lib/prisma');
const { requireAuth } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/roles');
const {
  ALL_MCP_SCOPES,
  generateMcpToken,
  serializeScopes,
  parseScopes
} = require('../utils/mcpTokens');
const { isValidRedirectUriFormat, parseRedirectUris } = require('./oauth');

const router = express.Router();
const DEFAULT_MCP_TOKEN_TTL_MS = 365 * 24 * 60 * 60 * 1000;

router.use(requireAuth, requireAdmin);

function validate(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({ errors: errors.array() });
    return false;
  }
  return true;
}

function serializeRedirectUris(raw) {
  const list = Array.isArray(raw) ? raw : [];
  return JSON.stringify(
    [...new Set(list.map(u => String(u || '').trim()).filter(isValidRedirectUriFormat))]
  );
}

// Représentation publique : jamais le hash, jamais le secret.
function presentToken(token) {
  return {
    id: token.id,
    label: token.label,
    tokenPrefix: token.tokenPrefix,
    scopes: parseScopes(token.scopes),
    redirectUris: parseRedirectUris(token.redirectUris),
    isActive: token.isActive,
    expiresAt: token.expiresAt,
    lastUsedAt: token.lastUsedAt,
    createdAt: token.createdAt,
    createdBy: token.createdBy || null
  };
}

// ── GET /api/mcp-tokens ─────────────────────────────────────────────────────
router.get('/', async (_req, res, next) => {
  try {
    const tokens = await prisma.mcpToken.findMany({
      orderBy: { createdAt: 'desc' },
      include: { createdBy: { select: { name: true, email: true } } }
    });
    res.json(tokens.map(presentToken));
  } catch (err) { next(err); }
});

// ── POST /api/mcp-tokens ────────────────────────────────────────────────────
router.post('/',
  [
    body('label').trim().isLength({ min: 2, max: 200 }),
    body('scopes').isArray({ min: 1 }),
    body('scopes.*').isIn(ALL_MCP_SCOPES),
    body('expiresAt').optional({ values: 'falsy' }).isISO8601(),
    body('redirectUris').optional().isArray()
  ],
  async (req, res, next) => {
    try {
      if (!validate(req, res)) return;

      const scopes = serializeScopes(req.body.scopes);
      if (parseScopes(scopes).length === 0) {
        return res.status(400).json({ error: 'Au moins un scope valide est requis.' });
      }

      const { token, tokenHash, tokenPrefix } = generateMcpToken();

      const created = await prisma.mcpToken.create({
        data: {
          label: req.body.label.trim(),
          tokenPrefix,
          tokenHash,
          scopes,
          redirectUris: serializeRedirectUris(req.body.redirectUris || []),
          expiresAt: req.body.expiresAt ? new Date(req.body.expiresAt) : new Date(Date.now() + DEFAULT_MCP_TOKEN_TTL_MS),
          createdById: req.user.id
        },
        include: { createdBy: { select: { name: true, email: true } } }
      });

      res.status(201).json({
        ...presentToken(created),
        token,
        warning: 'Conservez ce token : il ne sera plus jamais affiché.'
      });
    } catch (err) { next(err); }
  }
);

// ── PATCH /api/mcp-tokens/:id ───────────────────────────────────────────────
router.patch('/:id',
  [
    body('label').optional().trim().isLength({ min: 2, max: 200 }),
    body('scopes').optional().isArray({ min: 1 }),
    body('scopes.*').optional().isIn(ALL_MCP_SCOPES),
    body('isActive').optional().isBoolean(),
    body('expiresAt').optional({ nullable: true }).custom(v => v === null || !Number.isNaN(Date.parse(v))),
    body('redirectUris').optional().isArray()
  ],
  async (req, res, next) => {
    try {
      if (!validate(req, res)) return;

      const data = {};
      if (req.body.label !== undefined) data.label = req.body.label.trim();
      if (req.body.scopes !== undefined) data.scopes = serializeScopes(req.body.scopes);
      if (req.body.isActive !== undefined) data.isActive = !!req.body.isActive;
      if (req.body.expiresAt !== undefined) data.expiresAt = req.body.expiresAt ? new Date(req.body.expiresAt) : null;
      if (req.body.redirectUris !== undefined) data.redirectUris = serializeRedirectUris(req.body.redirectUris);

      if (data.isActive === false) {
        await prisma.mcpRefreshToken.deleteMany({ where: { mcpTokenId: req.params.id } });
      }

      const updated = await prisma.mcpToken.update({
        where: { id: req.params.id },
        data,
        include: { createdBy: { select: { name: true, email: true } } }
      });
      res.json(presentToken(updated));
    } catch (err) {
      if (err.code === 'P2025') return res.status(404).json({ error: 'Token introuvable' });
      next(err);
    }
  }
);

// ── DELETE /api/mcp-tokens/:id ──────────────────────────────────────────────
// Sans ?permanent : révocation (isActive=false, conservé pour audit) + révocation des refresh tokens actifs.
// Avec ?permanent=true : suppression définitive (cascade supprime les refresh tokens).
router.delete('/:id', async (req, res, next) => {
  try {
    if (req.query.permanent === 'true') {
      await prisma.mcpToken.delete({ where: { id: req.params.id } });
      res.json({ message: 'Token MCP supprimé définitivement' });
    } else {
      await prisma.$transaction([
        prisma.mcpRefreshToken.deleteMany({ where: { mcpTokenId: req.params.id } }),
        prisma.mcpToken.update({ where: { id: req.params.id }, data: { isActive: false } })
      ]);
      res.json({ message: 'Token MCP révoqué' });
    }
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Token introuvable' });
    next(err);
  }
});

module.exports = router;
