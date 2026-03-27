const request = require('supertest');
const fs = require('fs');
const path = require('path');

jest.mock('../src/lib/prisma', () => ({ user: { findUnique: jest.fn() } }));

jest.mock('@prisma/client', () => {
  const mockPrisma = { user: { findUnique: jest.fn() } };
  return { PrismaClient: jest.fn(() => mockPrisma) };
});

jest.mock('../src/middleware/auth', () => ({
  requireAuth: (req, _res, next) => {
    req.user = { id: 'u1', role: 'ADMIN', name: 'A', email: 'a@test.com', isActive: true };
    next();
  },
  optionalAuth: (_req, _res, next) => next()
}));

const app = require('../src/app');

describe('mobile viewport lock', () => {
  it('sert le client API avec le verrouillage du zoom mobile', async () => {
    const res = await request(app).get('/js/api.js');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/javascript/);
    expect(res.text).toContain('user-scalable=no');
    expect(res.text).toContain('maximum-scale=1');
    expect(res.text).toContain('gesturestart');
    expect(res.text).toContain('touchmove');
    expect(res.text).toContain('touchend');
  });

  it('expose un viewport verrouillé sur toutes les pages HTML publiques', () => {
    const htmlFiles = fs.readdirSync(path.join(process.cwd(), 'public'))
      .filter(file => file.endsWith('.html'));

    htmlFiles.forEach(file => {
      const content = fs.readFileSync(path.join(process.cwd(), 'public', file), 'utf8');
      expect(content).toContain('<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover" />');
    });
  });
});
