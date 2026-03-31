const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

function getKnowledgeBaseFilePath() {
  return process.env.KNOWLEDGE_BASE_FILE || path.join(process.cwd(), 'data', 'knowledge-base.json');
}

function readKnowledgeBaseStore() {
  const filePath = getKnowledgeBaseFilePath();

  try {
    if (!fs.existsSync(filePath)) {
      return { articles: [] };
    }

    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return {
      articles: Array.isArray(parsed?.articles) ? parsed.articles : []
    };
  } catch {
    return { articles: [] };
  }
}

function writeKnowledgeBaseStore(store) {
  const filePath = getKnowledgeBaseFilePath();
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(store, null, 2));
}

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function slugify(value) {
  const normalized = normalizeText(value)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return normalized || 'article';
}

function normalizeTags(value) {
  if (Array.isArray(value)) {
    return Array.from(new Set(value.map(tag => String(tag || '').trim()).filter(Boolean)));
  }

  return Array.from(new Set(
    String(value || '')
      .split(/[,\n;]/)
      .map(tag => tag.trim())
      .filter(Boolean)
  ));
}

function sortArticles(items) {
  return items.slice().sort((a, b) => {
    const categoryA = String(a.category || '');
    const categoryB = String(b.category || '');
    const categoryDiff = categoryA.localeCompare(categoryB, 'fr', { sensitivity: 'base' });
    if (categoryDiff !== 0) return categoryDiff;
    return String(a.title || '').localeCompare(String(b.title || ''), 'fr', { sensitivity: 'base' });
  });
}

function listKnowledgeBaseArticles() {
  return sortArticles(readKnowledgeBaseStore().articles);
}

function getKnowledgeBaseArticle(articleId) {
  return listKnowledgeBaseArticles().find(article => article.id === articleId) || null;
}

function validateKnowledgeBasePayload(payload, { partial = false } = {}) {
  const title = payload.title === undefined ? undefined : String(payload.title || '').trim();
  const content = payload.content === undefined ? undefined : String(payload.content || '').trim();
  const summary = payload.summary === undefined ? undefined : String(payload.summary || '').trim();
  const category = payload.category === undefined ? undefined : String(payload.category || '').trim();
  const tags = payload.tags === undefined ? undefined : normalizeTags(payload.tags);

  if (!partial || payload.title !== undefined) {
    if (!title) {
      const error = new Error('Le titre est obligatoire.');
      error.status = 400;
      throw error;
    }
  }

  if (!partial || payload.content !== undefined) {
    if (!content) {
      const error = new Error('Le contenu est obligatoire.');
      error.status = 400;
      throw error;
    }
  }

  return {
    ...(title !== undefined ? { title } : {}),
    ...(content !== undefined ? { content } : {}),
    ...(summary !== undefined ? { summary } : {}),
    ...(category !== undefined ? { category } : {}),
    ...(tags !== undefined ? { tags } : {})
  };
}

function createKnowledgeBaseArticle(payload, user) {
  const data = validateKnowledgeBasePayload(payload);
  const timestamp = new Date().toISOString();

  return {
    id: randomUUID(),
    slug: slugify(data.title),
    title: data.title,
    summary: data.summary || '',
    category: data.category || '',
    tags: data.tags || [],
    content: data.content,
    createdAt: timestamp,
    updatedAt: timestamp,
    createdById: user?.id || null,
    createdByName: user?.name || '',
    updatedById: user?.id || null,
    updatedByName: user?.name || ''
  };
}

function updateKnowledgeBaseArticle(article, payload, user) {
  const patch = validateKnowledgeBasePayload(payload, { partial: true });

  return {
    ...article,
    ...(patch.title ? { title: patch.title, slug: slugify(patch.title) } : {}),
    ...(patch.summary !== undefined ? { summary: patch.summary } : {}),
    ...(patch.category !== undefined ? { category: patch.category } : {}),
    ...(patch.tags !== undefined ? { tags: patch.tags } : {}),
    ...(patch.content !== undefined ? { content: patch.content } : {}),
    updatedAt: new Date().toISOString(),
    updatedById: user?.id || null,
    updatedByName: user?.name || ''
  };
}

function saveKnowledgeBaseArticle(article) {
  const articles = listKnowledgeBaseArticles();
  writeKnowledgeBaseStore({ articles: sortArticles([...articles, article]) });
  return article;
}

function replaceKnowledgeBaseArticle(articleId, updatedArticle) {
  const articles = listKnowledgeBaseArticles();
  const index = articles.findIndex(article => article.id === articleId);
  if (index === -1) return null;
  articles[index] = updatedArticle;
  writeKnowledgeBaseStore({ articles: sortArticles(articles) });
  return updatedArticle;
}

function removeKnowledgeBaseArticle(articleId) {
  const articles = listKnowledgeBaseArticles();
  const nextArticles = articles.filter(article => article.id !== articleId);
  if (nextArticles.length === articles.length) return false;
  writeKnowledgeBaseStore({ articles: nextArticles });
  return true;
}

function stripMarkdown(value) {
  return String(value || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^[#>\-\*\d.\s]+/gm, ' ')
    .replace(/[_*~]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

module.exports = {
  createKnowledgeBaseArticle,
  getKnowledgeBaseArticle,
  listKnowledgeBaseArticles,
  normalizeText,
  removeKnowledgeBaseArticle,
  replaceKnowledgeBaseArticle,
  saveKnowledgeBaseArticle,
  stripMarkdown,
  updateKnowledgeBaseArticle
};
