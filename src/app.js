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
app.use('/api/rooms', require('./routes/rooms'));
app.use('/api/equipment', require('./routes/equipment'));
app.use('/api/interventions', require('./routes/interventions'));
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

// ── Tickets publics (sans auth, rate limit IP strict) ─────────────────────────
const ticketLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,
  message: { error: 'Trop de tickets soumis, réessayez dans une heure.' }
});
// Magic link : limité par IP (10/h) ET par email (5/h) pour bloquer l'énumération
const magicLinkLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: { error: 'Trop de tentatives, réessayez dans une heure.' }
});
if (process.env.NODE_ENV !== 'test') {
  app.use('/api/tickets/magic-link', magicLinkLimiter);
  // Le ticketLimiter s'applique à la création de tickets (POST /) et aux messages
  // mais pas à magic-link ni à la lecture de statut (GET)
  app.use('/api/tickets', (req, res, next) => {
    if (req.method === 'POST' && (req.path === '/' || /^\/[^/]+\/messages$/.test(req.path))) {
      return ticketLimiter(req, res, next);
    }
    next();
  });
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
