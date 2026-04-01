const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

function getKnowledgeBaseFilePath() {
  return process.env.KNOWLEDGE_BASE_FILE || path.join(process.cwd(), 'data', 'knowledge-base.json');
}

function getKnowledgeBaseUploadDir() {
  return process.env.KNOWLEDGE_BASE_UPLOAD_DIR || path.join(process.cwd(), 'uploads', 'knowledge-base');
}

function getKnowledgeBaseArticleUploadDir(articleId) {
  return path.join(getKnowledgeBaseUploadDir(), String(articleId || ''));
}

function readKnowledgeBaseStore() {
  const filePath = getKnowledgeBaseFilePath();

  try {
    if (!fs.existsSync(filePath)) {
      return { articles: [] };
    }

    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return {
      articles: Array.isArray(parsed?.articles)
        ? parsed.articles.map(article => ({
          ...article,
          attachments: normalizeAttachments(article?.attachments)
        }))
        : []
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

function normalizeAttachments(value) {
  if (!Array.isArray(value)) return [];

  return value
    .map(attachment => ({
      id: String(attachment?.id || '').trim() || randomUUID(),
      name: String(attachment?.name || '').trim() || 'fichier',
      storedAs: String(attachment?.storedAs || '').trim(),
      mime: String(attachment?.mime || '').trim() || 'application/octet-stream',
      size: Number.isFinite(Number(attachment?.size)) ? Number(attachment.size) : 0,
      kind: String(attachment?.kind || '').trim() === 'image' ? 'image' : 'file',
      uploadedAt: String(attachment?.uploadedAt || '').trim() || new Date().toISOString(),
      uploadedById: attachment?.uploadedById ? String(attachment.uploadedById) : null,
      uploadedByName: String(attachment?.uploadedByName || '').trim(),
      width: Number.isFinite(Number(attachment?.width)) ? Number(attachment.width) : null,
      height: Number.isFinite(Number(attachment?.height)) ? Number(attachment.height) : null
    }))
    .filter(attachment => attachment.storedAs);
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

const VALID_ARTICLE_TYPES = ['article', 'network-diagram'];

function validateKnowledgeBasePayload(payload, { partial = false } = {}) {
  const title = payload.title === undefined ? undefined : String(payload.title || '').trim();
  const content = payload.content === undefined ? undefined : String(payload.content || '').trim();
  const summary = payload.summary === undefined ? undefined : String(payload.summary || '').trim();
  const category = payload.category === undefined ? undefined : String(payload.category || '').trim();
  const tags = payload.tags === undefined ? undefined : normalizeTags(payload.tags);
  const type = payload.type === undefined ? undefined : (VALID_ARTICLE_TYPES.includes(String(payload.type)) ? String(payload.type) : 'article');
  const diagramXml = payload.diagramXml === undefined ? undefined : String(payload.diagramXml || '');
  const diagramSvg = payload.diagramSvg === undefined ? undefined : String(payload.diagramSvg || '');

  if (!partial || payload.title !== undefined) {
    if (!title) {
      const error = new Error('Le titre est obligatoire.');
      error.status = 400;
      throw error;
    }
  }

  return {
    ...(title !== undefined ? { title } : {}),
    ...(content !== undefined ? { content } : {}),
    ...(summary !== undefined ? { summary } : {}),
    ...(category !== undefined ? { category } : {}),
    ...(tags !== undefined ? { tags } : {}),
    ...(type !== undefined ? { type } : {}),
    ...(diagramXml !== undefined ? { diagramXml } : {}),
    ...(diagramSvg !== undefined ? { diagramSvg } : {})
  };
}

function createKnowledgeBaseArticle(payload, user) {
  const data = validateKnowledgeBasePayload(payload);
  const timestamp = new Date().toISOString();

  return {
    id: randomUUID(),
    slug: slugify(data.title),
    type: data.type || 'article',
    title: data.title,
    summary: data.summary || '',
    category: data.category || '',
    tags: data.tags || [],
    content: data.content || '',
    diagramXml: data.diagramXml || '',
    diagramSvg: data.diagramSvg || '',
    attachments: [],
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
    ...(patch.type !== undefined ? { type: patch.type } : {}),
    ...(patch.summary !== undefined ? { summary: patch.summary } : {}),
    ...(patch.category !== undefined ? { category: patch.category } : {}),
    ...(patch.tags !== undefined ? { tags: patch.tags } : {}),
    ...(patch.content !== undefined ? { content: patch.content } : {}),
    ...(patch.diagramXml !== undefined ? { diagramXml: patch.diagramXml } : {}),
    ...(patch.diagramSvg !== undefined ? { diagramSvg: patch.diagramSvg } : {}),
    updatedAt: new Date().toISOString(),
    updatedById: user?.id || null,
    updatedByName: user?.name || ''
  };
}

function saveKnowledgeBaseArticle(article) {
  const articles = listKnowledgeBaseArticles();
  writeKnowledgeBaseStore({
    articles: sortArticles([
      ...articles,
      {
        ...article,
        attachments: normalizeAttachments(article.attachments)
      }
    ])
  });
  return article;
}

function replaceKnowledgeBaseArticle(articleId, updatedArticle) {
  const articles = listKnowledgeBaseArticles();
  const index = articles.findIndex(article => article.id === articleId);
  if (index === -1) return null;
  articles[index] = {
    ...updatedArticle,
    attachments: normalizeAttachments(updatedArticle.attachments)
  };
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

function addKnowledgeBaseAttachment(articleId, attachment) {
  const article = getKnowledgeBaseArticle(articleId);
  if (!article) return null;

  const normalizedAttachment = normalizeAttachments([attachment])[0];
  const updatedArticle = {
    ...article,
    attachments: [...normalizeAttachments(article.attachments), normalizedAttachment],
    updatedAt: new Date().toISOString(),
    ...(normalizedAttachment.uploadedById ? { updatedById: normalizedAttachment.uploadedById } : {}),
    ...(normalizedAttachment.uploadedByName ? { updatedByName: normalizedAttachment.uploadedByName } : {})
  };

  replaceKnowledgeBaseArticle(articleId, updatedArticle);
  return updatedArticle;
}

function removeKnowledgeBaseAttachment(articleId, attachmentId) {
  const article = getKnowledgeBaseArticle(articleId);
  if (!article) return null;

  const attachments = normalizeAttachments(article.attachments);
  const attachment = attachments.find(item => item.id === attachmentId);
  if (!attachment) return null;

  const updatedArticle = {
    ...article,
    attachments: attachments.filter(item => item.id !== attachmentId),
    updatedAt: new Date().toISOString()
  };

  replaceKnowledgeBaseArticle(articleId, updatedArticle);
  return { article: updatedArticle, attachment };
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
  addKnowledgeBaseAttachment,
  createKnowledgeBaseArticle,
  getKnowledgeBaseArticleUploadDir,
  getKnowledgeBaseArticle,
  getKnowledgeBaseUploadDir,
  listKnowledgeBaseArticles,
  normalizeText,
  removeKnowledgeBaseAttachment,
  removeKnowledgeBaseArticle,
  replaceKnowledgeBaseArticle,
  saveKnowledgeBaseArticle,
  stripMarkdown,
  updateKnowledgeBaseArticle
};
