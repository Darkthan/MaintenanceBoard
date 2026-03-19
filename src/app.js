const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const session = require('express-session');
const path = require('path');
const rateLimit = require('express-rate-limit');
const config = require('./config');
const { swaggerUi, swaggerDocument } = require('./utils/swagger');

const app = express();

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
    sameSite: 'lax'
  },
  name: 'mb.sid'
}));

// ── Fichiers statiques ────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, '../public')));
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

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
app.use('/api/agents', require('./routes/agents'));
app.use('/api/settings', require('./routes/settings'));
app.use('/api/suppliers', require('./routes/suppliers'));
app.use('/api/stock', require('./routes/stock'));

// ── Tickets publics (sans auth, rate limit IP strict) ─────────────────────────
const ticketLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,
  message: { error: 'Trop de tickets soumis, réessayez dans une heure.' }
});
if (process.env.NODE_ENV !== 'test') {
  app.use('/api/tickets', ticketLimiter);
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

// ── Route QR scan (URL sans extension dans les QR codes générés) ──────────────
app.get('/scan', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/scan.html'));
});

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
