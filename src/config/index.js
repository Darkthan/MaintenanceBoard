require('dotenv').config();

const appUrl = process.env.APP_URL || 'http://localhost:3000';

function deriveWebAuthnDefaults(urlValue) {
  try {
    const parsed = new URL(urlValue);
    return {
      origin: parsed.origin,
      rpId: parsed.hostname
    };
  } catch {
    return {
      origin: 'http://localhost:3000',
      rpId: 'localhost'
    };
  }
}

const webauthnDefaults = deriveWebAuthnDefaults(appUrl);
const env = process.env.NODE_ENV || 'development';
const jwtSecret = process.env.JWT_SECRET || 'fallback-secret-change-in-production';
const sessionSecret = process.env.SESSION_SECRET || 'fallback-session-secret';

if (env === 'production') {
  if (jwtSecret === 'fallback-secret-change-in-production') {
    throw new Error('JWT_SECRET est obligatoire en production');
  }
  if (sessionSecret === 'fallback-session-secret') {
    throw new Error('SESSION_SECRET est obligatoire en production');
  }
}

module.exports = {
  env,
  port: parseInt(process.env.PORT) || 3000,
  appUrl,
  trustProxy: process.env.TRUST_PROXY !== undefined
    ? (process.env.TRUST_PROXY === 'true' ? true : parseInt(process.env.TRUST_PROXY, 10) || false)
    : (process.env.NODE_ENV === 'production' ? 1 : false),

  jwt: {
    secret: jwtSecret,
    accessExpires: process.env.JWT_ACCESS_EXPIRES || '15m',
    refreshExpires: process.env.JWT_REFRESH_EXPIRES || '7d',
  },

  session: {
    secret: sessionSecret,
    maxAge: parseInt(process.env.SESSION_MAX_AGE) || 86400000,
  },

  webauthn: {
    rpName: process.env.WEBAUTHN_RP_NAME || 'MaintenanceBoard',
    rpId: process.env.WEBAUTHN_RP_ID || webauthnDefaults.rpId,
    origin: process.env.WEBAUTHN_ORIGIN || webauthnDefaults.origin,
  },

  upload: {
    dir: process.env.UPLOAD_DIR || './uploads',
    maxSize: parseInt(process.env.MAX_FILE_SIZE) || 10485760,
  },

  database: {
    url: process.env.DATABASE_URL,
  },

  smtp: {
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT) || 587,
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
    from: process.env.SMTP_FROM || 'noreply@maintenance.local',
    secure: process.env.SMTP_SECURE === 'true',
    starttls: process.env.SMTP_STARTTLS === 'true',
  },

  agent: {
    enrollmentTokenMaxAge: parseInt(process.env.AGENT_ENROLLMENT_MAX_AGE) || 0, // 0 = illimité
  }
};
