const express = require('express');
const request = require('supertest');

jest.mock('../src/middleware/auth', () => ({
  requireAuth: (req, _res, next) => {
    req.user = { id: 'admin-1', role: 'ADMIN', name: 'Admin', email: 'admin@test.com', isActive: true };
    next();
  }
}));

jest.mock('../src/middleware/roles', () => ({
  requireAdmin: (_req, _res, next) => next()
}));

jest.mock('../src/services/authService', () => ({
  loginWithPassword: jest.fn(),
  setAuthCookies: jest.fn(),
  clearAuthCookies: jest.fn()
}));

jest.mock('../src/utils/settings', () => {
  let state = {};
  return {
    readSettings: jest.fn(() => state),
    writeSettings: jest.fn((patch) => {
      state = { ...state, ...patch };
      return state;
    }),
    __setState(next) {
      state = next;
    },
    __getState() {
      return state;
    }
  };
});

jest.mock('../src/lib/prisma', () => ({
  loginLog: {
    create: jest.fn()
  },
  refreshToken: {
    deleteMany: jest.fn()
  },
  passkey: {
    findFirst: jest.fn(),
    delete: jest.fn()
  }
}));

const authRouter = require('../src/routes/auth');
const settingsRouter = require('../src/routes/settings');
const authService = require('../src/services/authService');
const settingsStore = require('../src/utils/settings');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRouter);
  app.use('/api/settings', settingsRouter);
  app.use((err, _req, res, _next) => {
    res.status(err.status || 500).json({ error: err.message });
  });
  return app;
}

describe('fail2ban settings', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    settingsStore.__setState({});
  });

  it('enregistre les listes d’IP publiques valides', async () => {
    const res = await request(buildApp())
      .patch('/api/settings/fail2ban')
      .send({
        enabled: true,
        maxAttempts: 4,
        windowMinutes: 20,
        blockMinutes: 120,
        whitelist: '8.8.8.8\n1.1.1.1',
        blacklist: ['9.9.9.9']
      });

    expect(res.status).toBe(200);
    expect(settingsStore.writeSettings).toHaveBeenCalledWith({
      fail2ban: expect.objectContaining({
        enabled: true,
        maxAttempts: 4,
        windowMinutes: 20,
        blockMinutes: 120,
        whitelist: ['8.8.8.8', '1.1.1.1'],
        blacklist: ['9.9.9.9']
      })
    });
  });

  it('refuse les IP privées dans les listes', async () => {
    const res = await request(buildApp())
      .patch('/api/settings/fail2ban')
      .send({
        whitelist: '192.168.1.10'
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/IP publiques valides/);
  });
});

describe('fail2ban auth login', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    settingsStore.__setState({
      fail2ban: {
        enabled: true,
        maxAttempts: 2,
        windowMinutes: 15,
        blockMinutes: 60,
        whitelist: [],
        blacklist: [],
        blockedIps: [],
        failures: {}
      }
    });
  });

  it('bloque une IP publique après plusieurs échecs', async () => {
    authService.loginWithPassword.mockRejectedValue(Object.assign(new Error('Email ou mot de passe incorrect'), { status: 401 }));

    const app = buildApp();

    const first = await request(app)
      .post('/api/auth/login')
      .set('x-forwarded-for', '8.8.8.8')
      .send({ email: 'admin@test.com', password: 'badpass' });

    const second = await request(app)
      .post('/api/auth/login')
      .set('x-forwarded-for', '8.8.8.8')
      .send({ email: 'admin@test.com', password: 'badpass' });

    const third = await request(app)
      .post('/api/auth/login')
      .set('x-forwarded-for', '8.8.8.8')
      .send({ email: 'admin@test.com', password: 'badpass' });

    expect(first.status).toBe(401);
    expect(second.status).toBe(401);
    expect(third.status).toBe(429);
    expect(third.body.error).toMatch(/8\.8\.8\.8/);
  });

  it('ignore les IP privées pour le bannissement', async () => {
    authService.loginWithPassword.mockRejectedValue(Object.assign(new Error('Email ou mot de passe incorrect'), { status: 401 }));

    const app = buildApp();

    await request(app)
      .post('/api/auth/login')
      .set('x-forwarded-for', '192.168.1.15')
      .send({ email: 'admin@test.com', password: 'badpass' });

    await request(app)
      .post('/api/auth/login')
      .set('x-forwarded-for', '192.168.1.15')
      .send({ email: 'admin@test.com', password: 'badpass' });

    const third = await request(app)
      .post('/api/auth/login')
      .set('x-forwarded-for', '192.168.1.15')
      .send({ email: 'admin@test.com', password: 'badpass' });

    expect(third.status).toBe(401);
    expect(settingsStore.__getState().fail2ban.blockedIps || []).toHaveLength(0);
  });
});
