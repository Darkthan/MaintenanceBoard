const fs = require('fs');
const path = require('path');
const request = require('supertest');

jest.mock('../src/middleware/auth', () => ({
  requireAuth: (req, _res, next) => {
    req.user = { id: 'u1', role: 'ADMIN', name: 'Admin', email: 'a@test.com', isActive: true };
    next();
  },
  optionalAuth: (_req, _res, next) => next()
}));

jest.mock('../src/lib/prisma', () => ({
  room: { findMany: jest.fn() },
  equipment: { findMany: jest.fn() },
  intervention: { findMany: jest.fn() },
  order: { findMany: jest.fn() },
  orderAttachment: { findMany: jest.fn() },
  signatureRequest: { findMany: jest.fn() },
  supplier: { findMany: jest.fn() },
  stockItem: { findMany: jest.fn() },
  internalConversation: { findMany: jest.fn() },
  loanResource: { findMany: jest.fn() },
  loanReservation: { findMany: jest.fn() },
  stockMovement: { findMany: jest.fn() },
  user: { findUnique: jest.fn(), findMany: jest.fn() }
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

function setupEmptyMocks() {
  prisma.room.findMany.mockResolvedValue([]);
  prisma.equipment.findMany.mockResolvedValue([]);
  prisma.intervention.findMany.mockResolvedValue([]);
  prisma.order.findMany.mockResolvedValue([]);
  prisma.orderAttachment.findMany.mockResolvedValue([]);
  prisma.signatureRequest.findMany.mockResolvedValue([]);
  prisma.supplier.findMany.mockResolvedValue([]);
  prisma.stockItem.findMany.mockResolvedValue([]);
  prisma.internalConversation.findMany.mockResolvedValue([]);
  prisma.loanResource.findMany.mockResolvedValue([]);
  prisma.loanReservation.findMany.mockResolvedValue([]);
  prisma.user.findMany.mockResolvedValue([]);
}

describe('GET /api/search', () => {
  const tempDir = path.join(process.cwd(), 'tests', '.tmp');
  const knowledgeBaseFile = path.join(tempDir, 'knowledge-base.search.test.json');

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.KNOWLEDGE_BASE_FILE = knowledgeBaseFile;
    fs.mkdirSync(tempDir, { recursive: true });
    fs.rmSync(knowledgeBaseFile, { force: true });
    setupEmptyMocks();
  });

  afterEach(() => {
    fs.rmSync(knowledgeBaseFile, { force: true });
    delete process.env.KNOWLEDGE_BASE_FILE;
  });

  it('retourne 200 avec résultats groupés pour une requête valide', async () => {
    prisma.room.findMany.mockResolvedValue([
      {
        id: 'room-1',
        name: 'Salle Informatique',
        number: '101',
        building: 'Bâtiment A',
        floor: 1,
        description: 'Salle principale',
        _count: { equipment: 5, interventions: 2 }
      }
    ]);

    const res = await request(app).get('/api/search?q=informatique');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('results');
    expect(Array.isArray(res.body.results)).toBe(true);
  });

  it('retourne 200 avec results tableau pour une requête courte', async () => {
    const res = await request(app).get('/api/search?q=ab');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('results');
    expect(Array.isArray(res.body.results)).toBe(true);
  });

  it('retourne 200 avec actions rapides si query manquante', async () => {
    const res = await request(app).get('/api/search');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('results');
    expect(Array.isArray(res.body.results)).toBe(true);
  });

  it('propose le nouvel espace d impression QR dans les actions rapides', async () => {
    const res = await request(app).get('/api/search?q=qr');
    expect(res.status).toBe(200);
    expect(res.body.results.some(r => r.type === 'action' && r.href === '/qr-print.html')).toBe(true);
  });

  it('propose la documentation interne dans les actions rapides', async () => {
    const res = await request(app).get('/api/search?q=documentation');
    expect(res.status).toBe(200);
    expect(res.body.results.some(r => r.type === 'action' && r.href === '/knowledge-base.html')).toBe(true);
  });

  it('retourne les résultats groupés avec les bons types', async () => {
    prisma.room.findMany.mockResolvedValue([
      {
        id: 'room-2',
        name: 'Salle de réunion',
        number: '202',
        building: 'Bâtiment B',
        floor: 2,
        description: null,
        _count: { equipment: 2, interventions: 0 }
      }
    ]);
    prisma.order.findMany.mockResolvedValue([
      {
        id: 'ord-1',
        title: 'Commande fournitures',
        description: null,
        status: 'PENDING',
        supplier: 'Dell',
        deploymentTags: '[]',
        createdAt: new Date(),
        requester: { id: 'u1', name: 'Admin' },
        _count: { items: 3 }
      }
    ]);

    const res = await request(app).get('/api/search?q=salle');
    expect(res.status).toBe(200);
    expect(res.body.results.some(r => r.type === 'room')).toBe(true);
  });

  it('retrouve une salle meme si la requete ne contient pas les accents', async () => {
    prisma.room.findMany.mockResolvedValue([
      {
        id: 'room-3',
        name: 'Salle Étude',
        number: '303',
        building: 'Bâtiment C',
        floor: 3,
        description: 'Salle dédiée aux révisions',
        _count: { equipment: 1, interventions: 0 }
      }
    ]);

    const res = await request(app).get('/api/search?q=etude');
    expect(res.status).toBe(200);
    expect(res.body.results.some(r => r.type === 'room' && r.title === 'Salle Étude')).toBe(true);
  });

  it('retrouve une conversation interne a partir du participant ou du contenu', async () => {
    prisma.internalConversation.findMany.mockResolvedValue([
      {
        id: 'conv-1',
        type: 'DIRECT',
        updatedAt: new Date('2026-03-29T10:00:00Z'),
        participants: [
          { userId: 'u1', user: { id: 'u1', name: 'Admin', email: 'a@test.com', role: 'ADMIN' } },
          { userId: 'u2', user: { id: 'u2', name: 'Sophie Martin', email: 'sophie@test.com', role: 'TECH' } }
        ],
        messages: [
          {
            id: 'msg-1',
            content: 'Peux-tu preparer les tablettes pour demain ?',
            attachmentName: null,
            createdAt: new Date('2026-03-29T09:00:00Z'),
            sender: { id: 'u2', name: 'Sophie Martin', email: 'sophie@test.com' }
          }
        ]
      }
    ]);

    const res = await request(app).get('/api/search?q=tablettes');
    expect(res.status).toBe(200);
    expect(res.body.results.some(r => r.type === 'message' && r.href === '/messages-thread.html?conversation=conv-1')).toBe(true);
  });

  it('retrouve un poste a partir de son adresse IP agent', async () => {
    prisma.equipment.findMany.mockResolvedValue([
      {
        id: 'eq-42',
        name: 'PC CDI 01',
        type: 'Ordinateur',
        brand: 'Dell',
        model: 'OptiPlex',
        serialNumber: 'SN-42',
        agentHostname: 'pc-cdi-01',
        agentInfo: JSON.stringify({ ips: ['10.42.0.15', '192.168.1.20'] }),
        status: 'ACTIVE',
        room: { id: 'room-1', name: 'CDI', number: '12' },
        _count: { interventions: 0 }
      }
    ]);

    const res = await request(app).get('/api/search?q=10.42.0.15');
    expect(res.status).toBe(200);
    expect(res.body.results.some(r => r.type === 'equipment' && r.id === 'equipment:eq-42')).toBe(true);
  });

  it('retrouve les ressources et reservations de pret', async () => {
    prisma.loanResource.findMany.mockResolvedValue([
      {
        id: 'loan-r1',
        name: 'Lot de tablettes iPad',
        category: 'Tablettes',
        description: '12 iPad avec coques',
        location: 'Armoire mobile',
        instructions: 'Charger avant remise',
        totalUnits: 12,
        bundleSize: 6,
        isActive: true,
        equipment: { id: 'eq-1', name: 'Chariot iPad', type: 'Mobilite' },
        _count: { reservations: 3 }
      }
    ]);
    prisma.loanReservation.findMany.mockResolvedValue([
      {
        id: 'loan-res-1',
        status: 'APPROVED',
        requesterName: 'College Beaupeyrat',
        requesterEmail: 'contact@beaupeyrat.test',
        requesterPhone: null,
        requesterOrganization: 'College Beaupeyrat',
        startAt: new Date('2026-04-02T08:00:00Z'),
        endAt: new Date('2026-04-04T16:00:00Z'),
        requestedUnits: 6,
        additionalNeeds: 'Applications pedagogiques',
        notes: null,
        internalNotes: null,
        createdBy: { id: 'u1', name: 'Admin' },
        approvedBy: { id: 'u1', name: 'Admin' },
        resource: { id: 'loan-r1', name: 'Lot de tablettes iPad', category: 'Tablettes', location: 'Armoire mobile' }
      }
    ]);

    const res = await request(app).get('/api/search?q=tablettes');
    expect(res.status).toBe(200);
    expect(res.body.results.some(r => r.type === 'loan' && r.id === 'loan-resource:loan-r1')).toBe(true);
    expect(res.body.results.some(r => r.type === 'loan' && r.id === 'loan-reservation:loan-res-1')).toBe(true);
  });

  it('retrouve un article de base de connaissance', async () => {
    fs.writeFileSync(knowledgeBaseFile, JSON.stringify({
      articles: [
        {
          id: 'kb-1',
          slug: 'vpn-enseignant',
          title: 'VPN enseignant',
          summary: 'Acces distant au reseau interne',
          category: 'Reseau',
          tags: ['vpn', 'distance'],
          content: 'Le portail VPN est accessible via le navigateur.',
          createdAt: '2026-03-31T08:00:00.000Z',
          updatedAt: '2026-03-31T08:00:00.000Z',
          createdByName: 'Admin',
          updatedByName: 'Admin'
        }
      ]
    }, null, 2));

    const res = await request(app).get('/api/search?q=vpn');
    expect(res.status).toBe(200);
    expect(res.body.results.some(r => r.type === 'knowledge' && r.href === '/knowledge-base.html?article=kb-1')).toBe(true);
  });
});
