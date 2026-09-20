// Reproductions locales : aucune requête réseau, aucune écriture en base.
// Les résultats « CONFIRME » désignent un défaut, pas une validation de sécurité.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createRequire } = require('module');

function load(file, mocks = {}) {
  const filename = path.resolve(__dirname, '..', file);
  const realRequire = createRequire(filename);
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module, exports: module.exports, console, Buffer, process,
    require: name => Object.hasOwn(mocks, name) ? mocks[name] : realRequire(name)
  }, { filename });
  return module.exports;
}

async function main() {
  const findings = [];
  let settings = { supervision: {} };
  const settingsMock = {
    readSettings: () => settings,
    writeSettings: patch => { settings = { ...settings, ...patch }; }
  };
  const supervision = load('src/utils/supervision.js', {
    './settings': settingsMock,
    '../config': { appUrl: 'https://board.example', push: {} },
    'web-push': {}
  });
  const snapshot = supervision.buildSupervisionSnapshot([{
    id: 'old', name: 'Puller arrêté', lastSeenAt: new Date('2020-01-01'),
    agentInfo: { harvests: [{ name: 'Sonde', status: 'UP', checkedAt: '2020-01-01' }] }
  }]);
  findings.push(['État UP périmé conservé', snapshot.summary.up === 1]);
  await supervision.notifyNewAlertsOnce([{ key: 'puller-A', title: 'A' }]);
  await supervision.notifyNewAlertsOnce([]); // check-in sain du puller B
  findings.push(['Le puller B efface l’état actif du puller A', settings.supervision.alertState['puller-A'].active === false]);

  const { agentAuth } = load('src/middleware/agentAuth.js', {
    '../lib/prisma': { agentToken: { findUnique: async () => ({ isActive: true, ipWhitelist: '["10.0.0.1"]' }) } },
    '../utils/agentTokens': { isEnrollmentTokenUsable: () => true }
  });
  let accepted = false;
  const response = { status() { return this; }, json() {} };
  await agentAuth({ headers: { 'x-agent-token': 'fictif', 'x-forwarded-for': '10.0.0.1' }, ip: '203.0.113.7' }, response, err => {
    if (err) throw err;
    accepted = true;
  });
  findings.push(['IP falsifiée acceptée par agentAuth', accepted]);

  const routes = {};
  const router = {};
  for (const verb of ['get', 'post', 'patch', 'delete']) router[verb] = (url, ...handlers) => { routes[`${verb} ${url}`] = handlers.at(-1); };
  const equipment = { id: 'victime', serialNumber: 'SERIAL-CONNU', agentToken: 'secret-machine-fictif', agentRevoked: false, enrollmentTokenId: 'autre-token' };
  load('src/routes/agents.js', {
    express: { Router: () => router },
    '../middleware/auth': { requireAuth() {} },
    '../middleware/roles': { requireAdmin() {}, requireTechOrAdmin() {} },
    '../middleware/agentAuth': { agentAuth() {} },
    '../services/discoveryService': {},
    '../utils/settings': { readSettings: () => ({}) },
    '../utils/supervision': { evaluateHarvestAlerts: () => [], getSupervisionSettings: () => ({}), notifyNewAlertsOnce: async () => ({}) },
    '../lib/prisma': {
      agentToken: { update: async () => ({}) },
      equipment: { findUnique: async () => equipment, update: async () => equipment }
    }
  });
  let body;
  await routes['post /checkin']({ body: { hostname: 'attaquant', serialNumber: 'SERIAL-CONNU' }, enrollmentToken: { id: 'token-different' } }, {
    status() { return this; }, json(value) { body = value; }
  }, err => { throw err; });
  findings.push(['Jeton machine divulgué à un autre jeton d’enregistrement', body?.agentToken === equipment.agentToken]);
  for (const [label, confirmed] of findings) console.log(`${confirmed ? 'CONFIRME' : 'NON REPRODUIT'} : ${label}`);
}

main().catch(err => { console.error(err); process.exitCode = 1; });
