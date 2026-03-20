const express = require('express');
const bcrypt = require('bcrypt');
const { body, validationResult } = require('express-validator');
const router = express.Router();
const authService = require('../services/authService');
const { requireAuth } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/roles');

const prisma = require('../lib/prisma');

function splitDisplayName(name) {
  const value = String(name || '').trim().replace(/\s+/g, ' ');
  if (!value) return { firstName: '', lastName: '' };
  const [firstName, ...rest] = value.split(' ');
  return { firstName, lastName: rest.join(' ') };
}

function buildDisplayName(firstName, lastName) {
  return [firstName, lastName]
    .map(v => String(v || '').trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ── Validation helpers ────────────────────────────────────────────────────────
const validate = (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({ errors: errors.array() });
    return false;
  }
  return true;
};

// ── POST /api/auth/register ───────────────────────────────────────────────────
router.post('/register',
  requireAuth, requireAdmin,
  [
    body('email').isEmail().normalizeEmail(),
    body('name').trim().isLength({ min: 2, max: 100 }),
    body('password').isLength({ min: 8 }).matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/),
    body('role').optional().isIn(['ADMIN', 'TECH'])
  ],
  async (req, res, next) => {
    try {
      if (!validate(req, res)) return;

      const { email, name, password, role } = req.body;

      const existing = await prisma.user.findUnique({ where: { email } });
      if (existing) {
        return res.status(409).json({ error: 'Cet email est déjà utilisé' });
      }

      const passwordHash = await bcrypt.hash(password, 12);
      const user = await prisma.user.create({
        data: { email, name, passwordHash, role: role || 'TECH' },
        select: { id: true, email: true, name: true, role: true, createdAt: true }
      });

      res.status(201).json({ user });
    } catch (err) {
      next(err);
    }
  }
);

// ── POST /api/auth/login ──────────────────────────────────────────────────────
router.post('/login',
  [
    body('email').isEmail().normalizeEmail(),
    body('password').notEmpty()
  ],
  async (req, res, next) => {
    try {
      if (!validate(req, res)) return;

      const { email, password } = req.body;
      const { user, accessToken, refreshToken } = await authService.loginWithPassword(email, password);

      authService.setAuthCookies(res, accessToken, refreshToken);

      // Log de connexion (non bloquant)
      prisma.loginLog.create({
        data: {
          userId: user.id,
          method: 'PASSWORD',
          ip: (req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || '').replace(/^::ffff:/, '') || null,
          userAgent: req.headers['user-agent'] || null
        }
      }).catch(() => {});

      res.json({ user, accessToken });
    } catch (err) {
      if (err.status === 401) return res.status(401).json({ error: err.message });
      next(err);
    }
  }
);

// ── POST /api/auth/refresh ────────────────────────────────────────────────────
router.post('/refresh', async (req, res, next) => {
  try {
    const refreshToken = req.cookies?.refreshToken || req.body?.refreshToken;
    if (!refreshToken) {
      return res.status(401).json({ error: 'Refresh token manquant' });
    }

    const { accessToken, refreshToken: newRefreshToken } = await authService.refreshAccessToken(refreshToken);
    authService.setAuthCookies(res, accessToken, newRefreshToken);

    res.json({ accessToken });
  } catch (err) {
    if (err.status === 401) return res.status(401).json({ error: err.message });
    next(err);
  }
});

// ── POST /api/auth/logout ─────────────────────────────────────────────────────
router.post('/logout', requireAuth, async (req, res, next) => {
  try {
    const refreshToken = req.cookies?.refreshToken || req.body?.refreshToken;
    if (refreshToken) {
      await prisma.refreshToken.deleteMany({ where: { token: refreshToken } });
    }
    authService.clearAuthCookies(res);
    req.session.destroy(() => {});
    res.json({ message: 'Déconnexion réussie' });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/auth/me ──────────────────────────────────────────────────────────
router.get('/me', requireAuth, async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: {
        id: true, email: true, contactEmail: true, name: true, role: true,
        isActive: true, createdAt: true,
        passkeys: { select: { id: true, name: true, createdAt: true, lastUsedAt: true } }
      }
    });
    res.json({
      ...user,
      ...splitDisplayName(user?.name)
    });
  } catch (err) {
    next(err);
  }
});

// ── PATCH /api/auth/me ────────────────────────────────────────────────────────
router.patch('/me',
  requireAuth,
  [
    body('firstName').trim().isLength({ min: 1, max: 60 }),
    body('lastName').trim().isLength({ min: 1, max: 60 }),
    body('contactEmail').optional({ nullable: true, checkFalsy: true }).isEmail().normalizeEmail()
  ],
  async (req, res, next) => {
    try {
      if (!validate(req, res)) return;

      const fullName = buildDisplayName(req.body.firstName, req.body.lastName);
      if (!fullName) {
        return res.status(400).json({ error: 'Le nom complet est requis' });
      }

      const user = await prisma.user.update({
        where: { id: req.user.id },
        data: {
          name: fullName,
          contactEmail: req.body.contactEmail || null
        },
        select: {
          id: true,
          email: true,
          contactEmail: true,
          name: true,
          role: true,
          isActive: true,
          createdAt: true
        }
      });

      res.json({
        ...user,
        ...splitDisplayName(user.name)
      });
    } catch (err) {
      if (err.code === 'P2025') return res.status(404).json({ error: 'Utilisateur introuvable' });
      next(err);
    }
  }
);

// ── POST /api/auth/change-password ────────────────────────────────────────────
router.post('/change-password',
  requireAuth,
  [
    body('newPassword').isLength({ min: 8 }).matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
  ],
  async (req, res, next) => {
    try {
      if (!validate(req, res)) return;
      const { currentPassword, newPassword } = req.body;
      await authService.changePassword(req.user.id, currentPassword, newPassword);
      res.json({ message: 'Mot de passe mis à jour' });
    } catch (err) {
      if (err.status === 400) return res.status(400).json({ error: err.message });
      next(err);
    }
  }
);

// ── WebAuthn : Enregistrement ─────────────────────────────────────────────────

router.post('/webauthn/register/begin', requireAuth, async (req, res, next) => {
  try {
    const options = await authService.beginPasskeyRegistration(req.user);
    req.session.webauthnChallenge = options.challenge;
    await new Promise((resolve, reject) => req.session.save(err => err ? reject(err) : resolve()));
    res.json(options);
  } catch (err) {
    next(err);
  }
});

router.post('/webauthn/register/finish', requireAuth, async (req, res, next) => {
  try {
    const challenge = req.session.webauthnChallenge;
    if (!challenge) {
      return res.status(400).json({ error: 'Challenge WebAuthn manquant ou expiré' });
    }

    delete req.session.webauthnChallenge;
    await new Promise((resolve, reject) => req.session.save(err => err ? reject(err) : resolve()));

    const passkey = await authService.finishPasskeyRegistration(
      req.user,
      req.body,
      challenge,
      req.body.name
    );

    res.json({
      message: 'Passkey enregistrée avec succès',
      passkey: { id: passkey.id, name: passkey.name, createdAt: passkey.createdAt }
    });
  } catch (err) {
    if (err.status === 400) return res.status(400).json({ error: err.message });
    next(err);
  }
});

// ── WebAuthn : Authentification ───────────────────────────────────────────────

router.post('/webauthn/login/begin', async (req, res, next) => {
  try {
    const { email } = req.body;
    const { options, userId } = await authService.beginPasskeyLogin(email);
    req.session.webauthnChallenge = options.challenge;
    req.session.webauthnUserId = userId;
    await new Promise((resolve, reject) => req.session.save(err => err ? reject(err) : resolve()));
    res.json(options);
  } catch (err) {
    next(err);
  }
});

router.post('/webauthn/login/finish', async (req, res, next) => {
  try {
    const challenge = req.session.webauthnChallenge;
    const userId = req.session.webauthnUserId;

    if (!challenge) {
      return res.status(400).json({ error: 'Challenge WebAuthn manquant ou expiré' });
    }

    delete req.session.webauthnChallenge;
    delete req.session.webauthnUserId;
    await new Promise((resolve, reject) => req.session.save(err => err ? reject(err) : resolve()));

    const { user, accessToken, refreshToken } = await authService.finishPasskeyLogin(
      req.body, challenge, userId
    );

    authService.setAuthCookies(res, accessToken, refreshToken);

    // Log de connexion (non bloquant)
    prisma.loginLog.create({
      data: {
        userId: user.id,
        method: 'PASSKEY',
        ip: (req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || '').replace(/^::ffff:/, '') || null,
        userAgent: req.headers['user-agent'] || null
      }
    }).catch(() => {});

    res.json({ user, accessToken });
  } catch (err) {
    if (err.status === 401) return res.status(401).json({ error: err.message });
    next(err);
  }
});

// ── DELETE /api/auth/passkeys/:id ─────────────────────────────────────────────
router.delete('/passkeys/:id', requireAuth, async (req, res, next) => {
  try {
    const passkey = await prisma.passkey.findFirst({
      where: { id: req.params.id, userId: req.user.id }
    });
    if (!passkey) return res.status(404).json({ error: 'Passkey introuvable' });

    await prisma.passkey.delete({ where: { id: req.params.id } });
    res.json({ message: 'Passkey supprimée' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
