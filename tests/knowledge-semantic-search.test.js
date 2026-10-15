const { createKnowledgeSemanticSearch } = require('../src/services/knowledgeSemanticSearch');

const config = { url: 'http://ollama:11434', model: 'small-local-model', keepAlive: '30s', timeout: 8000, minScore: 0.65 };
const procedure = { id: 'display', title: 'Dupliquer le bureau', content: 'Choisir Windows + P.', showInReports: true };
const irrelevant = { id: 'printer', title: 'Toner', content: 'Remplacer la cartouche.', showInReports: true };
const response = embeddings => ({ ok: true, json: async () => ({ embeddings }) });

function service(fetchImpl, extra = {}) {
  return createKnowledgeSemanticSearch({ fetchImpl, getConfig: () => config, ...extra });
}

it('retrouve une procédure sans mot commun et exclut les contenus privés avant tout calcul', async () => {
  const fetchImpl = jest.fn()
    .mockResolvedValueOnce(response([[1, 0]]))
    .mockResolvedValueOnce(response([[0.99, 0.01]]))
    .mockResolvedValueOnce(response([[0, 1]]));
  const result = await service(fetchImpl)([
    procedure, irrelevant, { ...procedure, id: 'secret', content: 'SECRET', showInReports: false },
    { ...procedure, id: 'diagram', type: 'network-diagram' }
  ], 'Le vidéoprojecteur reste noir');
  expect(result.mode).toBe('semantic');
  expect(result.results.map(item => item.article.id)).toEqual(['display']);
  expect(JSON.stringify(fetchImpl.mock.calls)).not.toContain('SECRET');
  expect(fetchImpl.mock.calls[0][0]).toBe('http://ollama:11434/api/embed');
  expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toMatchObject({
    keep_alive: '30s', options: { num_thread: 2 }, model: 'small-local-model'
  });
});

it('réutilise les vecteurs et recalcule seulement les passages modifiés', async () => {
  const fetchImpl = jest.fn().mockImplementation(async (_url, options) =>
    response(JSON.parse(options.body).input.map(() => [1, 0])));
  const search = service(fetchImpl);
  await search([procedure], 'panne');
  await search([procedure], 'panne');
  expect(fetchImpl).toHaveBeenCalledTimes(2);
  await search([{ ...procedure, content: 'Nouvelle procédure.' }], 'panne');
  expect(fetchImpl).toHaveBeenCalledTimes(3);
});

it('retrouve aussi un passage à la fin d’un article long avec des lots de quatre maximum', async () => {
  const fetchImpl = jest.fn().mockImplementation(async (_url, options) => {
    const inputs = JSON.parse(options.body).input;
    expect(inputs.length).toBeLessThanOrEqual(4);
    return response(inputs.map(text => text.includes('SOLUTION') || text === 'panne' ? [1, 0] : [0, 1]));
  });
  const result = await service(fetchImpl)([{ ...procedure, content: 'Un détail. '.repeat(900) + 'SOLUTION' }], 'panne');
  expect(result.results[0].article.id).toBe('display');
});

it('ne propose pas de résultat sémantique sous le seuil', async () => {
  const fetchImpl = jest.fn().mockResolvedValueOnce(response([[1, 0]])).mockResolvedValueOnce(response([[0, 1]]));
  expect(await service(fetchImpl)([procedure], 'météo')).toEqual({ mode: 'semantic', results: [] });
});

it('utilise les mots-clés sans service configuré et ne charge aucun modèle', async () => {
  const fetchImpl = jest.fn();
  const search = service(fetchImpl, { getConfig: () => ({ ...config, url: '' }) });
  expect((await search([procedure], 'dupliquer')).results[0].article.id).toBe('display');
  expect(fetchImpl).not.toHaveBeenCalled();
});

it('évite les appels concurrents et la mise en attente de nouvelles saisies', async () => {
  let resolve;
  const fetchImpl = jest.fn().mockImplementationOnce(() => new Promise(done => { resolve = done; }))
    .mockResolvedValue(response([[1, 0]]));
  const search = service(fetchImpl);
  const pending = search([procedure], 'dupliquer');
  const fallback = await search([procedure], 'dupliquer');
  expect(fallback.mode).toBe('lexical');
  expect(fetchImpl).toHaveBeenCalledTimes(1);
  resolve(response([[1, 0]]));
  await pending;
});

it.each([
  { ok: false }, response([[NaN, 1]]), response([[0, 0]]), response([]),
  response([[1, 0], [1, 0]])
])('revient aux mots-clés après une erreur ou une réponse invalide', async invalid => {
  const fetchImpl = jest.fn().mockResolvedValue(invalid);
  const search = service(fetchImpl);
  expect((await search([procedure], 'dupliquer')).mode).toBe('lexical');
  await search([procedure], 'dupliquer');
  expect(fetchImpl).toHaveBeenCalledTimes(1);
});

it('réessaie le service après le délai de repli', async () => {
  let time = 0;
  const fetchImpl = jest.fn().mockRejectedValue(new Error('offline'));
  const search = service(fetchImpl, { now: () => time });
  await search([procedure], 'dupliquer');
  time = 30001;
  await search([procedure], 'dupliquer');
  expect(fetchImpl).toHaveBeenCalledTimes(2);
});

it('ne calcule rien pour une saisie vide ou sans article publié', async () => {
  const fetchImpl = jest.fn();
  const search = service(fetchImpl);
  await search([procedure], '');
  await search([{ ...procedure, showInReports: false }], 'dupliquer');
  expect(fetchImpl).not.toHaveBeenCalled();
});
