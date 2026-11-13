const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { createUserDocumentationArticle, getUserDocumentationArticle, removeUserDocumentationArticle,
  saveUserDocumentationArticle, searchUserDocumentationArticles, updateUserDocumentationArticle } = require('../utils/userDocumentation');
const { stripMarkdown } = require('../utils/knowledgeBase');

const router = express.Router();

function ensureAdmin(req, res, next) {
  if (req.user?.role !== 'ADMIN') return res.status(403).json({ error: 'Accès refusé' });
  next();
}

function serialize(article, full = false) {
  return { id: article.id, title: article.title, summary: article.summary || '', category: article.category || '',
    tags: article.tags || [], showInReports: article.showInReports === true, excerpt: stripMarkdown(article.content).slice(0, 220),
    updatedAt: article.updatedAt, updatedByName: article.updatedByName || '', ...(full ? { content: article.content || '' } : {}) };
}

router.get('/', requireAuth, (req, res) => res.json({ items: searchUserDocumentationArticles(req.query.q || '').map(article => serialize(article)) }));
router.get('/:id', requireAuth, (req, res) => {
  const article = getUserDocumentationArticle(req.params.id);
  return article ? res.json(serialize(article, true)) : res.status(404).json({ error: 'Article introuvable' });
});
router.post('/', requireAuth, ensureAdmin, (req, res, next) => {
  try { const article = saveUserDocumentationArticle(createUserDocumentationArticle(req.body || {}, req.user)); return res.status(201).json({ article: serialize(article, true) }); } catch (error) { return next(error); }
});
router.patch('/:id', requireAuth, ensureAdmin, (req, res, next) => {
  try { const article = updateUserDocumentationArticle(req.params.id, req.body || {}, req.user); return article ? res.json({ article: serialize(article, true) }) : res.status(404).json({ error: 'Article introuvable' }); } catch (error) { return next(error); }
});
router.delete('/:id', requireAuth, ensureAdmin, (req, res) => {
  const removed = removeUserDocumentationArticle(req.params.id);
  return res.status(removed ? 200 : 404).json(removed ? { message: 'Article supprimé' } : { error: 'Article introuvable' });
});

module.exports = router;
