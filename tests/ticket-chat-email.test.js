const express = require('express');
const request = require('supertest');

jest.mock('../src/utils/ticketNotifications', () => ({
  ...jest.requireActual('../src/utils/ticketNotifications'),
  sendBrowserPush: jest.fn().mockResolvedValue({ sent: true, expired: false })
}));
const { sendBrowserPush } = require('../src/utils/ticketNotifications');

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
    findUnique: jest.fn(),
    create: jest.fn()
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

jest.mock('../src/utils/settings', () => ({
  readSettings: jest.fn(() => ({})),
  writeSettings: jest.fn()
}));

const prisma = require('../src/lib/prisma');
const { createSmtpTransporter } = require('../src/utils/mail');
const { writeSettings } = require('../src/utils/settings');
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

  it('prévient les administrateurs lors de la création d’une nouvelle demande', async () => {
    prisma.intervention.create.mockImplementation(async ({ data }) => ({
      id: 'ticket-new',
      title: data.title,
      reporterToken: data.reporterToken
    }));
    prisma.user.findMany.mockResolvedValue([
      { name: 'Admin A', email: 'admin-a@example.test', contactEmail: null }
    ]);

    const res = await request(buildApp())
      .post('/api/tickets')
      .field('title', 'Projecteur en panne')
      .field('reporterName', 'Jean Dupont')
      .field('reporterEmail', 'jean@example.test')
      .field('notifyByEmail', 'true')
      .field('pushSubscription', JSON.stringify({
        endpoint: 'https://push.example.test/requester-1',
        keys: { p256dh: 'requester-public-key', auth: 'requester-auth-key' }
      }));

    expect(res.status).toBe(201);
    expect(prisma.intervention.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        reporters: {
          create: expect.objectContaining({
            notifyByEmail: true,
            pushSubscription: expect.stringContaining('requester-1')
          })
        }
      })
    }));
    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(sendMail.mock.calls[0][0]).toEqual(expect.objectContaining({
      to: 'admin-a@example.test',
      subject: '[Nouvelle demande] Projecteur en panne'
    }));
    expect(sendMail.mock.calls[0][0].html).toContain('/messages-ticket.html?id=ticket-new');
  });

  it('enregistre séparément les notifications navigateur des administrateurs', async () => {
    const subscription = {
      endpoint: 'https://push.example.test/admin-1',
      keys: { p256dh: 'public-key', auth: 'auth-key' }
    };

    const res = await request(buildApp())
      .post('/api/tickets/admin-push-subscriptions')
      .send({ subscription });

    expect(res.status).toBe(201);
    expect(writeSettings).toHaveBeenCalledWith({
      ticketNotifications: {
        adminPushSubscriptions: [expect.objectContaining({ endpoint: subscription.endpoint })]
      }
    });
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

  it('respecte le refus des notifications email du demandeur', async () => {
    prisma.intervention.findUnique.mockResolvedValue({
      id: 'ticket-no-email',
      title: 'Demande silencieuse',
      techId: null,
      reporterName: null,
      reporterEmail: 'SILENCE@example.test',
      reporterToken: null,
      reporters: [{
        id: 'reporter-1',
        email: 'silence@example.test',
        name: 'Camille',
        token: 'silent-token',
        notifyByEmail: false,
        pushSubscription: null
      }]
    });

    const res = await request(buildApp())
      .post('/api/interventions/ticket-no-email/messages')
      .field('content', 'Votre demande a été traitée.');

    expect(res.status).toBe(201);
    expect(sendMail).not.toHaveBeenCalled();
  });
});

describe('notifications navigateur des réponses', () => {
  it.each(['jean@example.test', null])('préserve l’abonnement avec email %s malgré les données historiques', async email => {
    jest.clearAllMocks();
    createSmtpTransporter.mockReturnValue({ transporter: null });
    const subscription = JSON.stringify({
      endpoint: 'https://push.example.test/reporter',
      keys: { p256dh: 'public-key', auth: 'auth-key' }
    });
    prisma.intervention.findUnique.mockResolvedValue({
      id: 'ticket-push', title: 'Réseau', reporterEmail: email,
      reporterToken: 'legacy-token',
      reporters: [{ id: 'reporter-1', email, token: 'current-token', notifyByEmail: false, pushSubscription: subscription }]
    });
    prisma.ticketMessage.create.mockResolvedValue({ id: 'message-push', content: 'Réparé' });
    const res = await request(buildApp()).post('/api/interventions/ticket-push/messages').field('content', 'Réparé');
    expect(res.status).toBe(201);
    expect(sendBrowserPush).toHaveBeenCalledTimes(1);
    expect(sendBrowserPush).toHaveBeenCalledWith(subscription, expect.objectContaining({
      url: '/ticket-status.html?token=current-token', body: 'Réparé'
    }));
  });
});
