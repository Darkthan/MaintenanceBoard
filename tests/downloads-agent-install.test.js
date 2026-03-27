const request = require('supertest');
process.env.AGENT_ENROLLMENT_MAX_AGE = '3600000';

jest.mock('../src/middleware/auth', () => ({
  requireAuth: (req, _res, next) => {
    req.user = { id: 'u1', role: 'ADMIN', name: 'Admin', email: 'a@test.com', isActive: true };
    next();
  },
  optionalAuth: (_req, _res, next) => next()
}));

jest.mock('../src/lib/prisma', () => ({
  agentToken: { findUnique: jest.fn() },
  supplier: { findMany: jest.fn() },
  stockItem: { findMany: jest.fn() },
  stockMovement: { findMany: jest.fn() },
  equipment: { findMany: jest.fn() },
  intervention: { findMany: jest.fn() },
  order: { findMany: jest.fn() },
  user: { findUnique: jest.fn() }
}));

jest.mock('@prisma/client', () => {
  const mockPrisma = {
    supplier: { findMany: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn() },
    user: { findUnique: jest.fn() }
  };
  return { PrismaClient: jest.fn(() => mockPrisma) };
});

const app = require('../src/app');
const prisma = require('../src/lib/prisma');

describe('public agent install downloads', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('autorise /downloads/install.ps1 avec un enrollmentToken valide sans session', async () => {
    prisma.agentToken.findUnique.mockResolvedValue({ id: 'tok-1', token: 'abc', isActive: true, createdAt: new Date() });

    const res = await request(app).get('/downloads/install.ps1?enrollmentToken=abc');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/plain/);
    expect(res.text).toContain('abc');
    expect(res.text).toContain('/downloads/agent.ps1?enrollmentToken=');
  });

  it('refuse /downloads/install.ps1 sans token', async () => {
    const res = await request(app).get('/downloads/install.ps1');
    expect(res.status).toBe(400);
  });

  it('autorise /downloads/agent.ps1 avec un enrollmentToken valide sans session', async () => {
    prisma.agentToken.findUnique.mockResolvedValue({ id: 'tok-1', token: 'abc', isActive: true, createdAt: new Date() });

    const res = await request(app).get('/downloads/agent.ps1?enrollmentToken=abc');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/plain/);
  });

  it('refuse /downloads/linux avec token invalide', async () => {
    prisma.agentToken.findUnique.mockResolvedValue(null);

    const res = await request(app).get('/downloads/linux?enrollmentToken=invalid');

    expect(res.status).toBe(403);
  });

  it('refuse /downloads/agent.sh sans session ni token valide', async () => {
    prisma.agentToken.findUnique.mockResolvedValue(null);

    const res = await request(app).get('/downloads/agent.sh');

    expect(res.status).toBe(401);
  });

  it('refuse un enrollmentToken expiré', async () => {
    prisma.agentToken.findUnique.mockResolvedValue({
      id: 'tok-1',
      token: 'expired',
      isActive: true,
      createdAt: new Date(Date.now() - (2 * 3600000))
    });

    const res = await request(app).get('/downloads/install.ps1?enrollmentToken=expired');

    expect(res.status).toBe(403);
  });
});
