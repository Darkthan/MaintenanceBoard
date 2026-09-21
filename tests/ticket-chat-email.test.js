const express = require('express');
const request = require('supertest');

jest.mock('../src/middleware/auth', () => ({
  requireAuth: (req, _res, next) => {
    req.user = { id: 'admin-1', role: 'ADMIN', name: 'Alice Support', email: 'alice@example.test', isActive: true };
    next();
  }
}));

jest.mock('../src/middleware/roles', () => ({
  requireAdmin: (_req, _res, next) => next()
}));

jest.mock('../src/middleware/upload', () => ({
  uploadPhoto: { array: () => (_req, _res, next) => next() }
}));

jest.mock('../src/lib/prisma', () => ({
  intervention: {
    findUnique: jest.fn()
  },
  ticketMessage: {
    findFirst: jest.fn(),
    count: jest.fn(),
    create: jest.fn()
  },
  user: {
    findMany: jest.fn()
  }
}));

jest.mock('../src/utils/mail', () => ({
  createSmtpTransporter: jest.fn()
}));

const prisma = require('../src/lib/prisma');
const { createSmtpTransporter } = require('../src/utils/mail');
const ticketsRouter = require('../src/routes/tickets');
const interventionsRouter = require('../src/routes/interventions');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use('/api/tickets', ticketsRouter);
  app.use('/api/interventions', interventionsRouter);
  app.use((err, _req, res, _next) => res.status(500).json({ error: err.message }));
  return app;
}

describe('notifications email du chat ticket', () => {
  let sendMail;

  beforeEach(() => {
    jest.clearAllMocks();
    sendMail = jest.fn().mockResolvedValue({ messageId: 'mail-1' });
    createSmtpTransporter.mockReturnValue({
      transporter: { sendMail },
      from: 'maintenance@example.test'
    });
    prisma.ticketMessage.findFirst.mockResolvedValue(null);
    prisma.ticketMessage.count.mockResolvedValue(0);
    prisma.ticketMessage.create.mockImplementation(async ({ data }) => ({
      id: 'message-1',
      createdAt: new Date('2026-09-21T10:00:00.000Z'),
      readAt: null,
      attachmentName: null,
      ...data
    }));
  });

  it('prévient tous les administrateurs actifs lorsqu’un demandeur écrit sur un ticket non attribué', async () => {
    prisma.intervention.findUnique.mockResolvedValue({
      id: 'ticket-1',
      title: 'Écran noir',
      reporterName: 'Jean',
      reporterEmail: 'jean@example.test',
      reporterToken: 'reporter-token',
      tech: null,
      room: null,
      equipment: null
    });
    prisma.user.findMany.mockResolvedValue([
      { name: 'Admin A', email: 'admin-a@example.test', contactEmail: null },
      { name: 'Admin B', email: 'login-b@example.test', contactEmail: 'support-b@example.test' }
    ]);

    const res = await request(buildApp())
      .post('/api/tickets/reporter-token/messages')
      .field('content', 'Le problème continue.');

    expect(res.status).toBe(201);
    expect(prisma.user.findMany).toHaveBeenCalledWith({
      where: { role: 'ADMIN', isActive: true },
      select: { email: true, contactEmail: true, name: true }
    });
    expect(sendMail).toHaveBeenCalledTimes(2);
    expect(sendMail.mock.calls.map(([mail]) => mail.to)).toEqual([
      'admin-a@example.test',
      'support-b@example.test'
    ]);
    expect(sendMail.mock.calls[0][0].html).toContain('/messages-ticket.html?id=ticket-1');
  });

  it('utilise en priorité l’email de contact du technicien attribué', async () => {
    prisma.intervention.findUnique.mockResolvedValue({
      id: 'ticket-2',
      title: 'Imprimante bloquée',
      reporterName: 'Jeanne',
      reporterEmail: 'jeanne@example.test',
      reporterToken: 'reporter-token-2',
      tech: {
        name: 'Technicien',
        email: 'login-tech@example.test',
        contactEmail: 'tech@example.test'
      },
      room: null,
      equipment: null
    });

    const res = await request(buildApp())
      .post('/api/tickets/reporter-token-2/messages')
      .field('content', 'Voici une précision.');

    expect(res.status).toBe(201);
    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(sendMail.mock.calls[0][0].to).toBe('tech@example.test');
    expect(prisma.user.findMany).not.toHaveBeenCalled();
  });

  it('prévient aussi le demandeur des anciens tickets lorsqu’un technicien répond', async () => {
    prisma.intervention.findUnique.mockResolvedValue({
      id: 'ticket-legacy',
      title: 'Réseau indisponible',
      techId: null,
      reporterName: 'Ancien demandeur',
      reporterEmail: 'legacy@example.test',
      reporterToken: 'legacy-token',
      reporters: []
    });

    const res = await request(buildApp())
      .post('/api/interventions/ticket-legacy/messages')
      .field('content', 'Le réseau est de nouveau disponible.');

    expect(res.status).toBe(201);
    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(sendMail.mock.calls[0][0]).toEqual(expect.objectContaining({
      to: 'legacy@example.test',
      subject: '[Réponse] Réseau indisponible – MaintenanceBoard'
    }));
    expect(sendMail.mock.calls[0][0].html).toContain('/ticket-status.html?token=legacy-token');
  });
});
