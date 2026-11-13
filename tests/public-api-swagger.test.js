const { swaggerDocument: document } = require('../src/utils/swagger');
const router = require('../src/routes/publicApi');

describe('Contrat Swagger de l’API d’intégration', () => {
  it('couvre toutes les routes GET et résout leurs URL sous /api/v1', () => {
    const routes = router.stack.filter(layer => layer.route?.methods.get).map(layer => layer.route.path);
    expect(routes).toHaveLength(4);
    for (const route of routes) {
      const path = '/v1' + route.replace(':id', '{id}');
      const operation = document.paths[path].get;
      expect(document.servers[0].url + path).toBe('/api' + path);
      expect(operation.security).toEqual([{ integrationBearer: [] }]);
      for (const status of [200, 401, 403, 429, 500]) expect(operation.responses[status]).toBeDefined();
      if (route.includes(':id')) expect(operation.responses[404]).toBeDefined();
    }
    // L’interface web garde son schéma JWT et ses routes existantes.
    expect(document.paths['/equipment'].get).toBeDefined();
    expect(document.security).toEqual([{ bearerAuth: [] }]);
  });

  it('résout les références et les schémas de sécurité du document complet', () => {
    function visit(value) {
      if (!value || typeof value !== 'object') return;
      if (value.$ref) {
        expect(value.$ref.startsWith('#/')).toBe(true);
        const target = value.$ref.slice(2).split('/').reduce((node, key) => node?.[key], document);
        expect(target).toBeDefined();
      }
      if (value.security) {
        for (const requirement of value.security) {
          for (const name of Object.keys(requirement)) expect(document.components.securitySchemes[name]).toBeDefined();
        }
      }
      Object.values(value).forEach(visit);
    }
    visit(document);
    expect(() => JSON.stringify(document)).not.toThrow();
  });
});
