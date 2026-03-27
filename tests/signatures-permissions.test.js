const request = require('supertest');

jest.mock('../src/middleware/auth', () => ({
  requireAuth: (req, _res, next) => {
    req.user = {
      id: req.headers['x-user-id'] || 'u-default',
      role: req.headers['x-user-role'] || 'TECH',
      name: 'Test User',
      email: 'test@example.com',
      isActive: true
    };
    next();
  },
  optionalAuth: (_req, _res, next) => next()
}));

jest.mock('../src/lib/prisma', () => ({
  signatureRequest: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn()
  },
  order: {
    findUnique: jest.fn(),
    findMany: jest.fn()
  },
  orderAttachment: {
    findUnique: jest.fn()
  },
  user: {
    findUnique: jest.fn()
  }
}));

jest.mock('@prisma/client', () => {
  const mockPrisma = {
    user: { findUnique: jest.fn() }
  };
  return { PrismaClient: jest.fn(() => mockPrisma) };
});

const app = require('../src/app');
const prisma = require('../src/lib/prisma');

describe('order signature request permissions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('masque l’email des demandes d’autres utilisateurs non admin', async () => {
    prisma.signatureRequest.findMany.mockResolvedValue([
      {
        id: 'sig-1',
        orderId: 'order-1',
        recipientEmail: 'owner@example.com',
        recipientName: 'Owner',
        status: 'PENDING',
        signatureId: null,
        signedAt: null,
        expiresAt: new Date(),
        message: null,
        createdAt: new Date(),
        attachmentId: null,
        createdBy: 'u-owner'
      }
    ]);

    const res = await request(app)
      .get('/api/orders/order-1/signature-requests')
      .set('x-user-id', 'u-other')
      .set('x-user-role', 'TECH');

    expect(res.status).toBe(200);
    expect(res.body[0].recipientEmail).toBe('ow***@example.com');
    expect(res.body[0].canManage).toBe(false);
  });

  it('refuse l’annulation d’une demande créée par un autre utilisateur non admin', async () => {
    prisma.signatureRequest.findUnique.mockResolvedValue({
      id: 'sig-1',
      orderId: 'order-1',
      status: 'PENDING',
      createdBy: 'u-owner'
    });

    const res = await request(app)
      .delete('/api/orders/order-1/signature-requests/sig-1')
      .set('x-user-id', 'u-other')
      .set('x-user-role', 'TECH');

    expect(res.status).toBe(403);
    expect(prisma.signatureRequest.update).not.toHaveBeenCalled();
  });

  it('autorise un admin à modifier une demande créée par un autre utilisateur', async () => {
    prisma.signatureRequest.findUnique.mockResolvedValue({
      id: 'sig-1',
      orderId: 'order-1',
      status: 'PENDING',
      createdBy: 'u-owner',
      recipientEmail: 'old@example.com',
      recipientName: 'Old Name',
      message: null
    });
    prisma.signatureRequest.update.mockResolvedValue({
      id: 'sig-1',
      orderId: 'order-1',
      status: 'PENDING',
      createdBy: 'u-owner',
      recipientEmail: 'new@example.com',
      recipientName: 'New Name',
      message: 'Updated'
    });

    const res = await request(app)
      .patch('/api/orders/order-1/signature-requests/sig-1')
      .set('x-user-id', 'u-admin')
      .set('x-user-role', 'ADMIN')
      .send({
        recipientEmail: 'new@example.com',
        recipientName: 'New Name',
        message: 'Updated'
      });

    expect(res.status).toBe(200);
    expect(res.body.recipientEmail).toBe('new@example.com');
    expect(res.body.canManage).toBe(true);
    expect(prisma.signatureRequest.update).toHaveBeenCalledWith({
      where: { id: 'sig-1' },
      data: {
        recipientEmail: 'new@example.com',
        recipientName: 'New Name',
        message: 'Updated'
      }
    });
  });
});
