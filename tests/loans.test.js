const express = require('express');
const fs = require('fs');
const request = require('supertest');
const { createSmtpTransporter } = require('../src/utils/mail');

jest.mock('../src/middleware/auth', () => ({
  requireAuth: (req, _res, next) => {
    req.user = { id: 'admin-1', role: req.headers['x-user-role'] || 'ADMIN', name: 'Admin', email: 'admin@test.com', isActive: true };
    next();
  }
}));

jest.mock('../src/config', () => ({
  appUrl: 'https://maintenanceboard.test'
}));

jest.mock('../src/utils/mail', () => ({
  createSmtpTransporter: jest.fn(() => ({
    transporter: { sendMail: jest.fn().mockResolvedValue({}) },
    from: 'noreply@test.local'
  }))
}));

jest.mock('../src/lib/prisma', () => ({
  loanResource: {
    upsert: jest.fn(),
    findUnique: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn()
  },
  loanReservationEquipment: {
    deleteMany: jest.fn(),
    createMany: jest.fn()
  },
  loanMagicLink: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn()
  },
  loanRequestAccessLink: {
    create: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn()
  },
  loanReservation: {
    updateMany: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    delete: jest.fn()
  },
  interventionReporter: {
    findMany: jest.fn()
  },
  intervention: {
    findMany: jest.fn()
  },
  signatureRequest: {
    findUnique: jest.fn(),
    updateMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn()
  }
}));

const prisma = require('../src/lib/prisma');
const { loansRouter, loanPublicRouter } = require('../src/routes/loans');
const { signRouter } = require('../src/routes/signatures');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/loans', loansRouter);
  app.use('/api/loan-request', loanPublicRouter);
  app.use('/api/sign', signRouter);
  app.use((err, _req, res, _next) => {
    res.status(err.status || 500).json({ error: err.message });
  });
  return app;
}

describe('loan requests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('retourne un lien général pour les demandes publiques', async () => {
    prisma.loanMagicLink.findFirst.mockResolvedValue({
      id: 'general-link',
      token: 'general-loan-token',
      expiresAt: null
    });

    const res = await request(buildApp()).get('/api/loans/general-request-link');

    expect(res.status).toBe(200);
    expect(res.body.url).toBe('https://maintenanceboard.test/demande');
    expect(prisma.loanMagicLink.create).not.toHaveBeenCalled();
  });

  it('expose le jeton de réservation au portail public général', async () => {
    prisma.loanMagicLink.findFirst.mockResolvedValue({ token: 'general-loan-token' });

    const res = await request(buildApp()).get('/api/loan-request/general-link');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ token: 'general-loan-token' });
  });

  it('regroupe les réservations et interventions du compte connecté', async () => {
    prisma.loanRequestAccessLink.findUnique.mockResolvedValue({
      token: 'account-access-token',
      email: 'jean@example.com',
      requesterName: 'Jean Dupont',
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      requestLink: { id: 'link-1', token: 'loan-token' }
    });
    prisma.loanReservation.findMany.mockResolvedValue([{
      id: 'reservation-1',
      status: 'APPROVED',
      requesterName: 'Jean Dupont',
      startAt: new Date('2026-10-01T08:00:00.000Z'),
      endAt: new Date('2026-10-01T16:00:00.000Z'),
      requestedUnits: 1,
      createdAt: new Date('2026-09-20T08:00:00.000Z'),
      resource: { name: 'Vidéoprojecteur', location: 'Accueil' }
    }]);
    prisma.interventionReporter.findMany.mockResolvedValue([{
      token: 'reporter-token',
      intervention: {
        id: 'intervention-1',
        title: 'Écran noir',
        status: 'OPEN',
        source: 'PUBLIC',
        mergedIntoId: null,
        createdAt: new Date('2026-09-21T08:00:00.000Z'),
        updatedAt: new Date('2026-09-21T09:00:00.000Z'),
        room: { name: 'Salle 12' },
        equipment: null
      }
    }]);
    prisma.intervention.findMany.mockResolvedValue([]);

    const res = await request(buildApp())
      .get('/api/loan-request/account')
      .query({ access: 'account-access-token' });

    expect(res.status).toBe(200);
    expect(res.body.account).toEqual(expect.objectContaining({ email: 'jean@example.com', name: 'Jean Dupont' }));
    expect(res.body.reservations[0]).toEqual(expect.objectContaining({ id: 'reservation-1', status: 'APPROVED' }));
    expect(res.body.interventions[0]).toEqual(expect.objectContaining({ id: 'intervention-1', reporterToken: 'reporter-token' }));
  });

  it('refuse le compte lorsque le lien de connexion a expiré', async () => {
    prisma.loanRequestAccessLink.findUnique.mockResolvedValue({
      token: 'expired-access-token',
      email: 'jean@example.com',
      expiresAt: new Date(Date.now() - 1000),
      requestLink: { id: 'link-1' }
    });

    const res = await request(buildApp())
      .get('/api/loan-request/account')
      .query({ access: 'expired-access-token' });

    expect(res.status).toBe(401);
  });

  it('modifie le nom du compte public connecté', async () => {
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    prisma.loanRequestAccessLink.findUnique.mockResolvedValue({
      id: 'access-1', token: 'account-access-token', email: 'jean@example.com', requesterName: 'Jean', expiresAt,
      requestLink: { id: 'link-1' }
    });
    prisma.loanRequestAccessLink.update.mockResolvedValue({
      id: 'access-1', email: 'jean@example.com', requesterName: 'Jean Dupont', expiresAt
    });

    const res = await request(buildApp())
      .patch('/api/loan-request/account')
      .send({ accessToken: 'account-access-token', requesterName: 'Jean Dupont' });

    expect(res.status).toBe(200);
    expect(prisma.loanRequestAccessLink.update).toHaveBeenCalledWith({
      where: { id: 'access-1' },
      data: { requesterName: 'Jean Dupont' }
    });
    expect(res.body.account).toEqual(expect.objectContaining({ name: 'Jean Dupont', email: 'jean@example.com' }));
  });

  it('envoie un lien de connexion par email pour acceder au formulaire', async () => {
    prisma.loanMagicLink.findUnique.mockResolvedValue({
      id: 'link-1',
      token: 'magic-1',
      isActive: true,
      expiresAt: null,
      resourceId: 'resource-1'
    });
    prisma.loanRequestAccessLink.create.mockResolvedValue({
      id: 'access-1',
      token: 'access-token-1',
      email: 'jean@example.com',
      requesterName: 'Jean Dupont',
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    });

    const res = await request(buildApp())
      .post('/api/loan-request/magic-1/access-link')
      .send({
        requesterEmail: 'jean@example.com',
        requesterName: 'Jean Dupont'
      });

    expect(res.status).toBe(200);
    expect(prisma.loanRequestAccessLink.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        requestLinkId: 'link-1',
        email: 'jean@example.com'
      })
    }));
    const sendMail = createSmtpTransporter.mock.results[0].value.transporter.sendMail;
    const emailHtml = sendMail.mock.calls[0][0].html;
    expect(emailHtml).toContain('https://maintenanceboard.test/loan-auth.html?token=magic-1&access=access-token-1');
    expect(emailHtml).toContain('Autoriser la connexion');
    expect(emailHtml).not.toContain('/loan-request.html?token=magic-1');
  });

  it('prolonge le lien de connexion public a un an quand rester connecte est coche', async () => {
    prisma.loanMagicLink.findUnique.mockResolvedValue({
      id: 'link-1',
      token: 'magic-1',
      isActive: true,
      expiresAt: null,
      resourceId: 'resource-1'
    });
    prisma.loanRequestAccessLink.create.mockResolvedValue({
      id: 'access-1',
      token: 'access-token-1',
      email: 'jean@example.com',
      requesterName: 'Jean Dupont',
      expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)
    });

    const res = await request(buildApp())
      .post('/api/loan-request/magic-1/access-link')
      .send({
        requesterEmail: 'jean@example.com',
        requesterName: 'Jean Dupont',
        rememberMe: true
      });

    expect(res.status).toBe(200);
    const expiresAt = prisma.loanRequestAccessLink.create.mock.calls[0][0].data.expiresAt;
    const ttlMs = expiresAt.getTime() - Date.now();
    expect(ttlMs).toBeGreaterThan(360 * 24 * 60 * 60 * 1000);
    expect(ttlMs).toBeLessThanOrEqual(365 * 24 * 60 * 60 * 1000);
    const sendMail = createSmtpTransporter.mock.results[0].value.transporter.sendMail;
    expect(sendMail.mock.calls[0][0].html).toContain('remember=1');
  });

  it('fait revenir le magic link vers le compte général', async () => {
    prisma.loanMagicLink.findUnique.mockResolvedValue({
      id: 'link-1', token: 'magic-1', title: 'Lien général de demande', isActive: true, expiresAt: null, resourceId: null
    });
    prisma.loanRequestAccessLink.create.mockResolvedValue({
      id: 'access-1', token: 'access-token-1', email: 'jean@example.com', requesterName: 'Jean', expiresAt: new Date(Date.now() + 86400000)
    });

    const res = await request(buildApp())
      .post('/api/loan-request/magic-1/access-link')
      .send({ requesterEmail: 'jean@example.com', requesterName: 'Jean', returnTo: '/demande' });

    expect(res.status).toBe(200);
    const sendMail = createSmtpTransporter.mock.results[0].value.transporter.sendMail;
    expect(sendMail.mock.calls[0][0].html).toContain('return=%2Fdemande');
    expect(sendMail.mock.calls[0][0].subject).toContain('espace de demandes');
  });

  it('verrouille un lot complet meme pour une demande partielle', async () => {
    prisma.loanMagicLink.findUnique.mockResolvedValue({
      id: 'link-1',
      token: 'magic-1',
      isActive: true,
      expiresAt: null,
      resourceId: 'resource-1'
    });
    prisma.loanResource.findUnique.mockResolvedValue({
      id: 'resource-1',
      name: 'Valise tablettes',
      totalUnits: 10,
      bundleSize: 10,
      isActive: true
    });
    prisma.loanRequestAccessLink.findUnique.mockResolvedValue({
      id: 'access-1',
      token: 'access-token-1',
      email: 'jean@example.com',
      requesterName: 'Jean Dupont',
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      requestLink: {
        id: 'link-1',
        token: 'magic-1',
        isActive: true,
        expiresAt: null,
        resourceId: 'resource-1',
        resource: null
      }
    });
    prisma.loanReservation.findMany.mockResolvedValue([]);
    prisma.loanReservation.create.mockImplementation(async ({ data }) => ({
      id: 'reservation-1',
      status: 'PENDING',
      ...data,
      resource: {
        id: 'resource-1',
        name: 'Valise tablettes',
        totalUnits: 10,
        bundleSize: 10,
        isActive: true
      }
    }));

    const res = await request(buildApp())
      .post('/api/loan-request/magic-1/requests')
      .send({
        accessToken: 'access-token-1',
        resourceId: 'resource-1',
        requesterName: 'Jean Dupont',
        startAt: '2026-03-25T08:00:00.000Z',
        endAt: '2026-03-25T12:00:00.000Z',
        requestedUnits: 3,
        additionalNeeds: 'Installer une application dédiée'
      });

    expect(res.status).toBe(201);
    expect(prisma.loanReservation.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        requestedUnits: 3,
        reservedSlots: 1,
        requesterEmail: 'jean@example.com'
      })
    }));
  });

  it('refuse une seconde demande quand un lot complet est deja verrouille', async () => {
    prisma.loanMagicLink.findUnique.mockResolvedValue({
      id: 'link-1',
      token: 'magic-1',
      isActive: true,
      expiresAt: null,
      resourceId: 'resource-1'
    });
    prisma.loanResource.findUnique.mockResolvedValue({
      id: 'resource-1',
      name: 'Valise tablettes',
      totalUnits: 10,
      bundleSize: 10,
      isActive: true
    });
    prisma.loanRequestAccessLink.findUnique.mockResolvedValue({
      id: 'access-1',
      token: 'access-token-1',
      email: 'marie@example.com',
      requesterName: 'Marie Martin',
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      requestLink: {
        id: 'link-1',
        token: 'magic-1',
        isActive: true,
        expiresAt: null,
        resourceId: 'resource-1',
        resource: null
      }
    });
    prisma.loanReservation.findMany.mockResolvedValue([
      {
        id: 'reservation-existing',
        reservedSlots: 1,
        status: 'APPROVED',
        startAt: new Date('2026-03-25T08:00:00.000Z'),
        endAt: new Date('2026-03-25T12:00:00.000Z')
      }
    ]);

    const res = await request(buildApp())
      .post('/api/loan-request/magic-1/requests')
      .send({
        accessToken: 'access-token-1',
        resourceId: 'resource-1',
        requesterName: 'Marie Martin',
        startAt: '2026-03-25T09:00:00.000Z',
        endAt: '2026-03-25T11:00:00.000Z',
        requestedUnits: 1
      });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/Disponibilite insuffisante|Disponibilité insuffisante/i);
    expect(prisma.loanReservation.create).not.toHaveBeenCalled();
  });

  it('refuse une demande sans lien de connexion valide', async () => {
    prisma.loanMagicLink.findUnique.mockResolvedValue({
      id: 'link-1',
      token: 'magic-1',
      isActive: true,
      expiresAt: null,
      resourceId: 'resource-1'
    });
    prisma.loanRequestAccessLink.findUnique.mockResolvedValue(null);

    const res = await request(buildApp())
      .post('/api/loan-request/magic-1/requests')
      .send({
        accessToken: 'bad-token-123',
        resourceId: 'resource-1',
        requesterName: 'Jean Dupont',
        startAt: '2026-03-25T08:00:00.000Z',
        endAt: '2026-03-25T12:00:00.000Z',
        requestedUnits: 1
      });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/Lien de connexion invalide|nouveau lien/i);
  });

  it('supprime une reservation existante', async () => {
    prisma.loanReservation.findUnique.mockResolvedValue({ id: 'reservation-1' });
    prisma.loanReservation.delete.mockResolvedValue({ id: 'reservation-1' });

    const res = await request(buildApp())
      .delete('/api/loans/reservations/reservation-1');

    expect(res.status).toBe(204);
    expect(prisma.loanReservation.delete).toHaveBeenCalledWith({
      where: { id: 'reservation-1' }
    });
  });

  it('crée une réservation interne sans email saisi en utilisant le profil', async () => {
    prisma.loanResource.findUnique.mockResolvedValue({
      id: 'resource-1',
      name: 'Valise tablettes',
      totalUnits: 10,
      bundleSize: 10,
      usesBundles: true,
      isActive: true,
      equipments: []
    });
    prisma.loanReservation.findMany.mockResolvedValue([]);
    prisma.loanReservation.create.mockImplementation(async ({ data }) => ({
      id: 'reservation-internal',
      status: 'APPROVED',
      ...data,
      resource: {
        id: 'resource-1',
        name: 'Valise tablettes',
        totalUnits: 10,
        bundleSize: 10,
        isActive: true,
        equipments: []
      },
      selectedEquipments: []
    }));

    const res = await request(buildApp())
      .post('/api/loans/reservations')
      .send({
        resourceId: 'resource-1',
        requesterName: 'Jean Dupont',
        startAt: '2026-03-25T08:00:00.000Z',
        endAt: '2026-03-25T12:00:00.000Z',
        requestedUnits: 3
      });

    expect(res.status).toBe(201);
    expect(prisma.loanReservation.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        requesterEmail: 'admin@test.com'
      })
    }));
  });

  it('autorise un pret supplementaire sur une ressource sans lots tant que des unites restent disponibles', async () => {
    prisma.loanResource.findUnique.mockResolvedValue({
      id: 'resource-pc',
      name: 'PC portables',
      totalUnits: 4,
      bundleSize: 4,
      usesBundles: false,
      isActive: true,
      equipments: []
    });
    prisma.loanReservation.findMany.mockResolvedValue([
      {
        id: 'reservation-existing',
        reservedSlots: 3,
        status: 'APPROVED',
        startAt: new Date('2026-03-25T08:00:00.000Z'),
        endAt: new Date('2026-03-25T12:00:00.000Z')
      }
    ]);
    prisma.loanReservation.create.mockImplementation(async ({ data }) => ({
      id: 'reservation-extra',
      status: 'APPROVED',
      ...data,
      resource: {
        id: 'resource-pc',
        name: 'PC portables',
        totalUnits: 4,
        bundleSize: 4,
        usesBundles: false,
        isActive: true,
        equipments: []
      },
      selectedEquipments: []
    }));

    const res = await request(buildApp())
      .post('/api/loans/reservations')
      .send({
        resourceId: 'resource-pc',
        requesterName: 'Marie Martin',
        startAt: '2026-03-25T09:00:00.000Z',
        endAt: '2026-03-25T11:00:00.000Z',
        requestedUnits: 1
      });

    expect(res.status).toBe(201);
    expect(prisma.loanReservation.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        resourceId: 'resource-pc',
        requestedUnits: 1,
        reservedSlots: 1
      })
    }));
  });

  it('edite une reservation sans envoyer d email utilisateur', async () => {
    const sendMail = jest.fn().mockResolvedValue({});
    createSmtpTransporter.mockReturnValue({
      transporter: { sendMail },
      from: 'noreply@test.local'
    });

    prisma.loanReservation.findUnique.mockResolvedValue({
      id: 'reservation-2',
      resourceId: 'resource-1',
      contractSignatureRequestId: null,
      requesterName: 'Jean Dupont',
      requesterEmail: 'jean@example.com',
      requesterPhone: null,
      requesterOrganization: null,
      startAt: new Date('2026-04-02T08:00:00.000Z'),
      endAt: new Date('2026-04-02T10:00:00.000Z'),
      requestedUnits: 1,
      reservedSlots: 1,
      status: 'PENDING',
      notes: null,
      internalNotes: null,
      additionalNeeds: null,
      contractBody: null,
      approvedById: null,
      resource: {
        id: 'resource-1',
        name: 'Chariot iPad',
        totalUnits: 10,
        bundleSize: 5,
        isActive: true,
        equipments: []
      },
      selectedEquipments: [],
      contractSignatureRequest: null
    });
    prisma.loanResource.findUnique.mockResolvedValue({
      id: 'resource-1',
      name: 'Chariot iPad',
      totalUnits: 10,
      bundleSize: 5,
      isActive: true,
      equipments: []
    });
    prisma.loanReservation.findMany.mockResolvedValue([]);
    prisma.loanReservation.update.mockImplementation(async ({ data }) => ({
      id: 'reservation-2',
      resourceId: data.resourceId || 'resource-1',
      contractSignatureRequestId: null,
      requesterName: data.requesterName,
      requesterEmail: data.requesterEmail,
      requesterPhone: data.requesterPhone,
      requesterOrganization: data.requesterOrganization,
      startAt: data.startAt,
      endAt: data.endAt,
      requestedUnits: data.requestedUnits,
      reservedSlots: data.reservedSlots,
      status: data.status,
      notes: data.notes,
      internalNotes: data.internalNotes,
      additionalNeeds: data.additionalNeeds,
      contractBody: data.contractBody || null,
      resource: {
        id: 'resource-1',
        name: 'Chariot iPad',
        totalUnits: 10,
        bundleSize: 5,
        isActive: true,
        equipments: []
      },
      selectedEquipments: [],
      contractSignatureRequest: null
    }));
    prisma.loanReservation.findUnique.mockResolvedValueOnce({
      id: 'reservation-2',
      resourceId: 'resource-1',
      contractSignatureRequestId: null,
      requesterName: 'Jean Dupont',
      requesterEmail: 'jean@example.com',
      requesterPhone: null,
      requesterOrganization: null,
      startAt: new Date('2026-04-02T08:00:00.000Z'),
      endAt: new Date('2026-04-02T10:00:00.000Z'),
      requestedUnits: 1,
      reservedSlots: 1,
      status: 'PENDING',
      notes: null,
      internalNotes: null,
      additionalNeeds: null,
      contractBody: null,
      approvedById: null,
      resource: {
        id: 'resource-1',
        name: 'Chariot iPad',
        totalUnits: 10,
        bundleSize: 5,
        isActive: true,
        equipments: []
      },
      selectedEquipments: [],
      contractSignatureRequest: null
    }).mockResolvedValueOnce({
      id: 'reservation-2',
      resourceId: 'resource-1',
      contractSignatureRequestId: null,
      requesterName: 'Jean Martin',
      requesterEmail: 'jean.martin@example.com',
      requesterPhone: '0102030405',
      requesterOrganization: 'Lycée Beaupeyrat',
      startAt: new Date('2026-04-03T09:00:00.000Z'),
      endAt: new Date('2026-04-03T11:00:00.000Z'),
      requestedUnits: 3,
      reservedSlots: 1,
      status: 'APPROVED',
      notes: null,
      internalNotes: 'Préparer les chargeurs',
      additionalNeeds: null,
      contractBody: null,
      resource: {
        id: 'resource-1',
        name: 'Chariot iPad',
        totalUnits: 10,
        bundleSize: 5,
        isActive: true,
        equipments: []
      },
      selectedEquipments: [],
      contractSignatureRequest: null
    });

    const res = await request(buildApp())
      .patch('/api/loans/reservations/reservation-2')
      .send({
        requesterName: 'Jean Martin',
        requesterEmail: 'jean.martin@example.com',
        requesterPhone: '0102030405',
        requesterOrganization: 'Lycée Beaupeyrat',
        startAt: '2026-04-03T09:00:00.000Z',
        endAt: '2026-04-03T11:00:00.000Z',
        requestedUnits: 3,
        status: 'APPROVED',
        internalNotes: 'Préparer les chargeurs',
        skipNotification: true
      });

    expect(res.status).toBe(200);
    expect(prisma.loanReservation.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'reservation-2' },
      data: expect.objectContaining({
        requesterName: 'Jean Martin',
        requesterEmail: 'jean.martin@example.com',
        requesterPhone: '0102030405',
        requesterOrganization: 'Lycée Beaupeyrat',
        requestedUnits: 3,
        reservedSlots: 1,
        status: 'APPROVED',
        internalNotes: 'Préparer les chargeurs'
      })
    }));
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('genere une fiche de pret a signer avec les appareils selectionnes', async () => {
    const sendMail = jest.fn().mockResolvedValue({});
    createSmtpTransporter.mockReturnValue({
      transporter: { sendMail },
      from: 'noreply@test.local',
      orgName: 'MaintenanceBoard'
    });

    prisma.loanReservation.findUnique.mockResolvedValue({
      id: 'reservation-3',
      resourceId: 'resource-1',
      contractSignatureRequestId: null,
      requesterName: 'Marie Martin',
      requesterEmail: 'marie@example.com',
      requesterPhone: null,
      requesterOrganization: 'Collège Demo',
      startAt: new Date('2026-04-10T08:00:00.000Z'),
      endAt: new Date('2026-04-10T12:00:00.000Z'),
      requestedUnits: 2,
      reservedSlots: 1,
      status: 'APPROVED',
      notes: null,
      internalNotes: null,
      additionalNeeds: null,
      contractBody: 'Texte personnalisé de contrat.',
      resource: {
        id: 'resource-1',
        name: 'Valise iPad',
        totalUnits: 10,
        bundleSize: 5,
        isActive: true,
        instructions: 'Rendre les chargeurs.',
        equipments: [
          { lotNumber: 1, equipment: { id: 'eq-1', name: 'iPad 1', serialNumber: 'SER-001', type: 'Tablette', brand: 'Apple', model: 'Air', status: 'ACTIVE' } }
        ]
      },
      selectedEquipments: [
        {
          id: 'sel-1',
          equipmentId: 'eq-1',
          equipmentName: 'iPad 1',
          equipmentType: 'Tablette',
          equipmentBrand: 'Apple',
          equipmentModel: 'Air',
          equipmentSerialNumber: 'SER-001',
          lotNumber: 1
        }
      ],
      contractSignatureRequest: null
    });

    prisma.signatureRequest.create.mockResolvedValue({
      id: 'sig-1',
      token: 'token-signature',
      recipientEmail: 'marie@example.com',
      recipientName: 'Marie Martin',
      status: 'PENDING'
    });
    prisma.signatureRequest.update.mockResolvedValue({});
    prisma.loanReservation.update.mockResolvedValue({});

    const res = await request(buildApp())
      .post('/api/loans/reservations/reservation-3/contract-signature')
      .send({});

    expect(res.status).toBe(201);
    expect(prisma.signatureRequest.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        documentTitle: expect.stringContaining('Valise iPad'),
        recipientEmail: 'marie@example.com',
        recipientName: 'Marie Martin'
      })
    }));
    expect(prisma.loanReservation.update).toHaveBeenCalledWith({
      where: { id: 'reservation-3' },
      data: expect.objectContaining({
        contractBody: 'Texte personnalisé de contrat.',
        contractSignatureRequestId: 'sig-1'
      })
    });
    expect(sendMail).toHaveBeenCalled();
  });
});

describe('free-form loans', () => {
  const resource = { id: 'free-loan', name: 'Libre', isActive: false, usesBundles: false, equipments: [] };
  const payload = {
    resourceId: 'free-loan', requesterName: 'Louis Ducreux', requesterEmail: 'louis@example.com',
    startAt: '2026-11-02T08:00:00Z', endAt: '2026-11-03T17:00:00Z', requestedUnits: 2,
    freeEquipments: [{ name: '  Adaptateur HDMI  ', serialNumber: 'AD-123' }, { name: 'Câble USB-C' }]
  };
  const existingLoan = (extra = {}) => ({
    id: 'free-1', ...payload, resource, status: 'APPROVED', reservedSlots: 0,
    selectedEquipments: [{ equipmentId: null, equipmentName: 'Adaptateur HDMI', equipmentSerialNumber: 'AD-123' }, { equipmentId: null, equipmentName: 'Câble USB-C' }],
    ...extra
  });
  beforeEach(() => {
    jest.resetAllMocks();
    prisma.loanResource.upsert.mockResolvedValue(resource);
    prisma.loanReservation.create.mockImplementation(async ({ data }) => ({ ...data, id: 'free-1', resource, selectedEquipments: data.selectedEquipments?.create || [] }));
  });
  it('stores unregistered items without stock conflicts, including overlapping free loans', async () => {
    for (let i = 0; i < 2; i++) {
      const res = await request(buildApp()).post('/api/loans/reservations').send(payload);
      expect(res.status).toBe(201);
      expect(res.body.reservations[0].selectedEquipments).toEqual([
        expect.objectContaining({ name: 'Adaptateur HDMI', serialNumber: 'AD-123', equipmentId: null }),
        expect.objectContaining({ name: 'Câble USB-C', equipmentId: null })
      ]);
    }
    expect(prisma.loanResource.create).not.toHaveBeenCalled();
    expect(prisma.loanReservation.findMany).not.toHaveBeenCalled();
    expect(prisma.loanReservation.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ reservedSlots: 0, requestedUnits: 2 }) }));
    expect(prisma.loanResource.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ isActive: false }) }));
  });
  it.each([undefined, [], [{ name: '   ' }], [{ name: 'a'.repeat(201) }], [{ name: 'Cable', serialNumber: 123 }]])('rejects missing or invalid descriptions before writing', async freeEquipments => {
    const res = await request(buildApp()).post('/api/loans/reservations').send({ ...payload, freeEquipments });
    expect(res.status).toBe(400);
    expect(prisma.loanResource.upsert).not.toHaveBeenCalled();
    expect(prisma.loanReservation.create).not.toHaveBeenCalled();
  });
  it('rejects free items on catalogue loans', async () => {
    const res = await request(buildApp()).post('/api/loans/reservations').send({ ...payload, resourceId: 'catalogue-item' });
    expect(res.status).toBe(400);
    expect(prisma.loanReservation.create).not.toHaveBeenCalled();
  });
  it('keeps the internal free resource out of the catalogue', async () => {
    prisma.loanResource.findMany.mockResolvedValue([resource, { id: 'normal', name: 'Tablette' }]);
    const res = await request(buildApp()).get('/api/loans/resources');
    expect(res.status).toBe(200);
    expect(res.body.map(item => item.id)).toEqual(['normal']);
  });
  it('edits descriptions and invalidates a pending contract', async () => {
    const loan = existingLoan({ contractSignatureRequestId: 'sig-free', contractSignatureRequest: { id: 'sig-free', status: 'PENDING' } });
    prisma.loanReservation.findUnique.mockResolvedValue(loan);
    prisma.loanReservation.update.mockResolvedValue(loan);
    const res = await request(buildApp()).patch('/api/loans/reservations/free-1').send({ freeEquipments: [{ name: 'Chargeur' }] });
    expect(res.status).toBe(200);
    expect(prisma.signatureRequest.update).toHaveBeenCalledWith({ where: { id: 'sig-free' }, data: { status: 'CANCELLED' } });
    expect(prisma.loanReservationEquipment.createMany).toHaveBeenCalledWith({ data: [{ loanReservationId: 'free-1', equipmentName: 'Chargeur', equipmentType: null, equipmentSerialNumber: null }] });
    expect(prisma.loanReservation.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ contractSignatureRequestId: null }) }));
  });
  it('protects descriptions on a signed contract', async () => {
    prisma.loanReservation.findUnique.mockResolvedValue(existingLoan({ contractSignatureRequestId: 'sig-free', contractSignatureRequest: { id: 'sig-free', status: 'SIGNED' } }));
    const res = await request(buildApp()).patch('/api/loans/reservations/free-1').send({ freeEquipments: [{ name: 'Chargeur' }] });
    expect(res.status).toBe(409);
    expect(prisma.loanReservation.update).not.toHaveBeenCalled();
    expect(prisma.loanReservationEquipment.deleteMany).not.toHaveBeenCalled();
  });
  it('allows returning a signed loan without changing its descriptions', async () => {
    const loan = existingLoan({ contractSignatureRequestId: 'sig-free', contractSignatureRequest: { id: 'sig-free', status: 'SIGNED' } });
    prisma.loanReservation.findUnique.mockResolvedValue(loan);
    prisma.loanReservation.update.mockResolvedValue({ ...loan, status: 'RETURNED' });
    const res = await request(buildApp()).patch('/api/loans/reservations/free-1').send({ status: 'RETURNED', skipNotification: true });
    expect(res.status).toBe(200);
    expect(prisma.loanReservationEquipment.deleteMany).not.toHaveBeenCalled();
    expect(prisma.loanResource.findUnique).not.toHaveBeenCalled();
  });
  it('allows date changes without stock checks', async () => {
    const loan = existingLoan();
    prisma.loanReservation.findUnique.mockResolvedValue(loan);
    prisma.loanReservation.update.mockResolvedValue(loan);
    const res = await request(buildApp()).patch('/api/loans/reservations/free-1').send({ endAt: '2026-11-05T17:00:00Z' });
    expect(res.status).toBe(200);
    expect(prisma.loanReservation.findMany).not.toHaveBeenCalled();
    expect(prisma.loanReservationEquipment.deleteMany).not.toHaveBeenCalled();
  });
  it('retains a signed contract when the same free items are saved from the form', async () => {
    const loan = existingLoan({ contractSignatureRequestId: 'sig-free', contractSignatureRequest: { id: 'sig-free', status: 'SIGNED' } });
    prisma.loanReservation.findUnique.mockResolvedValue(loan);
    prisma.loanReservation.update.mockResolvedValue(loan);
    const res = await request(buildApp()).patch('/api/loans/reservations/free-1').send({ ...payload, selectedEquipmentIds: [], skipNotification: true });
    expect(res.status).toBe(200);
    expect(prisma.signatureRequest.update).not.toHaveBeenCalled();
    expect(prisma.loanReservation.update.mock.calls[0][0].data).not.toHaveProperty('contractSignatureRequestId');
  });
  it('rejects removing every free item without deleting existing descriptions', async () => {
    prisma.loanReservation.findUnique.mockResolvedValue(existingLoan());
    const res = await request(buildApp()).patch('/api/loans/reservations/free-1').send({ freeEquipments: [] });
    expect(res.status).toBe(400);
    expect(prisma.loanReservationEquipment.deleteMany).not.toHaveBeenCalled();
  });
  it('does not allow the inactive free resource through public availability checks', async () => {
    const { ensureLoanAvailability } = require('../src/utils/loans');
    prisma.loanResource.findUnique.mockResolvedValue(resource);
    await expect(ensureLoanAvailability(prisma, payload)).rejects.toMatchObject({ status: 404 });
  });
  it('generates a valid contract PDF containing the free equipment and serial numbers', async () => {
    const fs = require('fs');
    const { getDocument } = require('pdfjs-dist/legacy/build/pdf.js');
    const sendMail = jest.fn().mockResolvedValue({});
    createSmtpTransporter.mockReturnValue({ transporter: { sendMail }, from: 'test@example.com' });
    prisma.loanReservation.findUnique.mockResolvedValue(existingLoan());
    prisma.signatureRequest.create.mockResolvedValue({ id: 'sig-free-pdf', token: 'free-sign-token', recipientEmail: payload.requesterEmail, recipientName: payload.requesterName, status: 'PENDING' });
    const mkdir = jest.spyOn(fs, 'mkdirSync').mockImplementation(() => undefined);
    const write = jest.spyOn(fs, 'writeFileSync').mockImplementation(() => undefined);
    try {
      const res = await request(buildApp()).post('/api/loans/reservations/free-1/contract-signature').send({});
      expect(res.status).toBe(201);
      const pdfBuffer = write.mock.calls.find(call => Buffer.isBuffer(call[1]))[1];
      const document = await getDocument({ data: new Uint8Array(pdfBuffer), disableFontFace: true }).promise;
      const texts = [];
      for (let page = 1; page <= document.numPages; page++) {
        const content = await (await document.getPage(page)).getTextContent();
        texts.push(...content.items.map(item => item.str));
      }
      const text = texts.join(' ');
      expect(text).toContain('Libre');
      expect(text).toContain('Adaptateur HDMI');
      expect(text).toContain('AD-123');
      expect(text).toContain('Câble USB-C');
      expect(sendMail).toHaveBeenCalled();
      await document.destroy();
    } finally {
      mkdir.mockRestore();
      write.mockRestore();
    }
  });

  it('keeps borrower email optional without substituting the administrator email', async () => {
    const res = await request(buildApp()).post('/api/loans/reservations').send({ ...payload, requesterEmail: '' });
    expect(res.status).toBe(201);
    expect(prisma.loanReservation.create.mock.calls[0][0].data.requesterEmail).toBe('');
  });
  it('stores the equipment type on the loan sheet', async () => {
    const res = await request(buildApp()).post('/api/loans/reservations').send({ ...payload, freeEquipments: [{ name: 'Dell Latitude', type: 'Ordinateur portable', serialNumber: 'ABC' }] });
    expect(res.status).toBe(201);
    expect(res.body.reservations[0].selectedEquipments[0]).toMatchObject({ name: 'Dell Latitude', type: 'Ordinateur portable', serialNumber: 'ABC' });
  });
  it('rejects non-administrator creation, edits, deletion and signature creation', async () => {
    prisma.loanReservation.findUnique.mockResolvedValue(existingLoan());
    const app = buildApp();
    expect((await request(app).post('/api/loans/reservations').set('x-user-role','TECH').send(payload)).status).toBe(403);
    expect((await request(app).patch('/api/loans/reservations/free-1').set('x-user-role','TECH').send({ status: 'RETURNED' })).status).toBe(403);
    expect((await request(app).delete('/api/loans/reservations/free-1').set('x-user-role','TECH')).status).toBe(403);
    expect((await request(app).post('/api/loans/reservations/free-1/contract-signature').set('x-user-role','TECH').send({ mode: 'LOAN_LINK' })).status).toBe(403);
    expect((await request(app).get('/api/loans/reservations/free-1/signature-link').set('x-user-role','TECH')).status).toBe(403);
    expect(prisma.loanReservation.update).not.toHaveBeenCalled();
    expect(prisma.signatureRequest.create).not.toHaveBeenCalled();
  });
  it('forbids free loans through a public link even if the resource was activated', async () => {
    prisma.loanResource.findUnique.mockResolvedValue({ ...resource, isActive: true });
    const res = await request(buildApp()).post('/api/loan-request/public-token/requests').send({ ...payload, accessToken: 'valid-public-access' });
    expect(res.status).toBe(403);
    expect(prisma.loanReservation.create).not.toHaveBeenCalled();
  });
  it('filters private loans from non-administrator reservations and the shared calendar feed', async () => {
    prisma.loanReservation.findMany.mockResolvedValue([]);
    const app = buildApp();
    expect((await request(app).get('/api/loans/reservations').set('x-user-role','USER')).status).toBe(200);
    expect(prisma.loanReservation.findMany.mock.calls[0][0].where.resourceId).toEqual({ not: 'free-loan' });
    expect((await request(app).get('/api/loans/calendar').set('x-user-role','USER')).status).toBe(200);
    expect(prisma.loanReservation.findMany.mock.calls[1][0].where.resourceId).toEqual({ not: 'free-loan' });
  });
  it('generates a one-use mobile link and QR code without SMTP', async () => {
    prisma.loanReservation.findUnique.mockResolvedValue(existingLoan({ requesterEmail: '' }));
    prisma.signatureRequest.create.mockImplementation(async ({ data }) => ({ id: 'mobile-sig', status: 'PENDING', ...data }));
    const mkdir = jest.spyOn(fs,'mkdirSync').mockImplementation(() => undefined);
    const write = jest.spyOn(fs,'writeFileSync').mockImplementation(() => undefined);
    try {
      const res = await request(buildApp()).post('/api/loans/reservations/free-1/contract-signature').send({ mode: 'LOAN_LINK' });
      expect(res.status).toBe(201);
      expect(res.body.signUrl).toMatch(/^https:\/\/maintenanceboard.test\/sign.html\?token=/);
      expect(res.body.qrCode).toMatch(/^data:image\/png;base64,/);
      expect(prisma.signatureRequest.create.mock.calls[0][0].data.verificationMethod).toBe('LOAN_LINK');
      expect(createSmtpTransporter).not.toHaveBeenCalled();
    } finally { mkdir.mockRestore(); write.mockRestore(); }
  });
  it('requires borrower email before generating an email signature request', async () => {
    prisma.loanReservation.findUnique.mockResolvedValue(existingLoan({ requesterEmail: '' }));
    const res = await request(buildApp()).post('/api/loans/reservations/free-1/contract-signature').send({});
    expect(res.status).toBe(400);
    expect(prisma.signatureRequest.create).not.toHaveBeenCalled();
  });
  it('sends an existing mobile link to the borrower with no OTP instructions', async () => {
    const sendMail = jest.fn().mockResolvedValue({});
    createSmtpTransporter.mockReturnValue({ transporter: { sendMail }, from: 'test@example.com' });
    prisma.loanReservation.findUnique.mockResolvedValue(existingLoan({ contractSignatureRequest: {
      id: 'mobile-sig', verificationMethod: 'LOAN_LINK', status: 'PENDING', token: 'unique-mobile-token',
      recipientEmail: payload.requesterEmail, recipientName: payload.requesterName, expiresAt: new Date(Date.now()+86400000)
    } }));
    const res = await request(buildApp()).post('/api/loans/reservations/free-1/signature-link/email').send({});
    expect(res.status).toBe(200);
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ to: payload.requesterEmail, html: expect.stringContaining('usage unique') }));
    expect(sendMail.mock.calls[0][0].html).not.toContain('code envoyé');
  });

  it('enforces administrator permissions for URL-encoded reservation IDs too', async () => {
    prisma.loanReservation.findUnique.mockResolvedValue(existingLoan());
    const res = await request(buildApp()).patch('/api/loans/reservations/%66ree-1').set('x-user-role','TECH').send({ status: 'RETURNED' });
    expect(res.status).toBe(403);
    expect(prisma.loanReservation.findUnique.mock.calls[0][0].where.id).toBe('free-1');
    expect(prisma.loanReservation.update).not.toHaveBeenCalled();
  });
  it('refuses editing a mobile loan when signing won the one-use claim', async () => {
    prisma.loanReservation.findUnique.mockResolvedValue(existingLoan({ contractSignatureRequestId: 'mobile-sig', contractSignatureRequest: { id:'mobile-sig', status:'PENDING', verificationMethod:'LOAN_LINK' } }));
    prisma.signatureRequest.updateMany.mockResolvedValue({ count:0 });
    const res = await request(buildApp()).patch('/api/loans/reservations/free-1').send({ freeEquipments:[{ name:'Another item' }] });
    expect(res.status).toBe(409);
    expect(prisma.loanReservation.update).not.toHaveBeenCalled();
    expect(prisma.loanReservationEquipment.deleteMany).not.toHaveBeenCalled();
  });
  it('cancels a mobile link when the loan is cancelled', async () => {
    const loan=existingLoan({ contractSignatureRequestId:'mobile-sig', contractSignatureRequest:{ id:'mobile-sig', status:'PENDING', verificationMethod:'LOAN_LINK' } });
    prisma.loanReservation.findUnique.mockResolvedValue(loan);
    prisma.loanReservation.update.mockResolvedValue(loan);
    prisma.signatureRequest.updateMany.mockResolvedValue({ count:1 });
    const res=await request(buildApp()).patch('/api/loans/reservations/free-1').send({ status:'CANCELLED', skipNotification:true });
    expect(res.status).toBe(200);
    expect(prisma.signatureRequest.updateMany).toHaveBeenCalledWith({ where:{ id:'mobile-sig', status:'PENDING' }, data:{ status:'CANCELLED' } });
  });

  it('never exposes a free-loan schedule through the public resources API', async () => {
    const app = buildApp();
    expect((await request(app).get('/api/loan-request/resources/free-loan/schedule')).status).toBe(404);
    expect((await request(app).get('/api/loan-request/resources/%66ree-loan/schedule')).status).toBe(404);
    expect(prisma.loanReservation.findMany).not.toHaveBeenCalled();
    expect(prisma.loanResource.findUnique).not.toHaveBeenCalled();
  });

  it.each([{ startAt:undefined, endAt:undefined }, { startAt:null, endAt:null }])('creates a free loan without a reservation period', async dates => {
    const res=await request(buildApp()).post('/api/loans/reservations').send({ ...payload, ...dates });
    expect(res.status).toBe(201);
    expect(prisma.loanReservation.create.mock.calls[0][0].data).toMatchObject({ startAt:null, endAt:null });
    expect(res.body.reservations[0]).toMatchObject({ startAt:null, endAt:null });
  });
  it('rejects partial periods and recurrence without dates', async () => {
    const app=buildApp();
    expect((await request(app).post('/api/loans/reservations').send({ ...payload, startAt:null })).status).toBe(400);
    expect((await request(app).post('/api/loans/reservations').send({ ...payload, startAt:null, endAt:null, recurrence:{ type:'daily', until:'2026-11-30' } })).status).toBe(400);
    expect(prisma.loanReservation.create).not.toHaveBeenCalled();
  });
  it('still requires dates for catalogue reservations', async () => {
    const { freeEquipments, ...catalogue }=payload;
    const res=await request(buildApp()).post('/api/loans/reservations').send({ ...catalogue, resourceId:'catalogue', startAt:null, endAt:null });
    expect(res.status).toBe(400);
    expect(prisma.loanReservation.create).not.toHaveBeenCalled();
  });
  it('can clear a free-loan period before its contract is signed', async () => {
    const loan=existingLoan();
    prisma.loanReservation.findUnique.mockResolvedValue(loan);
    prisma.loanReservation.update.mockResolvedValue({ ...loan, startAt:null, endAt:null });
    const res=await request(buildApp()).patch('/api/loans/reservations/free-1').send({ startAt:null, endAt:null });
    expect(res.status).toBe(200);
    expect(prisma.loanReservation.update.mock.calls[0][0].data).toMatchObject({ startAt:null, endAt:null });
  });
  it('keeps signed undated loans editable without changing the signed period', async () => {
    const loan=existingLoan({ startAt:null, endAt:null, contractSignatureRequestId:'signed', contractSignatureRequest:{ id:'signed', status:'SIGNED' } });
    prisma.loanReservation.findUnique.mockResolvedValue(loan);
    prisma.loanReservation.update.mockResolvedValue(loan);
    expect((await request(buildApp()).patch('/api/loans/reservations/free-1').send({ internalNotes:'Remis' })).status).toBe(200);
    expect(prisma.signatureRequest.update).not.toHaveBeenCalled();
  });
  it('includes undated and overdue active loans for staff to validate their returns', async () => {
    prisma.loanReservation.findMany.mockResolvedValue([]);
    const res=await request(buildApp()).get('/api/loans/reservations').set('x-user-role','TECH');
    expect(res.status).toBe(200);
    const where=prisma.loanReservation.findMany.mock.calls[0][0].where;
    expect(where).not.toHaveProperty('resourceId');
    expect(where.OR).toEqual(expect.arrayContaining([{ startAt:null, endAt:null }, expect.objectContaining({ status:{ in:['PENDING','APPROVED'] } })]));
  });
  it.each(['ADMIN','TECH'])('allows %s to approve a free-loan return and records the validator', async role => {
    let loan=existingLoan({ startAt:null, endAt:null, contractSignatureRequest:null });
    prisma.loanReservation.findUnique.mockImplementation(async () => loan);
    prisma.loanReservation.updateMany.mockImplementation(async ({ data }) => { loan={ ...loan, ...data }; return { count:1 }; });
    const res=await request(buildApp()).post('/api/loans/reservations/free-1/approve-return').set('x-user-role',role).send({ returnedById:'forged', returnedByName:'Forged' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status:'RETURNED', returnedById:'admin-1', returnedByName:'Admin' });
    expect(new Date(res.body.returnedAt).getTime()).toBeGreaterThan(0);
    expect(prisma.loanReservation.updateMany.mock.calls[0][0].where).toEqual({ id:'free-1', status:'APPROVED' });
  });
  it('forbids return approval by a requester or other role', async () => {
    prisma.loanReservation.findUnique.mockResolvedValue(existingLoan({ resourceId:'catalogue' }));
    const app=buildApp();
    expect((await request(app).post('/api/loans/reservations/free-1/approve-return').set('x-user-role','USER').send({})).status).toBe(403);
    expect((await request(app).patch('/api/loans/reservations/free-1').set('x-user-role','USER').send({ status:'RETURNED' })).status).toBe(403);
    expect(prisma.loanReservation.updateMany).not.toHaveBeenCalled();
    expect(prisma.loanReservation.update).not.toHaveBeenCalled();
  });
  it('does not overwrite the original return approval when the action is repeated', async () => {
    const returnedAt=new Date('2026-11-02T12:00:00Z');
    prisma.loanReservation.findUnique.mockResolvedValue(existingLoan({ status:'RETURNED', returnedAt, returnedById:'first-tech', returnedByName:'Premier technicien' }));
    const res=await request(buildApp()).post('/api/loans/reservations/free-1/approve-return').send({});
    expect(res.status).toBe(200);
    expect(res.body.returnedById).toBe('first-tech');
    expect(prisma.loanReservation.updateMany).not.toHaveBeenCalled();
  });
  it.each(['PENDING','CANCELLED','REJECTED'])('does not validate a return for a %s loan', async status => {
    prisma.loanReservation.findUnique.mockResolvedValue(existingLoan({ status }));
    expect((await request(buildApp()).post('/api/loans/reservations/free-1/approve-return').send({})).status).toBe(409);
    expect(prisma.loanReservation.updateMany).not.toHaveBeenCalled();
  });
  it('keeps an overdue loan active until return approval and shows undated periods correctly', () => {
    const vm=require('vm');
    const page=fs.readFileSync('public/loans.html','utf8');
    const archive=page.match(/function isArchivedReservation\(item\) \{[\s\S]*?\n\}/)[0];
    const period=page.match(/function formatReservationPeriod\(item\) \{[\s\S]*?\n\}/)[0];
    const context={ formatDateTime:value => String(value) };
    vm.runInNewContext(archive+';'+period+'; this.archive=isArchivedReservation; this.period=formatReservationPeriod;',context);
    expect(context.archive({ status:'APPROVED', endAt:'2020-01-01' })).toBe(false);
    expect(context.archive({ status:'APPROVED', endAt:null })).toBe(false);
    expect(context.archive({ status:'RETURNED', endAt:null })).toBe(true);
    expect(context.period({ startAt:null, endAt:null })).toBe('Sans période définie');
  });

  it('builds an undated contract without inventing dates or a return deadline', async () => {
    const { getDocument }=require('pdfjs-dist/legacy/build/pdf.js');
    prisma.loanReservation.findUnique.mockResolvedValue(existingLoan({ startAt:null, endAt:null, requesterEmail:'', contractBody:null }));
    prisma.signatureRequest.create.mockImplementation(async ({ data }) => ({ id:'undated-sign', status:'PENDING', ...data }));
    const mkdir=jest.spyOn(fs,'mkdirSync').mockImplementation(() => undefined);
    const write=jest.spyOn(fs,'writeFileSync').mockImplementation(() => undefined);
    try {
      const res=await request(buildApp()).post('/api/loans/reservations/free-1/contract-signature').send({ mode:'LOAN_LINK' });
      expect(res.status).toBe(201);
      const buffer=write.mock.calls.find(call => Buffer.isBuffer(call[1]))[1];
      const pdf=await getDocument({ data:new Uint8Array(buffer),disableFontFace:true }).promise;
      const text=[];
      for(let n=1;n<=pdf.numPages;n++)text.push(...(await (await pdf.getPage(n)).getTextContent()).items.map(item=>item.str));
      const content=text.join(' ').replace(/\s+/g,' ');
      expect(content).toContain('Sans période définie');
      expect(content).toContain('sans période prédéfinie');
      expect(content).not.toContain('1970');
      expect(content).not.toContain('à la date prévue');
      await pdf.destroy();
    } finally { mkdir.mockRestore(); write.mockRestore(); }
  });

});

describe('one-use mobile signature security', () => {
  let state, mobileSignature;
  const sharp = require('sharp');
  async function ink() {
    const pixels = Buffer.alloc(20*10*4);
    for (let x=0;x<10;x++) pixels[(x*20+x)*4+3] = 255;
    const png = await sharp(pixels, { raw: { width:20, height:10, channels:4 } }).png().toBuffer();
    return 'data:image/png;base64,' + png.toString('base64');
  }
  beforeEach(() => {
    jest.resetAllMocks();
    state = 'PENDING';
    mobileSignature = {
      id: 'mobile-sig', token: 'one-use-token', verificationMethod: 'LOAN_LINK', orderId: null,
      recipientName: 'Louis Ducreux', recipientEmail: '', documentTitle: 'Fiche de prêt Libre',
      sourceFileStoredAs: 'source.pdf', sourceFilename: 'fiche.pdf', sourceFileMimetype: 'application/pdf',
      expiresAt: new Date(Date.now()+86400000), loanReservationContracts: [{ id: 'free-1', status: 'APPROVED' }]
    };
    prisma.signatureRequest.findUnique.mockImplementation(async () => ({ ...mobileSignature, status: state }));
    prisma.signatureRequest.updateMany.mockImplementation(async ({ where, data }) => {
      if (where.status !== state) return { count: 0 };
      state = data.status; return { count: 1 };
    });
    prisma.signatureRequest.update.mockImplementation(async ({ data }) => { if(data.status) state = data.status; return { ...mobileSignature, ...data }; });
  });
  it('opens the mobile signature without an account or OTP and disables caching', async () => {
    const res = await request(buildApp()).get('/api/sign/one-use-token');
    expect(res.status).toBe(200);
    expect(res.body.requiresOtp).toBe(false);
    expect(res.headers['cache-control']).toBe('no-store');
  });
  it('keeps OTP mandatory for existing email requests regardless of the submitted mode', async () => {
    mobileSignature.verificationMethod = 'EMAIL_OTP';
    const res = await request(buildApp()).post('/api/sign/one-use-token/submit').send({ signatureData: await ink(), consent: true, mode: 'LOAN_LINK' });
    expect(res.status).toBe(400);
    expect(prisma.signatureRequest.updateMany).not.toHaveBeenCalled();
  });
  it('requires explicit acceptance before consuming the link', async () => {
    const res = await request(buildApp()).post('/api/sign/one-use-token/submit').send({ signatureData: await ink() });
    expect(res.status).toBe(400);
    expect(state).toBe('PENDING');
  });
  it('rejects invalid images and expired or detached links', async () => {
    const app = buildApp();
    expect((await request(app).post('/api/sign/one-use-token/submit').send({ signatureData: 'not-an-image', consent: true })).status).toBe(400);
    mobileSignature.expiresAt = new Date(Date.now()-1000);
    expect((await request(app).post('/api/sign/one-use-token/submit').send({ signatureData: await ink(), consent: true })).status).toBe(410);
    mobileSignature.expiresAt = new Date(Date.now()+86400000);
    mobileSignature.loanReservationContracts = [];
    expect((await request(app).post('/api/sign/one-use-token/submit').send({ signatureData: await ink(), consent: true })).status).toBe(403);
    expect(prisma.signatureRequest.updateMany).not.toHaveBeenCalled();
  });
  it('signs only once even with simultaneous submissions, embeds the signature and rejects replays', async () => {
    const { PDFDocument } = require('pdf-lib');
    const pdf = await PDFDocument.create(); pdf.addPage();
    const source = Buffer.from(await pdf.save());
    const originalRead = fs.readFileSync;
    const originalExists = fs.existsSync;
    const read = jest.spyOn(fs,'readFileSync').mockImplementation((file,...args) => String(file).endsWith('source.pdf') ? source : originalRead(file,...args));
    const exists = jest.spyOn(fs,'existsSync').mockImplementation(file => String(file).endsWith('source.pdf') || originalExists(file));
    const mkdir = jest.spyOn(fs,'mkdirSync').mockImplementation(() => undefined);
    const write = jest.spyOn(fs,'writeFileSync').mockImplementation(() => undefined);
    try {
      const app = buildApp();
      const payload = { signatureData: await ink(), consent: true };
      const results = await Promise.all([
        request(app).post('/api/sign/one-use-token/submit').send(payload),
        request(app).post('/api/sign/one-use-token/submit').send(payload)
      ]);
      expect(results.map(res => res.status).sort()).toEqual([200,409]);
      expect(state).toBe('SIGNED');
      const signed = write.mock.calls.find(call => Buffer.isBuffer(call[1]))[1];
      const signedPdf = await PDFDocument.load(signed);
      expect(signedPdf.getPageCount()).toBe(2);
      expect((await request(app).post('/api/sign/one-use-token/submit').send(payload)).status).toBe(409);
      expect((await request(app).get('/api/sign/one-use-token/source')).status).toBe(410);
    } finally { read.mockRestore(); exists.mockRestore(); mkdir.mockRestore(); write.mockRestore(); }
  });
  it('releases a failed signing attempt so the borrower can retry', async () => {
    const exists = jest.spyOn(fs,'existsSync').mockReturnValue(false);
    try {
      const res = await request(buildApp()).post('/api/sign/one-use-token/submit').send({ signatureData: await ink(), consent: true });
      expect(res.status).toBe(404);
      // The finally block releases only SIGNING; it cannot reset a SIGNED link.
      await Promise.resolve();
      expect(state).toBe('PENDING');
    } finally { exists.mockRestore(); }
  });
});
