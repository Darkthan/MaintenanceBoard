const express = require('express');
const request = require('supertest');

jest.mock('../src/middleware/auth', () => ({
  requireAuth: (req, _res, next) => {
    req.user = {
      id: 'user-1',
      role: 'ADMIN',
      name: 'Jean Dupont',
      email: 'login@test.com',
      contactEmail: 'notify@test.com',
      isActive: true
    };
    next();
  }
}));

jest.mock('../src/middleware/roles', () => ({
  requireAdmin: (_req, _res, next) => next()
}));

jest.mock('../src/lib/prisma', () => ({
  user: {
    findUnique: jest.fn(),
    update: jest.fn()
  },
  passkey: {
    findFirst: jest.fn(),
    delete: jest.fn()
  },
  refreshToken: {
    deleteMany: jest.fn()
  },
  loginLog: {
    create: jest.fn()
  }
}));

jest.mock('../src/services/authService', () => ({
  loginWithPassword: jest.fn(),
  refreshAccessToken: jest.fn(),
  beginPasskeyRegistration: jest.fn(),
  finishPasskeyRegistration: jest.fn(),
  beginPasskeyLogin: jest.fn(),
  finishPasskeyLogin: jest.fn(),
  setAuthCookies: jest.fn(),
  clearAuthCookies: jest.fn(),
  changePassword: jest.fn()
}));

const prisma = require('../src/lib/prisma');
const authService = require('../src/services/authService');
const authRouter = require('../src/routes/auth');

const app = express();
app.use(express.json());
app.use('/api/auth', authRouter);
app.use((err, _req, res, _next) => {
  res.status(err.status || 500).json({ error: err.message });
});

describe('GET /api/auth/me', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('retourne le profil courant avec prénom et nom séparés', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'login@test.com',
      contactEmail: 'notify@test.com',
      name: 'Jean Dupont',
      role: 'ADMIN',
      isActive: true,
      createdAt: '2026-03-19T10:00:00.000Z',
      passkeys: []
    });

    const res = await request(app).get('/api/auth/me');

    expect(res.status).toBe(200);
    expect(res.body.email).toBe('login@test.com');
    expect(res.body.contactEmail).toBe('notify@test.com');
    expect(res.body.firstName).toBe('Jean');
    expect(res.body.lastName).toBe('Dupont');
  });
});

describe('PATCH /api/auth/me', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('met à jour le nom affiché et l’email de contact', async () => {
    prisma.user.update.mockResolvedValue({
      id: 'user-1',
      email: 'login@test.com',
      contactEmail: 'j.dupont@school.fr',
      name: 'Jean Claude Dupont',
      role: 'ADMIN',
      isActive: true,
      createdAt: '2026-03-19T10:00:00.000Z'
    });

    const res = await request(app)
      .patch('/api/auth/me')
      .send({
        firstName: 'Jean Claude',
        lastName: 'Dupont',
        contactEmail: 'j.dupont@school.fr'
      });

    expect(res.status).toBe(200);
    expect(prisma.user.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'user-1' },
      data: {
        name: 'Jean Claude Dupont',
        contactEmail: 'j.dupont@school.fr'
      }
    }));
    expect(res.body.firstName).toBe('Jean');
    expect(res.body.lastName).toBe('Claude Dupont');
  });

  it('refuse un email de contact invalide', async () => {
    const res = await request(app)
      .patch('/api/auth/me')
      .send({
        firstName: 'Jean',
        lastName: 'Dupont',
        contactEmail: 'not-an-email'
      });

    expect(res.status).toBe(400);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });
});

describe('POST /api/auth/change-password', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('transmet la demande au service d’authentification', async () => {
    authService.changePassword.mockResolvedValue();

    const res = await request(app)
      .post('/api/auth/change-password')
      .send({
        currentPassword: 'Ancien@123',
        newPassword: 'Nouveau@123'
      });

    expect(res.status).toBe(200);
    expect(authService.changePassword).toHaveBeenCalledWith('user-1', 'Ancien@123', 'Nouveau@123');
  });
});
