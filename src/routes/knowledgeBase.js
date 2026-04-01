const express = require('express');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const multer = require('multer');
const sharp = require('sharp');
const { randomUUID } = require('crypto');

const { requireAuth } = require('../middleware/auth');
const {
  addKnowledgeBaseAttachment,
  createKnowledgeBaseArticle,
  getKnowledgeBaseArticle,
  getKnowledgeBaseArticleUploadDir,
  listKnowledgeBaseArticles,
  normalizeText,
  removeKnowledgeBaseAttachment,
  removeKnowledgeBaseArticle,
  replaceKnowledgeBaseArticle,
  saveKnowledgeBaseArticle,
  stripMarkdown,
  updateKnowledgeBaseArticle
} = require('../utils/knowledgeBase');

const router = express.Router();

const ALLOWED_IMAGE_MIMES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp'
];

const ALLOWED_DOCUMENT_MIMES = [
  'application/pdf',
  'text/plain',
  'text/markdown',
  'text/csv',
  'application/zip',
  'application/x-zip-compressed',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation'
];

const uploadKnowledgeAttachment = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const allowedDocumentExts = ['.pdf', '.txt', '.md', '.csv', '.zip', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx'];
    if (
      ALLOWED_IMAGE_MIMES.includes(file.mimetype)
      || ALLOWED_DOCUMENT_MIMES.includes(file.mimetype)
      || allowedDocumentExts.includes(ext)
    ) {
      return cb(null, true);
    }
    cb(new Error('Type de fichier non autorise.'));
  }
}).single('file');

function ensureAdmin(req, res, next) {
  if (req.user?.role !== 'ADMIN') {
    return res.status(403).json({ error: 'Acces refuse' });
  }
  next();
}

function sanitizeFilename(value) {
  return String(value || '')
    .replace(/[/\\:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180) || 'fichier';
}

function toKnowledgeAttachmentUrl(articleId, attachmentId) {
  return `/api/knowledge-base/${encodeURIComponent(articleId)}/attachments/${encodeURIComponent(attachmentId)}`;
}

function serializeKnowledgeAttachment(articleId, attachment) {
  return {
    id: attachment.id,
    name: attachment.name,
    mime: attachment.mime,
    size: attachment.size,
    kind: attachment.kind || (String(attachment.mime || '').startsWith('image/') ? 'image' : 'file'),
    uploadedAt: attachment.uploadedAt || '',
    uploadedByName: attachment.uploadedByName || '',
    width: attachment.width ?? null,
    height: attachment.height ?? null,
    url: toKnowledgeAttachmentUrl(articleId, attachment.id)
  };
}

function serializeKnowledgeArticle(article, { full = false } = {}) {
  const isNetworkDiagram = article.type === 'network-diagram';
  const plainContent = isNetworkDiagram ? '' : stripMarkdown(article.content);
  const attachments = Array.isArray(article.attachments) ? article.attachments : [];

  return {
    id: article.id,
    slug: article.slug,
    type: article.type || 'article',
    title: article.title,
    summary: article.summary || '',
    category: article.category || '',
    tags: Array.isArray(article.tags) ? article.tags : [],
    excerpt: plainContent.slice(0, 180),
    createdAt: article.createdAt,
    updatedAt: article.updatedAt,
    createdByName: article.createdByName || '',
    updatedByName: article.updatedByName || '',
    attachmentsCount: attachments.length,
    ...(full ? {
      content: article.content || '',
      attachments: attachments.map(attachment => serializeKnowledgeAttachment(article.id, attachment)),
      ...(isNetworkDiagram ? {
        diagramXml: article.diagramXml || '',
        diagramSvg: article.diagramSvg || ''
      } : {})
    } : {})
  };
}

async function compressKnowledgeAttachment(file) {
  if (!ALLOWED_IMAGE_MIMES.includes(file.mimetype)) {
    const ext = path.extname(file.originalname || '').toLowerCase() || '.bin';
    return {
      buffer: file.buffer,
      ext,
      mime: file.mimetype || 'application/octet-stream',
      kind: 'file',
      width: null,
      height: null
    };
  }

  const image = sharp(file.buffer, { animated: true });
  const metadata = await image.metadata();
  const compressed = await image
    .rotate()
    .resize({ width: 1920, height: 1920, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 80, effort: 4 })
    .toBuffer();

  const resizedMetadata = await sharp(compressed).metadata();

  return {
    buffer: compressed,
    ext: '.webp',
    mime: 'image/webp',
    kind: 'image',
    width: resizedMetadata.width || metadata.width || null,
    height: resizedMetadata.height || metadata.height || null
  };
}

router.get('/', requireAuth, (req, res) => {
  const q = normalizeText(req.query.q || '');
  const category = String(req.query.category || '').trim();
  const allArticles = listKnowledgeBaseArticles();

  const filteredArticles = allArticles.filter(article => {
    if (category && article.category !== category) return false;
    if (!q) return true;

    const haystack = normalizeText([
      article.title,
      article.summary,
      article.category,
      ...(Array.isArray(article.tags) ? article.tags : []),
      article.content,
      ...((Array.isArray(article.attachments) ? article.attachments : []).map(attachment => attachment.name))
    ].filter(Boolean).join(' '));

    return haystack.includes(q);
  });

  const categories = Array.from(new Set(allArticles.map(article => String(article.category || '').trim()).filter(Boolean)))
    .sort((a, b) => a.localeCompare(b, 'fr', { sensitivity: 'base' }))
    .map(value => ({
      value,
      count: allArticles.filter(article => String(article.category || '').trim() === value).length
    }));

  res.json({
    items: filteredArticles.map(article => serializeKnowledgeArticle(article)),
    categories
  });
});

router.get('/:id', requireAuth, (req, res) => {
  const article = getKnowledgeBaseArticle(req.params.id);
  if (!article) {
    return res.status(404).json({ error: 'Article introuvable' });
  }

  res.json(serializeKnowledgeArticle(article, { full: true }));
});

router.post('/', requireAuth, ensureAdmin, (req, res, next) => {
  try {
    const article = createKnowledgeBaseArticle(req.body || {}, req.user);
    saveKnowledgeBaseArticle(article);
    res.status(201).json({
      message: 'Article cree',
      article: serializeKnowledgeArticle(article, { full: true })
    });
  } catch (err) {
    next(err);
  }
});

router.patch('/:id', requireAuth, ensureAdmin, (req, res, next) => {
  try {
    const current = getKnowledgeBaseArticle(req.params.id);
    if (!current) {
      return res.status(404).json({ error: 'Article introuvable' });
    }

    const updated = updateKnowledgeBaseArticle(current, req.body || {}, req.user);
    replaceKnowledgeBaseArticle(req.params.id, updated);
    res.json({
      message: 'Article enregistre',
      article: serializeKnowledgeArticle(updated, { full: true })
    });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/attachments', requireAuth, ensureAdmin, (req, res, next) => {
  uploadKnowledgeAttachment(req, res, err => {
    if (err) return res.status(400).json({ error: err.message });
    next();
  });
}, async (req, res, next) => {
  const article = getKnowledgeBaseArticle(req.params.id);
  if (!article) {
    return res.status(404).json({ error: 'Article introuvable' });
  }
  if (!req.file) {
    return res.status(400).json({ error: 'Aucun fichier recu' });
  }

  let filePath = '';

  try {
    const compressed = await compressKnowledgeAttachment(req.file);
    const articleDir = getKnowledgeBaseArticleUploadDir(article.id);
    await fsp.mkdir(articleDir, { recursive: true });

    const attachmentId = randomUUID();
    const storedAs = `${attachmentId}${compressed.ext}`;
    filePath = path.join(articleDir, storedAs);
    await fsp.writeFile(filePath, compressed.buffer);

    const updatedArticle = addKnowledgeBaseAttachment(article.id, {
      id: attachmentId,
      name: sanitizeFilename(req.file.originalname),
      storedAs,
      mime: compressed.mime,
      size: compressed.buffer.length,
      kind: compressed.kind,
      uploadedAt: new Date().toISOString(),
      uploadedById: req.user?.id || null,
      uploadedByName: req.user?.name || '',
      width: compressed.width,
      height: compressed.height
    });

    const savedAttachment = updatedArticle?.attachments?.find(item => item.id === attachmentId);

    res.status(201).json({
      message: compressed.kind === 'image' ? 'Image ajoutee' : 'Document ajoute',
      attachment: serializeKnowledgeAttachment(article.id, savedAttachment),
      article: serializeKnowledgeArticle(updatedArticle, { full: true })
    });
  } catch (err) {
    if (filePath && fs.existsSync(filePath)) {
      await fsp.unlink(filePath).catch(() => {});
    }
    next(err);
  }
});

router.get('/:id/attachments/:attachmentId', requireAuth, (req, res) => {
  const article = getKnowledgeBaseArticle(req.params.id);
  if (!article) {
    return res.status(404).json({ error: 'Article introuvable' });
  }

  const attachment = (article.attachments || []).find(item => item.id === req.params.attachmentId);
  if (!attachment) {
    return res.status(404).json({ error: 'Fichier introuvable' });
  }

  const filePath = path.join(getKnowledgeBaseArticleUploadDir(article.id), attachment.storedAs);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Fichier manquant sur le disque' });
  }

  res.setHeader('Content-Type', attachment.mime || 'application/octet-stream');
  res.setHeader(
    'Content-Disposition',
    `${attachment.kind === 'image' ? 'inline' : 'attachment'}; filename="${encodeURIComponent(attachment.name || path.basename(filePath))}"`
  );
  return fs.createReadStream(filePath).pipe(res);
});

router.delete('/:id/attachments/:attachmentId', requireAuth, ensureAdmin, async (req, res, next) => {
  try {
    const removed = removeKnowledgeBaseAttachment(req.params.id, req.params.attachmentId);
    if (!removed) {
      return res.status(404).json({ error: 'Fichier introuvable' });
    }

    const filePath = path.join(getKnowledgeBaseArticleUploadDir(req.params.id), removed.attachment.storedAs);
    await fsp.unlink(filePath).catch(() => {});

    res.json({
      message: 'Fichier supprime',
      article: serializeKnowledgeArticle(removed.article, { full: true })
    });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', requireAuth, ensureAdmin, async (req, res) => {
  const article = getKnowledgeBaseArticle(req.params.id);
  if (!article) {
    return res.status(404).json({ error: 'Article introuvable' });
  }

  const removed = removeKnowledgeBaseArticle(req.params.id);
  if (!removed) {
    return res.status(404).json({ error: 'Article introuvable' });
  }

  await fsp.rm(getKnowledgeBaseArticleUploadDir(req.params.id), { recursive: true, force: true }).catch(() => {});
  res.json({ message: 'Article supprime' });
});

module.exports = router;
