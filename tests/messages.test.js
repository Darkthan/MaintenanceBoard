const express = require('express');
const request = require('supertest');
const fs = require('fs');
const path = require('path');

jest.mock('../src/middleware/auth', () => ({
  requireAuth: (req, _res, next) => {
    req.user = {
      id: 'user-1',
      role: 'TECH',
      name: 'Alice Martin',
      email: 'alice@test.local',
      isActive: true
    };
    next();
  }
}));

jest.mock('../src/lib/prisma', () => ({
  user: {
    findMany: jest.fn(),
    findUnique: jest.fn()
  },
  internalConversation: {
    findMany: jest.fn(),
    upsert: jest.fn(),
    update: jest.fn()
  },
  internalConversationParticipant: {
    findUnique: jest.fn(),
    update: jest.fn()
  },
  internalMessage: {
    count: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    findUnique: jest.fn()
  }
}));

const prisma = require('../src/lib/prisma');
const messagesRouter = require('../src/routes/messages');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/messages', messagesRouter);
  app.use((err, _req, res, _next) => {
    res.status(err.status || 500).json({ error: err.message });
  });
  return app;
}

describe('internal messages routes', () => {
  afterEach(() => {
    jest.clearAllMocks();
    fs.rmSync(path.join(process.cwd(), 'uploads', 'internal-messages'), { recursive: true, force: true });
  });

  it('liste les utilisateurs actifs sauf l’utilisateur courant', async () => {
    prisma.user.findMany.mockResolvedValue([
      { id: 'user-2', name: 'Bob Durand', email: 'bob@test.local', role: 'ADMIN' }
    ]);

    const res = await request(buildApp()).get('/api/messages/users');

    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      { id: 'user-2', name: 'Bob Durand', email: 'bob@test.local', role: 'ADMIN' }
    ]);
    expect(prisma.user.findMany).toHaveBeenCalledWith({
      where: {
        isActive: true,
        id: { not: 'user-1' }
      },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        email: true,
        role: true
      }
    });
  });

  it('ouvre une conversation directe entre deux utilisateurs', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'user-2', isActive: true });
    prisma.internalConversation.upsert.mockResolvedValue({
      id: 'conv-1',
      type: 'DIRECT',
      createdAt: new Date('2026-03-27T09:00:00.000Z'),
      updatedAt: new Date('2026-03-27T09:00:00.000Z'),
      participants: [
        { userId: 'user-1', lastReadAt: null, user: { id: 'user-1', name: 'Alice Martin', email: 'alice@test.local', role: 'TECH' } },
        { userId: 'user-2', lastReadAt: null, user: { id: 'user-2', name: 'Bob Durand', email: 'bob@test.local', role: 'ADMIN' } }
      ],
      messages: []
    });
    prisma.internalMessage.count.mockResolvedValue(0);

    const res = await request(buildApp())
      .post('/api/messages/conversations')
      .send({ recipientId: 'user-2' });

    expect(res.status).toBe(201);
    expect(res.body).toEqual(expect.objectContaining({
      id: 'conv-1',
      unreadCount: 0,
      otherParticipant: expect.objectContaining({ id: 'user-2', name: 'Bob Durand' })
    }));
    expect(prisma.internalConversation.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { directKey: 'user-1:user-2' },
      create: expect.objectContaining({
        participants: {
          create: [
            { userId: 'user-1' },
            { userId: 'user-2' }
          ]
        }
      })
    }));
  });

  it('liste les conversations avec le compteur de non lus', async () => {
    prisma.internalConversation.findMany.mockResolvedValue([
      {
        id: 'conv-1',
        type: 'DIRECT',
        createdAt: new Date('2026-03-27T09:00:00.000Z'),
        updatedAt: new Date('2026-03-27T10:00:00.000Z'),
        participants: [
          { userId: 'user-1', lastReadAt: null, user: { id: 'user-1', name: 'Alice Martin', email: 'alice@test.local', role: 'TECH' } },
          { userId: 'user-2', lastReadAt: new Date('2026-03-27T09:30:00.000Z'), user: { id: 'user-2', name: 'Bob Durand', email: 'bob@test.local', role: 'ADMIN' } }
        ],
        messages: [
          {
            id: 'msg-1',
            conversationId: 'conv-1',
            senderId: 'user-2',
            content: 'Bonjour',
            attachmentPath: null,
            attachmentName: null,
            attachmentMime: null,
            attachmentSize: null,
            createdAt: new Date('2026-03-27T10:00:00.000Z'),
            sender: { id: 'user-2', name: 'Bob Durand', email: 'bob@test.local' }
          }
        ]
      }
    ]);
    prisma.internalMessage.count.mockResolvedValueOnce(2);

    const res = await request(buildApp()).get('/api/messages/conversations');

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toEqual(expect.objectContaining({
      id: 'conv-1',
      unreadCount: 2,
      lastMessage: expect.objectContaining({
        id: 'msg-1',
        attachmentUrl: null
      })
    }));
  });

  it('retourne les messages d’une conversation et la marque comme lue', async () => {
    prisma.internalConversationParticipant.findUnique.mockResolvedValue({
      conversationId: 'conv-1',
      userId: 'user-1'
    });
    prisma.internalMessage.findMany.mockResolvedValue([
      {
        id: 'msg-1',
        conversationId: 'conv-1',
        senderId: 'user-2',
        content: 'Bonjour Alice',
        attachmentPath: null,
        attachmentName: null,
        attachmentMime: null,
        attachmentSize: null,
        createdAt: new Date('2026-03-27T10:00:00.000Z'),
        sender: { id: 'user-2', name: 'Bob Durand', email: 'bob@test.local' }
      }
    ]);
    prisma.internalConversationParticipant.update.mockResolvedValue({});

    const res = await request(buildApp()).get('/api/messages/conversations/conv-1/messages');

    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      expect.objectContaining({
        id: 'msg-1',
        content: 'Bonjour Alice',
        attachmentUrl: null
      })
    ]);
    expect(prisma.internalConversationParticipant.update).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        conversationId_userId: {
          conversationId: 'conv-1',
          userId: 'user-1'
        }
      }
    }));
  });

  it('envoie un message avec une pièce jointe', async () => {
    prisma.internalConversationParticipant.findUnique.mockResolvedValue({
      conversationId: 'conv-1',
      userId: 'user-1'
    });
    prisma.internalMessage.create.mockImplementation(async ({ data }) => ({
      id: 'msg-1',
      createdAt: new Date('2026-03-27T11:00:00.000Z'),
      sender: { id: 'user-1', name: 'Alice Martin', email: 'alice@test.local' },
      ...data
    }));
    prisma.internalConversation.update.mockResolvedValue({});

    const res = await request(buildApp())
      .post('/api/messages/conversations/conv-1/messages')
      .field('content', 'Voici la pièce jointe')
      .attach('attachment', Buffer.from('hello world'), 'note.txt');

    expect(res.status).toBe(201);
    expect(res.body).toEqual(expect.objectContaining({
      id: 'msg-1',
      content: 'Voici la pièce jointe',
      attachmentUrl: '/api/messages/conversations/conv-1/messages/msg-1/attachment'
    }));
    expect(prisma.internalMessage.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        conversationId: 'conv-1',
        senderId: 'user-1',
        attachmentName: 'note.txt',
        attachmentMime: 'text/plain',
        attachmentSize: 11,
        attachmentPath: expect.stringMatching(/^internal-messages\//)
      })
    }));
  });

  it('télécharge une pièce jointe pour un participant de la conversation', async () => {
    const uploadDir = path.join(process.cwd(), 'uploads', 'internal-messages');
    const filePath = path.join(uploadDir, 'message-file.txt');
    fs.mkdirSync(uploadDir, { recursive: true });
    fs.writeFileSync(filePath, 'contenu');

    prisma.internalConversationParticipant.findUnique.mockResolvedValue({
      conversationId: 'conv-1',
      userId: 'user-1'
    });
    prisma.internalMessage.findUnique.mockResolvedValue({
      id: 'msg-1',
      conversationId: 'conv-1',
      attachmentPath: 'internal-messages/message-file.txt',
      attachmentName: 'message.txt'
    });

    const res = await request(buildApp())
      .get('/api/messages/conversations/conv-1/messages/msg-1/attachment');

    expect(res.status).toBe(200);
    expect(res.header['content-disposition']).toMatch(/message\.txt/);
  });
});
