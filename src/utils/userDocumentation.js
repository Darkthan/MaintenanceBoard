const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const { normalizeText, stripMarkdown } = require('./knowledgeBase');

function getUserDocumentationFilePath() {
  return process.env.USER_DOCUMENTATION_FILE || path.join(process.cwd(), 'data', 'user-documentation.json');
}

function readStore() {
  try {
    const filePath = getUserDocumentationFilePath();
    if (!fs.existsSync(filePath)) return { articles: [] };
    const store = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return { articles: Array.isArray(store?.articles) ? store.articles : [] };
  } catch {
    return { articles: [] };
  }
}

function writeStore(store) {
  const filePath = getUserDocumentationFilePath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(store, null, 2));
}

function normalizeTags(value) {
  const input = Array.isArray(value) ? value : String(value || '').split(/[,;\n]/);
  return [...new Set(input.map(item => String(item || '').trim()).filter(Boolean))];
}

function sortArticles(articles) {
  return articles.slice().sort((a, b) => String(a.title).localeCompare(String(b.title), 'fr', { sensitivity: 'base' }));
}

function listUserDocumentationArticles() {
  return sortArticles(readStore().articles).map(article => ({
    ...article,
    type: 'user-documentation',
    showInReports: article.showInReports === true,
    tags: normalizeTags(article.tags)
  }));
}

function getUserDocumentationArticle(id) {
  return listUserDocumentationArticles().find(article => article.id === id) || null;
}

function validate(payload, { partial = false } = {}) {
  const title = payload.title === undefined ? undefined : String(payload.title || '').trim().slice(0, 200);
  if ((!partial || title !== undefined) && !title) {
    const error = new Error('Le titre est obligatoire.');
    error.status = 400;
    throw error;
  }
  return {
    ...(title !== undefined ? { title } : {}),
    ...(payload.summary !== undefined ? { summary: String(payload.summary || '').trim().slice(0, 500) } : {}),
    ...(payload.category !== undefined ? { category: String(payload.category || '').trim().slice(0, 100) } : {}),
    ...(payload.tags !== undefined ? { tags: normalizeTags(payload.tags) } : {}),
    ...(payload.content !== undefined ? { content: String(payload.content || '').trim().slice(0, 20000) } : {}),
    ...(payload.showInReports !== undefined ? { showInReports: payload.showInReports === true } : {})
  };
}

function createUserDocumentationArticle(payload, user) {
  const now = new Date().toISOString();
  return { id: randomUUID(), type: 'user-documentation', summary: '', category: '', tags: [], content: '', showInReports: false,
    ...validate(payload), createdAt: now, updatedAt: now, createdByName: user?.name || '', updatedByName: user?.name || '' };
}

function saveUserDocumentationArticle(article) {
  const articles = readStore().articles.filter(item => item.id !== article.id);
  writeStore({ articles: sortArticles([...articles, article]) });
  return article;
}

function updateUserDocumentationArticle(id, payload, user) {
  const current = getUserDocumentationArticle(id);
  if (!current) return null;
  return saveUserDocumentationArticle({ ...current, ...validate(payload, { partial: true }), updatedAt: new Date().toISOString(), updatedByName: user?.name || '' });
}

function removeUserDocumentationArticle(id) {
  const articles = readStore().articles;
  if (!articles.some(article => article.id === id)) return false;
  writeStore({ articles: articles.filter(article => article.id !== id) });
  return true;
}

function searchUserDocumentationArticles(query) {
  const needle = normalizeText(query);
  return listUserDocumentationArticles().filter(article => !needle || normalizeText([
    article.title, article.summary, article.category, ...(article.tags || []), stripMarkdown(article.content)
  ].join(' ')).includes(needle));
}

module.exports = { createUserDocumentationArticle, getUserDocumentationArticle, listUserDocumentationArticles,
  removeUserDocumentationArticle, saveUserDocumentationArticle, searchUserDocumentationArticles, updateUserDocumentationArticle };
