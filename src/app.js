const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const session = require('express-session');
const path = require('path');
const fs = require('fs');
const rateLimit = require('express-rate-limit');
const config = require('./config');
const { swaggerUi, swaggerDocument } = require('./utils/swagger');

// Identifiant de build — généré à chaque docker build via RUN date +%s > /app/.build_id
const _buildId = (() => {
  const file = path.join(__dirname, '../.build_id');
  try { return fs.readFileSync(file, 'utf8').trim(); } catch { return 'dev'; }
})();

const app = express();

if (config.trustProxy !== false) {
  app.set('trust proxy', config.trustProxy);
}

// ── Sécurité ──────────────────────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "cdn.jsdelivr.net", "unpkg.com", "cdn.tailwindcss.com"],
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", "cdn.jsdelivr.net", "cdn.tailwindcss.com"],
      imgSrc: ["'self'", "data:", "blob:"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'", "cdn.jsdelivr.net"],
      frameSrc: ["'self'"]
    }
  }
}));

app.use(cors({
  origin: config.appUrl,
  credentials: true
}));

// CORS permissif pour /mcp : les clients LLM (ChatGPT, Claude) appellent depuis leurs
// serveurs backend (pas depuis le navigateur) mais certains proxies ajoutent Origin.
// exposedHeaders est nécessaire pour que le client puisse lire Mcp-Session-Id.
app.use('/mcp', cors({
  origin: '*',
  methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Mcp-Session-Id'],
  exposedHeaders: ['Mcp-Session-Id'],
  credentials: false
}));
app.use('/mcp-public', cors({
  origin: '*',
  methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Mcp-Session-Id'],
  exposedHeaders: ['Mcp-Session-Id'],
  credentials: false
}));

// ── Rate limiting ──────────────────────────────────────────────────────────────
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500,
  message: { error: 'Trop de requêtes, réessayez dans 15 minutes.' }
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'Trop de tentatives de connexion, réessayez dans 15 minutes.' }
});

app.use('/api/', apiLimiter);
app.use('/api/auth/login', authLimiter);

// ── Parsing ───────────────────────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());

// ── Sessions (pour WebAuthn challenges) ───────────────────────────────────────
// SQLite dev → MemoryStore (challenges sont très éphémères, suffisant en dev)
// PostgreSQL prod → connect-pg-simple persisté
const isSQLite = config.database.url?.startsWith('file:');

let sessionStore;
if (!isSQLite) {
  const PgSession = require('connect-pg-simple')(session);
  sessionStore = new PgSession({
    conString: config.database.url,
    tableName: 'sessions',
    createTableIfMissing: true
  });
}
// isSQLite → pas de store = MemoryStore par défaut (express-session)

app.use(session({
  ...(sessionStore ? { store: sessionStore } : {}),
  secret: config.session.secret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: config.env === 'production',
    httpOnly: true,
    maxAge: config.session.maxAge,
    sameSite: 'strict'
  },
  name: 'mb.sid'
}));

// ── Fichiers statiques ────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, '../public'), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.js') || filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache');
    }
  }
}));

// ── Documentation API ─────────────────────────────────────────────────────────
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument, {
  customCss: '.swagger-ui .topbar { display: none }',
  customSiteTitle: 'MaintenanceBoard API'
}));

// ── Routes API ────────────────────────────────────────────────────────────────
app.use('/api/auth', require('./routes/auth'));
app.use('/api/search', require('./routes/search'));
app.use('/api/display', require('./routes/display'));
app.use('/api/calendar', require('./routes/calendar'));
app.use('/api/rooms', require('./routes/rooms'));
app.use('/api/equipment', require('./routes/equipment'));
app.use('/api/interventions', require('./routes/interventions'));
app.use('/api/todos', require('./routes/todos'));
app.use('/api/projects', require('./routes/projects'));
app.use('/api/messages', require('./routes/messages'));
app.use('/api/knowledge-base', require('./routes/knowledgeBase'));
app.use('/api/supervision', require('./routes/supervision'));
app.use('/api/ip-networks', require('./routes/ipAddressing').router);
app.use('/api/orders', require('./routes/orders'));
app.use('/api/qrcode', require('./routes/qrcode'));
app.use('/api/users', require('./routes/users'));
// Rate limit strict sur les endpoints agent (checkin/sessions appelés par machines)
const agentCheckinLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  message: { error: 'Trop de requêtes agent, réessayez dans 15 minutes.' }
});
app.use('/api/agents/checkin', agentCheckinLimiter);
app.use('/api/agents/sessions', agentCheckinLimiter);
app.use('/api/agents', require('./routes/agents'));
app.use('/api/settings', require('./routes/settings'));
app.use('/api/suppliers', require('./routes/suppliers'));
app.use('/api/stock', require('./routes/stock'));
const { loansRouter, loanPublicRouter } = require('./routes/loans');
app.use('/api/loans', loansRouter);
app.use('/api/loan-request', loanPublicRouter);
app.use('/api/nuget', require('./routes/nuget'));
app.use('/api/mcp-tokens', require('./routes/mcpTokens'));

// ── OAuth2 (discovery + token + authorize) ────────────────────────────────────
app.use('/.well-known', require('./routes/wellKnown'));
app.use('/oauth', require('./routes/oauth').router);
app.use('/oauth-public', require('./routes/publicMcp'));

const jwt = require('jsonwebtoken');
const { tokenIsCurrent: isPublicMcpTokenCurrent } = require('./utils/publicMcp');
const { handlePublicMcp } = require('./mcp/publicServer');
function publicMcpAuth(req, res, next) {
  const value = String(req.headers.authorization || '');
  if (!value.startsWith('Bearer ')) {
    res.set('WWW-Authenticate', `Bearer resource_metadata="${config.appUrl.replace(/\/$/, '')}/.well-known/oauth-protected-resource/mcp-public"`);
    return res.status(401).json({ error: 'Authentification requise' });
  }
  try {
    const identity = jwt.verify(value.slice(7), config.jwt.secret);
    if (identity.type !== 'public_mcp_access' || !isPublicMcpTokenCurrent(identity.email, identity.issuedAt)) throw new Error('unauthorized');
    req.publicMcpIdentity = { email: identity.email };
    return next();
  } catch { return res.status(401).json({ error: 'Connexion expirée ou adresse non autorisée' }); }
}

// ── Serveur MCP (Model Context Protocol) ───────────────────────────────────────
// Transport Streamable HTTP, authentifié par token MCP dédié (Bearer).
const { mcpAuth } = require('./middleware/mcpAuth');
const { handleMcpRequest } = require('./mcp/server');
const mcpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 240,
  message: { jsonrpc: '2.0', error: { code: -32000, message: 'Trop de requêtes MCP, réessayez dans 15 minutes.' }, id: null }
});
app.post('/mcp-public', mcpLimiter, publicMcpAuth, handlePublicMcp);
app.get('/mcp-public', publicMcpAuth, handlePublicMcp);
app.delete('/mcp-public', publicMcpAuth, handlePublicMcp);
app.post('/mcp', mcpLimiter, mcpAuth, handleMcpRequest);
app.get('/mcp', mcpAuth, handleMcpRequest);    // canal SSE (notifications serveur → client)
app.delete('/mcp', mcpAuth, handleMcpRequest); // fermeture de session

// ── Tickets publics (sans auth, rate limit IP strict) ─────────────────────────
const { createTicketRateLimiter } = require('./middleware/ticketRateLimit');
// Magic link : limité par IP (10/h) ET par email (5/h) pour bloquer l'énumération
const magicLinkLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: { error: 'Trop de tentatives, réessayez dans une heure.' }
});
if (process.env.NODE_ENV !== 'test') {
  app.use('/api/tickets/magic-link', magicLinkLimiter);
  app.use('/api/tickets', createTicketRateLimiter());
}
app.use('/api/tickets', require('./routes/tickets'));

app.use('/downloads', require('./routes/downloads'));

const { ordersRouter: sigOrdersRouter, signRouter, signaturesRouter } = require('./routes/signatures');
app.use('/api/orders', sigOrdersRouter);      // /:id/signature-requests
app.use('/api/sign', signRouter);             // /:token, /:token/source, /:token/send-otp, /:token/submit
app.use('/api/signatures', signaturesRouter); // standalone signature requests

// ── Healthcheck ───────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ── Version build (cache invalidation côté client) ────────────────────────────
app.get('/api/version', (req, res) => {
  res.json({ version: _buildId });
});

// ── Routes sans extension ─────────────────────────────────────────────────────
app.get('/scan',   (req, res) => res.sendFile(path.join(__dirname, '../public/scan.html')));
app.get('/report', (req, res) => res.sendFile(path.join(__dirname, '../public/report.html')));
app.get('/loan-request', (req, res) => res.sendFile(path.join(__dirname, '../public/loan-request.html')));
app.get('/demande', (req, res) => res.sendFile(path.join(__dirname, '../public/public-request.html')));
app.get('/screen/:token', (req, res) => res.sendFile(path.join(__dirname, '../public/display.html')));

// ── SPA fallback (pages HTML) ─────────────────────────────────────────────────
app.get('*path', (req, res) => {
  if (!req.path.startsWith('/api')) {
    res.sendFile(path.join(__dirname, '../public/index.html'));
  } else {
    res.status(404).json({ error: 'Route introuvable' });
  }
});

// ── Gestion des erreurs ───────────────────────────────────────────────────────
app.use((err, req, res, _next) => {
  console.error('Erreur:', err);

  if (err.name === 'ValidationError') {
    return res.status(400).json({ error: err.message });
  }
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ error: 'Fichier trop volumineux' });
  }
  if (err.message?.includes('accepté')) {
    return res.status(400).json({ error: err.message });
  }

  const status = err.status || 500;
  res.status(status).json({
    error: config.env === 'production' ? 'Erreur interne du serveur' : err.message
  });
});

module.exports = app;
