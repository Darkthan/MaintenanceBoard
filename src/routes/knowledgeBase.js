const express = require('express');
const { requireAuth } = require('../middleware/auth');
const {
  createKnowledgeBaseArticle,
  getKnowledgeBaseArticle,
  listKnowledgeBaseArticles,
  normalizeText,
  removeKnowledgeBaseArticle,
  replaceKnowledgeBaseArticle,
  saveKnowledgeBaseArticle,
  stripMarkdown,
  updateKnowledgeBaseArticle
} = require('../utils/knowledgeBase');

const router = express.Router();

function ensureAdmin(req, res, next) {
  if (req.user?.role !== 'ADMIN') {
    return res.status(403).json({ error: 'Acces refuse' });
  }
  next();
}

function serializeKnowledgeArticle(article, { full = false } = {}) {
  const plainContent = stripMarkdown(article.content);
  return {
    id: article.id,
    slug: article.slug,
    title: article.title,
    summary: article.summary || '',
    category: article.category || '',
    tags: Array.isArray(article.tags) ? article.tags : [],
    excerpt: plainContent.slice(0, 180),
    createdAt: article.createdAt,
    updatedAt: article.updatedAt,
    createdByName: article.createdByName || '',
    updatedByName: article.updatedByName || '',
    ...(full ? { content: article.content || '' } : {})
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
      article.content
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

router.delete('/:id', requireAuth, ensureAdmin, (req, res) => {
  const removed = removeKnowledgeBaseArticle(req.params.id);
  if (!removed) {
    return res.status(404).json({ error: 'Article introuvable' });
  }

  res.json({ message: 'Article supprime' });
});

module.exports = router;
