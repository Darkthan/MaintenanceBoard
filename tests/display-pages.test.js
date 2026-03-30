const request = require('supertest');
const app = require('../src/app');

describe('display screens pages', () => {
  it('expose le nouvel onglet écrans dans les paramètres', async () => {
    const res = await request(app).get('/settings.html');
    expect(res.status).toBe(200);
    expect(res.text).toContain('data-tab="screens"');
    expect(res.text).toContain('id="screen-form"');
    expect(res.text).toContain('id="screen-widget-list"');
    expect(res.text).toContain('id="screen-alerts-enabled"');
  });

  it('sert la page publique écran sans authentification via /screen/:token', async () => {
    const res = await request(app).get('/screen/test-token');
    expect(res.status).toBe(200);
    expect(res.text).toContain('id="display-grid"');
    expect(res.text).toContain('/api/display/');
    expect(res.text).toContain('id="screen-title"');
  });
});
