const express = require('express');
const request = require('supertest');
const { createSmtpTransporter } = require('../src/utils/mail');

jest.mock('../src/middleware/auth', () => ({
  requireAuth: (req, _res, next) => {
    req.user = { id: 'admin-1', role: 'ADMIN', name: 'Admin', email: 'admin@test.com', isActive: true };
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
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn()
  },
  loanRequestAccessLink: {
    create: jest.fn(),
    findUnique: jest.fn()
  },
  loanReservation: {
    findMany: jest.fn(),
    create: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    delete: jest.fn()
  },
  signatureRequest: {
    create: jest.fn(),
    update: jest.fn()
  }
}));

const prisma = require('../src/lib/prisma');
const { loansRouter, loanPublicRouter } = require('../src/routes/loans');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/loans', loansRouter);
  app.use('/api/loan-request', loanPublicRouter);
  app.use((err, _req, res, _next) => {
    res.status(err.status || 500).json({ error: err.message });
  });
  return app;
}

describe('loan requests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
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
