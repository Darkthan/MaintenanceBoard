const { normalizeText } = require('./knowledgeBase');

const STOP_WORDS = new Set([
  'a', 'ai', 'au', 'aux', 'avec', 'ce', 'ces', 'cet', 'cette', 'dans', 'de', 'des', 'du',
  'elle', 'en', 'est', 'et', 'faire', 'il', 'je', 'la', 'le', 'les', 'ma', 'mais', 'me',
  'mes', 'mon', 'ne', 'nous', 'on', 'ou', 'pas', 'pour', 'que', 'qui', 'sa', 'se', 'ses',
  'son', 'sur', 'un', 'une', 'vous'
]);

const CONCEPT_GROUPS = [
  ['affichage', 'affiche', 'afficher', 'ecran', 'image', 'moniteur', 'projection', 'projecteur', 'videoprojecteur'],
  ['dupliquer', 'duplication', 'identique', 'meme', 'miroir', 'recopie', 'reproduire'],
  ['windows p', 'windows+p', 'win p', 'projeter'],
  ['connexion', 'internet', 'reseau', 'wifi', 'wi fi'],
  ['imprimante', 'impression', 'imprimer', 'papier', 'toner'],
  ['audio', 'enceinte', 'micro', 'son', 'volume'],
  ['clavier', 'souris', 'usb'],
  ['mot de passe', 'password', 'identifiant', 'connexion compte']
].map(group => group.map(normalizeText));

function tokenize(value) {
  return normalizeText(value)
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter(token => token.length > 1 && !STOP_WORDS.has(token));
}

function conceptsFor(value) {
  const normalized = ` ${normalizeText(value).replace(/[^a-z0-9+]+/g, ' ')} `;
  const tokens = new Set(tokenize(value));
  const concepts = new Set();

  CONCEPT_GROUPS.forEach((group, index) => {
    if (group.some(term => term.includes(' ')
      ? normalized.includes(` ${term} `)
      : tokens.has(term))) {
      concepts.add(index);
    }
  });

  return concepts;
}

function fieldScore(queryTokens, value, weight) {
  const fieldTokens = new Set(tokenize(value));
  return queryTokens.reduce((score, token) => score + (fieldTokens.has(token) ? weight : 0), 0);
}

function rankKnowledgeSuggestions(articles, query, limit = 3) {
  const cleanQuery = String(query || '').trim().slice(0, 200);
  const queryTokens = tokenize(cleanQuery);
  if (cleanQuery.length < 3 || queryTokens.length === 0) return [];

  const queryConcepts = conceptsFor(cleanQuery);

  return (Array.isArray(articles) ? articles : [])
    .filter(article => article?.type !== 'network-diagram'
      && article?.type !== 'ip-addressing'
      && article?.showInReports === true)
    .map(article => {
      const tags = Array.isArray(article.tags) ? article.tags.join(' ') : '';
      const searchableText = [article.title, article.summary, article.category, tags, article.content]
        .filter(Boolean)
        .join(' ');
      const articleConcepts = conceptsFor(searchableText);
      const sharedConcepts = [...queryConcepts].filter(concept => articleConcepts.has(concept)).length;
      const normalizedQuery = normalizeText(cleanQuery);
      const normalizedText = normalizeText(searchableText);

      let score = 0;
      score += fieldScore(queryTokens, article.title, 8);
      score += fieldScore(queryTokens, tags, 7);
      score += fieldScore(queryTokens, article.summary, 5);
      score += fieldScore(queryTokens, article.category, 2);
      score += fieldScore(queryTokens, article.content, 1);
      score += sharedConcepts * 7;
      if (normalizedText.includes(normalizedQuery)) score += 12;

      return { article, score };
    })
    .filter(result => result.score >= 7)
    .sort((a, b) => b.score - a.score
      || String(b.article.updatedAt || '').localeCompare(String(a.article.updatedAt || '')))
    .slice(0, Math.max(1, Math.min(Number(limit) || 3, 5)));
}

module.exports = {
  rankKnowledgeSuggestions,
  tokenize
};
