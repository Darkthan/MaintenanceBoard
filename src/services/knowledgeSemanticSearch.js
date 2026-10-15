const { createHash } = require('crypto');
const { stripMarkdown } = require('../utils/knowledgeBase');
const { rankKnowledgeSuggestions, tokenize } = require('../utils/knowledgeSuggestions');

const DEFAULT_MODEL = 'embeddinggemma:300m-qat-q4_0';

function readConfig() {
  return {
    url: process.env.KNOWLEDGE_OLLAMA_URL || '',
    model: process.env.KNOWLEDGE_EMBEDDING_MODEL || DEFAULT_MODEL,
    keepAlive: process.env.KNOWLEDGE_MODEL_KEEP_ALIVE || '30s',
    timeout: 8000,
    minScore: 0.65
  };
}

function cosineSimilarity(a, b) {
  if (a.length !== b.length) throw new Error('Incompatible embedding dimensions');
  let dot = 0;
  let aa = 0;
  let bb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    aa += a[i] * a[i];
    bb += b[i] * b[i];
  }
  return aa && bb ? dot / Math.sqrt(aa * bb) : 0;
}

function articleChunks(article) {
  const heading = [article.title, article.summary, article.category,
    ...(Array.isArray(article.tags) ? article.tags : [])].filter(Boolean).join('. ').slice(0, 600);
  const content = stripMarkdown(article.content);
  const chunks = [];
  // Small overlapping passages keep long procedures searchable with a small context.
  for (let offset = 0; offset < content.length; offset += 1200) {
    chunks.push(`${heading}\n${content.slice(offset, offset + 1500)}`);
  }
  return chunks.length ? chunks : [heading];
}

function createKnowledgeSemanticSearch({ fetchImpl = (...args) => fetch(...args), getConfig = readConfig,
  now = Date.now } = {}) {
  // At most 512 compact vectors (about 1.5 MiB at 768 dimensions), no model in Node.
  const cache = new Map();
  let busy = false;
  let retryAfter = 0;
  let configKey = '';

  function keyFor(text) {
    return createHash('sha256').update(text).digest('hex');
  }

  function remember(key, vector) {
    cache.delete(key);
    cache.set(key, Float32Array.from(vector));
    if (cache.size > 512) cache.delete(cache.keys().next().value);
  }

  return async function search(articles, query, limit = 3) {
    const cleanQuery = String(query || '').trim().slice(0, 2201);
    const eligible = articles.filter(article => article.showInReports === true
      && !['network-diagram', 'ip-addressing'].includes(article.type));
    const fallback = () => ({ mode: 'lexical', results: rankKnowledgeSuggestions(eligible, cleanQuery, limit) });
    if (cleanQuery.length < 3 || !tokenize(cleanQuery).length || !eligible.length) {
      return { mode: 'lexical', results: [] };
    }
    if (busy) return fallback();
    const config = getConfig();
    const nextConfigKey = `${config.url}|${config.model}`;
    if (configKey !== nextConfigKey) {
      cache.clear();
      retryAfter = 0;
      configKey = nextConfigKey;
    }
    // Never queue typing requests or run concurrent model inference.
    if (!config.url || busy || now() < retryAfter) return fallback();
    busy = true;
    const signal = AbortSignal.timeout(config.timeout);

    async function embed(inputs) {
      const response = await fetchImpl(`${config.url.replace(/\/+$/, '')}/api/embed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: config.model, input: inputs, keep_alive: config.keepAlive,
          truncate: true, options: { num_thread: 2 } }),
        signal,
        redirect: 'error'
      });
      if (!response.ok) throw new Error('Embedding service unavailable');
      const data = await response.json();
      const vectors = data.embeddings;
      if (!Array.isArray(vectors) || vectors.length !== inputs.length || vectors.some(vector =>
        !Array.isArray(vector) || !vector.length || vector.length > 4096
        || !vector.every(Number.isFinite) || !vector.some(value => value !== 0))) {
        throw new Error('Invalid embedding response');
      }
      return vectors;
    }

    try {
      const queryKey = keyFor(cleanQuery);
      let queryVector = cache.get(queryKey);
      if (!queryVector) {
        [queryVector] = await embed([cleanQuery]);
        remember(queryKey, queryVector);
      }
      const results = [];
      for (const article of eligible) {
        let score = -1;
        const chunks = articleChunks(article);
        // Batches of four limit the model's working memory.
        for (let offset = 0; offset < chunks.length; offset += 4) {
          if (signal.aborted) throw new Error('Search timed out');
          const batch = chunks.slice(offset, offset + 4);
          // Keep this batch's references even if inserting new vectors evicts an old entry.
          const vectorsForBatch = new Map(batch.map(text => [text, cache.get(keyFor(text))]));
          const missing = [...vectorsForBatch.keys()].filter(text => !vectorsForBatch.get(text));
          if (missing.length) {
            const vectors = await embed(missing);
            missing.forEach((text, index) => {
              remember(keyFor(text), vectors[index]);
              vectorsForBatch.set(text, cache.get(keyFor(text)));
            });
          }
          for (const text of batch) score = Math.max(score, cosineSimilarity(queryVector, vectorsForBatch.get(text)));
        }
        if (score >= config.minScore) results.push({ article, score });
      }
      return { mode: 'semantic', results: results.sort((a, b) => b.score - a.score)
        .slice(0, Math.max(1, Math.min(Number(limit) || 3, 5))) };
    } catch {
      // An unavailable/cold model must never block submitting a request.
      retryAfter = now() + 30000;
      return fallback();
    } finally {
      busy = false;
    }
  };
}

module.exports = { createKnowledgeSemanticSearch, searchKnowledgeSuggestions: createKnowledgeSemanticSearch() };
