const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');

const prisma = require('../lib/prisma');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

const ALLOWED_MESSAGE_MIMES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'application/pdf',
  'text/plain',
  'text/csv',
  'application/zip',
  'application/x-zip-compressed',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
];

const uploadStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    const dir = path.join(process.cwd(), 'uploads', 'internal-messages');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    cb(null, `${uuidv4()}${ext}`);
  }
});

const uploadAttachment = multer({
  storage: uploadStorage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    ALLOWED_MESSAGE_MIMES.includes(file.mimetype)
      ? cb(null, true)
      : cb(new Error('Type de fichier non autorisé.'));
  }
}).single('attachment');

const USER_SELECT = {
  id: true,
  name: true,
  email: true,
  role: true
};

function buildDirectKey(userId, recipientId) {
  return [String(userId), String(recipientId)].sort().join(':');
}

function serializeMessage(message, conversationId) {
  const attachmentUrl = message.attachmentPath
    ? `/api/messages/conversations/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(message.id)}/attachment`
    : null;

  return {
    ...message,
    attachmentUrl
  };
}

async function ensureConversationParticipant(conversationId, userId) {
  const participant = await prisma.internalConversationParticipant.findUnique({
    where: {
      conversationId_userId: {
        conversationId,
        userId
      }
    }
  });

  if (!participant) {
    const error = new Error('Conversation introuvable');
    error.status = 404;
    throw error;
  }

  return participant;
}

async function buildConversationSummary(conversation, currentUserId) {
  const participants = Array.isArray(conversation.participants) ? conversation.participants : [];
  const currentParticipant = participants.find(participant => participant.userId === currentUserId) || null;
  const otherParticipants = participants
    .filter(participant => participant.userId !== currentUserId)
    .map(participant => participant.user)
    .filter(Boolean);
  const isGroup = conversation.type === 'GROUP' || otherParticipants.length > 1;
  const otherParticipant = otherParticipants[0] || null;
  const lastMessage = Array.isArray(conversation.messages) ? conversation.messages[0] || null : null;

  const unreadCount = await prisma.internalMessage.count({
    where: {
      conversationId: conversation.id,
      senderId: { not: currentUserId },
      ...(currentParticipant?.lastReadAt ? { createdAt: { gt: currentParticipant.lastReadAt } } : {})
    }
  });

  return {
    id: conversation.id,
    type: conversation.type,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
    isGroup,
    displayName: isGroup
      ? (otherParticipants.map(user => user.name).join(', ') || 'Conversation de groupe')
      : (otherParticipant?.name || 'Conversation'),
    participants: otherParticipants,
    otherParticipant,
    unreadCount,
    lastReadAt: currentParticipant?.lastReadAt || null,
    archivedAt: currentParticipant?.archivedAt || null,
    lastMessage: lastMessage
      ? serializeMessage(lastMessage, conversation.id)
      : null
  };
}

async function listConversationSummaries(currentUserId, { archived = false } = {}) {
  const conversations = await prisma.internalConversation.findMany({
    where: {
      participants: {
        some: {
          userId: currentUserId,
          archivedAt: archived ? { not: null } : null
        }
      }
    },
    orderBy: { updatedAt: 'desc' },
    include: {
      participants: {
        include: { user: { select: USER_SELECT } }
      },
      messages: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        include: {
          sender: {
            select: { id: true, name: true, email: true }
          }
        }
      }
    }
  });

  return Promise.all(conversations.map(conversation => buildConversationSummary(conversation, currentUserId)));
}

router.get('/unread-count', requireAuth, async (req, res, next) => {
  try {
    const userId = req.user.id;

    // Compter les messages internes non lus (envoyés par d'autres)
    const participations = await prisma.internalConversationParticipant.findMany({
      where: { userId },
      select: { conversationId: true, lastReadAt: true }
    });

    let internalCount = 0;
    for (const p of participations) {
      const count = await prisma.internalMessage.count({
        where: {
          conversationId: p.conversationId,
          senderId: { not: userId },
          ...(p.lastReadAt ? { createdAt: { gt: p.lastReadAt } } : {})
        }
      });
      internalCount += count;
    }

    // Compter les messages REPORTER non lus (readAt = null) sur les interventions du tech
    const ticketCount = await prisma.ticketMessage.count({
      where: {
        authorType: 'REPORTER',
        readAt: null,
        intervention: {
          OR: [
            { techId: userId },
            { createdById: userId }
          ]
        }
      }
    });

    res.json({ internal: internalCount, tickets: ticketCount, total: internalCount + ticketCount });
  } catch (err) {
    next(err);
  }
});

router.get('/ticket-threads', requireAuth, async (req, res, next) => {
  try {
    const userId = req.user.id;

    const where = req.user.role === 'ADMIN'
      ? {}
      : { OR: [{ techId: userId }, { createdById: userId }] };

    const interventions = await prisma.intervention.findMany({
      where: {
        ...where,
        messages: { some: {} }
      },
      orderBy: { updatedAt: 'desc' },
      take: 50,
      select: {
        id: true,
        title: true,
        status: true,
        updatedAt: true,
        room: { select: { name: true } },
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { content: true, authorType: true, attachmentName: true, createdAt: true }
        },
        _count: {
          select: {
            messages: {
              where: { authorType: 'REPORTER', readAt: null }
            }
          }
        }
      }
    });

    const threads = interventions.map(intervention => ({
      id: intervention.id,
      title: intervention.title,
      status: intervention.status,
      updatedAt: intervention.updatedAt,
      roomName: intervention.room?.name || null,
      unreadCount: intervention._count.messages,
      lastMessage: intervention.messages[0] || null
    }));

    res.json(threads);
  } catch (err) {
    next(err);
  }
});

router.get('/users', requireAuth, async (req, res, next) => {
  try {
    const users = await prisma.user.findMany({
      where: {
        isActive: true,
        id: { not: req.user.id }
      },
      orderBy: { name: 'asc' },
      select: USER_SELECT
    });

    res.json(users);
  } catch (err) {
    next(err);
  }
});

router.get('/conversations', requireAuth, async (req, res, next) => {
  try {
    const archived = req.query.archived === 'true';
    res.json(await listConversationSummaries(req.user.id, { archived }));
  } catch (err) {
    next(err);
  }
});

router.post('/conversations', requireAuth, async (req, res, next) => {
  try {
    const rawRecipientIds = Array.isArray(req.body?.recipientIds)
      ? req.body.recipientIds
      : (req.body?.recipientId ? [req.body.recipientId] : []);
    const recipientIds = [...new Set(rawRecipientIds.map(value => String(value || '').trim()).filter(Boolean))];

    if (!recipientIds.length) {
      return res.status(400).json({ error: 'Destinataire requis' });
    }
    if (recipientIds.includes(req.user.id)) {
      return res.status(400).json({ error: 'Vous ne pouvez pas vous écrire à vous-même' });
    }

    const recipients = await prisma.user.findMany({
      where: {
        id: { in: recipientIds },
        isActive: true
      },
      select: { id: true }
    });

    if (recipients.length !== recipientIds.length) {
      return res.status(404).json({ error: 'Destinataire introuvable' });
    }

    let conversation;

    if (recipientIds.length === 1) {
      const directKey = buildDirectKey(req.user.id, recipientIds[0]);

      conversation = await prisma.internalConversation.upsert({
        where: { directKey },
        update: {},
        create: {
          type: 'DIRECT',
          directKey,
          participants: {
            create: [
              { userId: req.user.id },
              { userId: recipientIds[0] }
            ]
          }
        },
        include: {
          participants: {
            include: { user: { select: USER_SELECT } }
          },
          messages: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            include: {
              sender: {
                select: { id: true, name: true, email: true }
              }
            }
          }
        }
      });
    } else {
      conversation = await prisma.internalConversation.create({
        data: {
          type: 'GROUP',
          participants: {
            create: [
              { userId: req.user.id },
              ...recipientIds.map(userId => ({ userId }))
            ]
          }
        },
        include: {
          participants: {
            include: { user: { select: USER_SELECT } }
          },
          messages: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            include: {
              sender: {
                select: { id: true, name: true, email: true }
              }
            }
          }
        }
      });
    }

    res.status(201).json(await buildConversationSummary(conversation, req.user.id));
  } catch (err) {
    next(err);
  }
});

router.get('/conversations/:id/messages', requireAuth, async (req, res, next) => {
  try {
    const conversationId = req.params.id;

    await ensureConversationParticipant(conversationId, req.user.id);

    const messages = await prisma.internalMessage.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'asc' },
      include: {
        sender: {
          select: { id: true, name: true, email: true }
        }
      }
    });

    // Masquer le contenu des messages supprimés (soft delete)
    const visibleMessages = messages.map(msg => msg.deletedAt
      ? { ...msg, content: '', attachmentPath: null, attachmentName: null, attachmentMime: null, attachmentSize: null, deleted: true }
      : msg
    );

    await prisma.internalConversationParticipant.update({
      where: {
        conversationId_userId: {
          conversationId,
          userId: req.user.id
        }
      },
      data: { lastReadAt: new Date() }
    });

    res.json(visibleMessages.map(message => serializeMessage(message, conversationId)));
  } catch (err) {
    next(err);
  }
});

router.post('/conversations/:id/messages', requireAuth, (req, res, next) => {
  uploadAttachment(req, res, err => {
    if (err) return res.status(400).json({ error: err.message });
    next();
  });
}, async (req, res, next) => {
  const conversationId = req.params.id;
  const content = String(req.body?.content || '').trim();

  if (!content && !req.file) {
    return res.status(400).json({ error: 'Le message ou la pièce jointe est requis' });
  }

  try {
    await ensureConversationParticipant(conversationId, req.user.id);

    const message = await prisma.internalMessage.create({
      data: {
        conversationId,
        senderId: req.user.id,
        content,
        attachmentPath: req.file ? `internal-messages/${req.file.filename}` : null,
        attachmentName: req.file?.originalname || null,
        attachmentMime: req.file?.mimetype || null,
        attachmentSize: req.file?.size || null
      },
      include: {
        sender: {
          select: { id: true, name: true, email: true }
        }
      }
    });

    await prisma.internalConversation.update({
      where: { id: conversationId },
      data: { updatedAt: new Date() }
    });

    res.status(201).json(serializeMessage(message, conversationId));
  } catch (err) {
    if (req.file?.path && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    next(err);
  }
});

router.patch('/conversations/:id/archive', requireAuth, async (req, res, next) => {
  try {
    const participant = await ensureConversationParticipant(req.params.id, req.user.id);
    const updated = await prisma.internalConversationParticipant.update({
      where: {
        conversationId_userId: {
          conversationId: req.params.id,
          userId: req.user.id
        }
      },
      data: { archivedAt: participant.archivedAt ? null : new Date() }
    });
    res.json({ archived: !!updated.archivedAt });
  } catch (err) {
    next(err);
  }
});

router.delete('/conversations/:id', requireAuth, async (req, res, next) => {
  try {
    await ensureConversationParticipant(req.params.id, req.user.id);

    // Récupérer les pièces jointes pour les supprimer du disque
    const messages = await prisma.internalMessage.findMany({
      where: { conversationId: req.params.id, attachmentPath: { not: null } },
      select: { attachmentPath: true }
    });

    await prisma.internalConversation.delete({ where: { id: req.params.id } });

    for (const msg of messages) {
      if (msg.attachmentPath) {
        const filePath = path.join(process.cwd(), 'uploads', msg.attachmentPath);
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      }
    }

    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

router.delete('/conversations/:id/messages/:messageId', requireAuth, async (req, res, next) => {
  try {
    await ensureConversationParticipant(req.params.id, req.user.id);

    const message = await prisma.internalMessage.findUnique({
      where: { id: req.params.messageId }
    });

    if (!message || message.conversationId !== req.params.id) {
      return res.status(404).json({ error: 'Message introuvable' });
    }

    if (message.senderId !== req.user.id && req.user.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Vous ne pouvez supprimer que vos propres messages' });
    }

    await prisma.internalMessage.update({
      where: { id: req.params.messageId },
      data: { deletedAt: new Date() }
    });

    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

router.get('/conversations/:id/messages/:messageId/attachment', requireAuth, async (req, res, next) => {
  try {
    const { id: conversationId, messageId } = req.params;

    await ensureConversationParticipant(conversationId, req.user.id);

    const message = await prisma.internalMessage.findUnique({
      where: { id: messageId }
    });

    if (!message || message.conversationId !== conversationId || !message.attachmentPath) {
      return res.status(404).json({ error: 'Pièce jointe introuvable' });
    }

    const filePath = path.join(process.cwd(), 'uploads', message.attachmentPath);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Fichier introuvable' });
    }

    res.download(filePath, message.attachmentName || path.basename(filePath));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
