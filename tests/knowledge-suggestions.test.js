const { rankKnowledgeSuggestions } = require('../src/utils/knowledgeSuggestions');

describe('knowledge suggestions', () => {
  it('propose une procedure de duplication pour un probleme de projecteur', () => {
    const articles = [
      {
        id: 'display-duplicate',
        type: 'article',
        showInReports: true,
        title: 'Dupliquer l’écran avec Windows + P',
        summary: 'Afficher la même image sur le vidéoprojecteur et l’écran.',
        tags: ['projecteur', 'affichage', 'duplication'],
        content: 'Appuyez sur Windows + P, puis choisissez Dupliquer.'
      },
      {
        id: 'printer',
        type: 'article',
        showInReports: true,
        title: 'Remplacer le toner',
        tags: ['imprimante'],
        content: 'Ouvrir le capot de l’imprimante.'
      }
    ];

    const results = rankKnowledgeSuggestions(
      articles,
      "Le projecteur n'affiche pas la même chose que l'écran"
    );

    expect(results).toHaveLength(1);
    expect(results[0].article.id).toBe('display-duplicate');
  });

  it('exclut les articles non publies dans les signalements', () => {
    const results = rankKnowledgeSuggestions([{
      id: 'internal',
      type: 'article',
      showInReports: false,
      title: 'Mot de passe administrateur',
      tags: ['mot de passe'],
      content: 'Information interne'
    }], 'mot de passe administrateur');

    expect(results).toEqual([]);
  });
});
