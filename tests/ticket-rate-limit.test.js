const express = require('express');
const request = require('supertest');

jest.mock('../src/utils/settings', () => ({ readSettings: jest.fn(() => ({})), writeSettings: jest.fn() }));
jest.mock('../src/lib/prisma', () => ({}));
jest.mock('../src/middleware/auth', () => ({
  requireAuth: (req, res, next) => {
    if (!req.headers['x-role']) return res.sendStatus(401);
    req.user = { role: req.headers['x-role'] };
    next();
  }
}));
const { readSettings, writeSettings } = require('../src/utils/settings');
const { createTicketRateLimiter } = require('../src/middleware/ticketRateLimit');
const settingsRouter = require('../src/routes/settings');

function app() {
  const server = express();
  server.use(express.json());
  server.use('/api/settings', settingsRouter);
  server.use('/api/tickets', createTicketRateLimiter());
  server.use('/api/tickets', (_req, res) => res.sendStatus(201));
  return server;
}

beforeEach(() => {
  jest.clearAllMocks();
  readSettings.mockReturnValue({});
});

it('applique la limite puis une modification sans redémarrage, indépendamment du suivi', async () => {
  readSettings.mockReturnValue({ publicTickets: { requestsPerHour: 1 } });
  const server = app();
  expect((await request(server).post('/api/tickets')).status).toBe(201);
  expect((await request(server).post('/api/tickets')).status).toBe(429);
  expect((await request(server).post('/api/tickets/token/messages')).status).toBe(201);
  expect((await request(server).get('/api/tickets/token')).status).toBe(201);
  readSettings.mockReturnValue({ publicTickets: { requestsPerHour: 3 } });
  expect((await request(server).post('/api/tickets')).status).toBe(201);
});

it('expose la valeur par défaut et enregistre la limite administrateur', async () => {
  const server = app();
  const result = await request(server).get('/api/settings/public-tickets').set('x-role', 'ADMIN');
  expect(result.body).toEqual({ requestsPerHour: 10 });
  expect((await request(server).patch('/api/settings/public-tickets').set('x-role', 'ADMIN').send({ requestsPerHour: 25 })).status).toBe(200);
  expect(writeSettings).toHaveBeenCalledWith({ publicTickets: { requestsPerHour: 25 } });
});

it.each([0, -1, 1.5, 10001, '20', null])('refuse une limite invalide : %s', async requestsPerHour => {
  expect((await request(app()).patch('/api/settings/public-tickets').set('x-role', 'ADMIN').send({ requestsPerHour })).status).toBe(400);
  expect(writeSettings).not.toHaveBeenCalled();
});

it('réserve la consultation et la modification aux administrateurs', async () => {
  const server = app();
  for (const method of ['get', 'patch']) {
    expect((await request(server)[method]('/api/settings/public-tickets')).status).toBe(401);
    expect((await request(server)[method]('/api/settings/public-tickets').set('x-role', 'TECH')).status).toBe(403);
  }
});
