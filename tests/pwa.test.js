const request = require('supertest');

jest.mock('../src/lib/prisma', () => ({ user: { findUnique: jest.fn() } }));

jest.mock('@prisma/client', () => {
  const mockPrisma = { user: { findUnique: jest.fn() } };
  return { PrismaClient: jest.fn(() => mockPrisma) };
});

jest.mock('../src/middleware/auth', () => ({
  requireAuth: (req, _res, next) => { req.user = { id: 'u1', role: 'ADMIN', name: 'A', email: 'a@test.com', isActive: true }; next(); },
  optionalAuth: (_req, _res, next) => next()
}));

const app = require('../src/app');

describe('PWA assets', () => {
  it('GET /manifest.json → 200 + JSON', async () => {
    const res = await request(app).get('/manifest.json');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/json/);
    expect(res.body.display).toBe('standalone');
    expect(res.body.icons).toEqual(expect.arrayContaining([
      expect.objectContaining({ src: '/assets/app-icon-192.png', sizes: '192x192' }),
      expect.objectContaining({ src: '/assets/app-icon-512.png', sizes: '512x512' })
    ]));
  });

  it('sert les icônes PNG utilisées par les applications Apple et Android', async () => {
    const [icon192, icon512] = await Promise.all([
      request(app).get('/assets/app-icon-192.png'),
      request(app).get('/assets/app-icon-512.png')
    ]);
    expect(icon192.status).toBe(200);
    expect(icon192.headers['content-type']).toMatch(/image\/png/);
    expect(icon512.status).toBe(200);
    expect(icon512.headers['content-type']).toMatch(/image\/png/);
  });

  it('GET /sw.js → 200 + JS', async () => {
    const res = await request(app).get('/sw.js');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/javascript/);
  });

  it('GET /health → 200', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});
