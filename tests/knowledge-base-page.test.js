const request = require('supertest');

jest.mock('../src/lib/prisma', () => ({ user: { findUnique: jest.fn() } }));

jest.mock('@prisma/client', () => {
  const mockPrisma = { user: { findUnique: jest.fn() } };
  return { PrismaClient: jest.fn(() => mockPrisma) };
});

jest.mock('../src/middleware/auth', () => ({
  requireAuth: (req, _res, next) => {
    req.user = { id: 'u1', role: 'ADMIN', name: 'Admin', email: 'a@test.com', isActive: true };
    next();
  },
  optionalAuth: (_req, _res, next) => next()
}));

const app = require('../src/app');

describe('knowledge base page', () => {
  it('sert la page de base de connaissance', async () => {
    const res = await request(app).get('/knowledge-base.html');

    expect(res.status).toBe(200);
    expect(res.text).toContain('Base de connaissance');
    expect(res.text).toContain('knowledge-article-list');
    expect(res.text).toContain('knowledge-article-view');
    expect(res.text).toContain('knowledge-editor-modal');
    expect(res.text).toContain('Nouvel article');
    expect(res.text).toContain('editor-image-input');
    expect(res.text).toContain('editor-document-input');
    expect(res.text).toContain('article-documents');
    expect(res.text).toContain('data-kb-code-copy');
    expect(res.text).toContain('data-kb-code-edit');
    expect(res.text).toContain('Copier la version modifiée');
    expect(res.text).toContain('id="ip-panel"');
    expect(res.text).toContain("ipShowPanel()");
    expect(res.text).toContain("ipOpenNetworkForm()");
    expect(res.text).toContain("Nouveau plan d'adressage");
    expect(res.text).not.toContain('fab-new-ip-range');
    expect(res.text).toContain("await selectArticle('system-ip-addressing')");
    expect(res.text).toContain("actions.classList.remove('pointer-events-none', 'opacity-0', 'scale-95')");
    expect(res.text).toContain("style.transform = 'rotate(45deg)'");
    expect(res.text).toContain('id="kb-fab-wrap" class="hidden fixed bottom-6 right-6 z-40 flex flex-col items-end gap-3"');
    expect(res.text).toContain('id="diagram-topology-input"');
    expect(res.text).toContain('id="diagram-topology-preview"');
    expect(res.text).toContain('id="diagram-mode-text-btn"');
    expect(res.text).toContain('id="ip-fn-gateway"');
    expect(res.text).toContain("gateway: document.getElementById('ip-fn-gateway').value||null");
    expect(res.text).toContain('id="ip-fn-secondary-gateways"');
    expect(res.text).toContain('secondaryGateways: document.getElementById(\'ip-fn-secondary-gateways\').value||null');
    expect(res.text).toContain('IP de début *');
    expect(res.text).toContain('IP de fin *');
    expect(res.text).toContain("Saisissez une plage IP valide appartenant au réseau.");
    expect(res.text).toContain("networkBase: ipParseCidr(n.cidr).networkBase");
    expect(res.text).toContain('href="/equipment.html?focus=${encodeURIComponent(a.equipment.id)}"');
    expect(res.text).toContain("ipCurrentAddresses.filter(address => !address.autoDiscovered && !address.unassigned)");
    expect(res.text).toContain("id:`unassigned:${offset}`, ip, unassigned:true");
    expect(res.text).toContain("a.unassigned?'Non attribuée':'—'");
    expect(res.text).toContain("new URLSearchParams(window.location.search).get('network')");
    expect(res.text).toContain('await ipOpenDetail(requestedNetworkId)');
    expect(res.text).toContain('id="ip-unassigned-limit-note"');
    expect(res.text).toContain('id="ip-btn-export-addresses"');
    expect(res.text).toContain('/addresses/export');
    expect(res.text).toContain('id="ip-info-secondary-wrap"');
    expect(res.text).toContain('id="ip-prev-secondary-row"');
    expect(res.text).toContain('dispo ·');
    expect(res.text).toContain('id="ip-btn-history"');
    expect(res.text).toContain('id="ip-modal-history"');
    expect(res.text).toContain('/history/${revisionId}/restore');
    expect(res.text).toContain("['network','ranges','addresses']");
    expect(res.text).toContain("${data.created} adresse(s) créée(s), ${data.updated} mise(s) à jour.");
    expect(res.text).toContain('id="ip-btn-bulk-edit"');
    expect(res.text).toContain('/addresses/bulk');
    expect(res.text).toContain('ipSetBulkEditing(false)');
    expect(res.text).toContain('Les images sont compressées automatiquement');
  });

  it('redirige l ancienne page du plan d adressage vers la documentation', async () => {
    const res = await request(app).get('/ip-addressing.html');

    expect(res.status).toBe(200);
    expect(res.text).toContain("window.location.replace('/knowledge-base.html?article=system-ip-addressing')");
  });
});
